/**
 * Usage ledger, limits and budget (AI design §8.2, §10, §10.1). The ledger never holds transcript, prompt or audio.
 * Limits are checked before a provider call; every call that reached a provider is recorded, success or not.
 */
import type { AiOperation, PrismaClient } from "@prisma/client";
import { HttpError } from "../../lib/http.js";
import type { AiConfig } from "./config.js";
import type { ProviderUsage } from "./providers/types.js";

const HOUR = 3_600_000;
const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export function usageService(prisma: PrismaClient, config: AiConfig, now: () => Date = () => new Date()) {
  const recent = new Map<AiOperation, number[]>();

  const costMicroEur = (u: ProviderUsage) =>
    Math.max(
      0,
      Math.round(
        ((u.inputTokens ?? 0) * config.priceInputPerMTokEur + (u.outputTokens ?? 0) * config.priceOutputPerMTokEur) +
          ((u.audioSeconds ?? 0) / 60) * config.priceAudioPerMinEur * 1_000_000,
      ),
    );

  async function spentThisMonthMicro() {
    const r = await prisma.aiUsage.aggregate({ _sum: { costMicroEur: true }, where: { at: { gte: monthStart(now()) } } });
    return r._sum.costMicroEur ?? 0;
  }

  /** Calls in the last 24 hours, for one provider (each has its own quota) or all of them. */
  async function usedLast24h(provider?: string) {
    return prisma.aiUsage.count({ where: { at: { gte: new Date(now().getTime() - 24 * HOUR) }, ...(provider ? { provider } : {}) } });
  }

  return {
    /** Throws 429 when a limit would be passed. Call before reserving work or calling a provider. */
    async check(op: AiOperation, provider?: string, dailyLimit: number = config.dailyRequestLimit, reserve = 1) {
      const t = now().getTime();
      const xs = (recent.get(op) ?? []).filter((x) => t - x < HOUR);
      recent.set(op, xs);
      // Reading a new city's goal is a short structured call like an answer check, so it shares that hourly limit.
      const perHour = op === "EVALUATE" || op === "UNDERSTAND" ? config.maxEvaluationsPerHour : op === "GENERATE" ? config.maxGenerationsPerHour : config.maxTranscriptionsPerHour;
      if (xs.length >= perHour)
        throw new HttpError(429, "AI_RATE_LIMITED", op === "GENERATE" ? `Curriculum generation is limited to ${perHour} an hour. Try again later.` : `AI checks are limited to ${perHour} an hour. Carry on without AI, or try again later.`);
      if (dailyLimit > 0 && (await usedLast24h(provider)) + reserve > dailyLimit)
        throw new HttpError(429, "AI_RATE_LIMITED", op === "GENERATE" ? "Today's AI allowance is too small for a whole curriculum. Try again tomorrow." : "Today's AI allowance is used up. Carry on without AI; it is available again tomorrow.");
      const spent = await spentThisMonthMicro();
      if (spent > 0 && spent >= config.monthlyBudgetEur * 1_000_000)
        throw new HttpError(429, "AI_BUDGET_REACHED", "This month's AI budget is used up. Carry on without AI; it resets next month.");
      xs.push(t);
    },
    async record(op: AiOperation, provider: string, model: string, usage: ProviderUsage, latencyMs: number, outcome: string) {
      await prisma.aiUsage.create({
        data: {
          operation: op, provider, model, latencyMs: Math.max(0, Math.round(latencyMs)), outcome,
          inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null,
          audioSeconds: usage.audioSeconds !== undefined ? Math.round(usage.audioSeconds) : null,
          costMicroEur: costMicroEur(usage),
        },
      });
    },
    async summary(provider?: string) {
      return { spentThisMonthEur: (await spentThisMonthMicro()) / 1_000_000, requestsLast24h: await usedLast24h(provider) };
    },
  };
}

export type UsageService = ReturnType<typeof usageService>;
