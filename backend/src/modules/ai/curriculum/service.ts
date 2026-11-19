/**
 * Curriculum generation as a background job (AI design §10.3). One job per city at a time; its state lives in the
 * CurriculumVersion row (GENERATING → PROPOSED or FAILED) so the wizard can follow it and a restart cannot leave it
 * hanging. Nothing in the city changes until the learner approves the proposal (cities/service.ts approve()).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Clock } from "../../../lib/clock.js";
import { HttpError } from "../../../lib/http.js";
import type { AuthService } from "../../auth/service.js";
import { CURRICULUM_CONTRACT_VERSION, diffCurriculum, type CurriculumDocument } from "../../cities/contract.js";
import type { AiConfig } from "../config.js";
import { ProviderError, asProviderError, isProviderOutage, type AiProviders } from "../providers/types.js";
import type { UsageService } from "../usage.js";
import { GENERATION_PROMPT_VERSION, GenerationError, type GenerationRequest, type Progress, generateCurriculum } from "./generator.js";

/** Calls one generation makes at most: outline + up to 7 districts, each with one repair. */
const MAX_CALLS = 1 + 7 * 2;

export interface GenerationDeps {
  prisma: PrismaClient;
  clock: Clock;
  ai: { config: AiConfig; providers: AiProviders };
  usage: UsageService;
  auth: AuthService;
}

const failureText = (e: unknown) => {
  if (e instanceof GenerationError) return e.message;
  const p = e instanceof ProviderError ? e : asProviderError(e);
  if (p.kind === "RATE_LIMITED") return "The AI provider's limit is reached for now. Try again later.";
  if (p.kind === "TIMEOUT") return "The AI provider took too long. Try again.";
  if (p.kind === "INVALID_OUTPUT") return "The AI provider returned something unusable. Try again.";
  const status = (p as { status?: number }).status;
  return status && status >= 500 ? "The AI provider is overloaded right now. Try again in a few minutes." : "The AI provider could not be reached. Try again later.";
};

/** On start-up: jobs that were running when the server stopped cannot finish; mark them failed so they can be restarted. */
export async function recoverGenerations(prisma: PrismaClient) {
  const r = await prisma.curriculumVersion.updateMany({
    where: { status: "GENERATING" },
    data: { status: "FAILED", error: "Interrupted by a server restart. Start the generation again.", progress: undefined },
  });
  return r.count;
}

export function generationService(d: GenerationDeps) {
  const { config, providers } = d.ai;
  const running = new Set<string>();

  async function availability(userId: string) {
    const consented = !!(await d.auth.hasConsent(userId, "AI_CURRICULUM"));
    const reason = !config.enabled ? "AI_DISABLED" : !providers.generation ? "NO_PROVIDER" : !consented ? "CONSENT_REQUIRED" : null;
    return {
      available: reason === null,
      reason,
      consented,
      provider: config.generationProvider,
      model: config.generationModel,
    };
  }

  async function run(versionId: number, cityId: string, req: GenerationRequest) {
    const provider = providers.generation!;
    const report = async (p: Progress) => {
      await d.prisma.curriculumVersion.update({ where: { id: versionId }, data: { progress: p as unknown as Prisma.InputJsonValue } });
    };
    /** One provider request with one model, recorded in the usage ledger whatever happens. */
    const once = async (model: string, stage: { name: string; label: string }, prompt: { system: string; user: string }, jsonSchema: Record<string, unknown>, maxTokens: number) => {
      const t0 = performance.now();
      try {
        const r = await provider.generate({ ...prompt, jsonSchema, model, name: stage.name, maxTokens, signal: AbortSignal.timeout(config.generationTimeoutMs) });
        await d.usage.record("GENERATE", provider.name, model, r.usage, performance.now() - t0, "OK");
        return r.output;
      } catch (err) {
        const e = asProviderError(err);
        await d.usage.record("GENERATE", provider.name, model, {}, performance.now() - t0, e.kind);
        console.warn(JSON.stringify({ level: "warn", msg: "AI provider error", op: "GENERATE", stage: stage.label, model, kind: e.kind, status: e.status ?? null }));
        throw e;
      }
    };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // An overloaded main model (HTTP 5xx) is retried after short pauses; if it stays down, the fallback model takes over
    // for the rest of this job, so one city is not written by two models taking turns. Other errors are not retried.
    let model = config.generationModel;
    const used = new Set<string>();
    try {
      const doc = await generateCurriculum(
        req,
        async (stage, prompt, jsonSchema, maxTokens) => {
          for (let attempt = 0; ; attempt++) {
            try {
              const out = await once(model, stage, prompt, jsonSchema, maxTokens);
              used.add(model);
              return out;
            } catch (e) {
              if (!(e instanceof ProviderError) || !isProviderOutage(e)) throw e;
              if (model === config.generationModel && attempt < config.generationRetryDelaysMs.length) {
                await report({ step: "retry", label: "The AI service is busy; trying again in a moment", done: 0, total: 1 });
                await sleep(config.generationRetryDelaysMs[attempt]);
                continue;
              }
              if (config.generationFallbackModel && model !== config.generationFallbackModel) {
                console.warn(JSON.stringify({ level: "warn", msg: "AI fallback model", op: "GENERATE", from: model, to: config.generationFallbackModel }));
                model = config.generationFallbackModel;
                await report({ step: "fallback", label: "The main model is busy; continuing with a second model", done: 0, total: 1 });
                continue;
              }
              throw e;
            }
          }
        },
        report,
      );
      const applied = await d.prisma.curriculumVersion.findFirst({ where: { cityId, status: "APPLIED" }, orderBy: { version: "desc" } });
      const changes = diffCurriculum(applied ? (applied.content as unknown as CurriculumDocument) : null, doc);
      await d.prisma.$transaction([
        d.prisma.curriculumVersion.updateMany({ where: { cityId, status: "PROPOSED" }, data: { status: "REJECTED" } }),
        d.prisma.curriculumVersion.update({
          where: { id: versionId },
          data: {
            status: "PROPOSED", content: doc as unknown as Prisma.InputJsonValue, changes: changes as unknown as Prisma.InputJsonValue, progress: undefined,
            // The models that actually wrote it (the fallback when the main model was overloaded).
            note: `Generated by ${config.generationProvider}:${[...used].join(" + ")} (${GENERATION_PROMPT_VERSION})`,
          },
        }),
      ]);
      console.log(JSON.stringify({ level: "info", msg: "Curriculum generated", districts: doc.districts.length, topics: doc.districts.reduce((a, x) => a + x.topics.length, 0) }));
    } catch (e) {
      await d.prisma.curriculumVersion.update({ where: { id: versionId }, data: { status: "FAILED", error: failureText(e) } }).catch(() => undefined);
      if (!(e instanceof GenerationError) && !(e instanceof ProviderError))
        console.error(JSON.stringify({ level: "error", msg: "Curriculum generation failed", error: String((e as Error)?.message ?? e).slice(0, 300) }));
    } finally {
      running.delete(cityId);
    }
  }

  return {
    availability,

    /** Starts generation for a draft city of this user; returns at once with the GENERATING version. */
    async start(userId: string, cityId: string) {
      const city = await d.prisma.city.findFirst({ where: { id: cityId, ownerId: userId } });
      if (!city) throw new HttpError(404, "CITY_NOT_FOUND", "City not found");
      if (city.status !== "DRAFT") throw new HttpError(409, "CITY_NOT_DRAFT", "Curricula are generated for new cities only.");
      const a = await availability(userId);
      if (a.reason === "AI_DISABLED" || a.reason === "NO_PROVIDER") throw new HttpError(403, "AI_DISABLED", "Curriculum generation is not available: AI is switched off.");
      if (a.reason === "CONSENT_REQUIRED") throw new HttpError(403, "AI_CONSENT_REQUIRED", "Allow sending your answers to the AI provider first.");
      if (running.has(cityId) || (await d.prisma.curriculumVersion.count({ where: { cityId, status: "GENERATING" } })))
        throw new HttpError(409, "GENERATION_IN_PROGRESS", "A curriculum is already being generated for this city.");
      // The generation provider's own daily cap, with room for every call one generation can make.
      await d.usage.check("GENERATE", providers.generation!.name, config.generationDailyLimit, MAX_CALLS);

      const user = await d.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { language: true } });
      const req: GenerationRequest = {
        name: city.name, goal: city.goal, description: city.description, category: city.category,
        requirements: (city.requirements ?? {}) as GenerationRequest["requirements"],
        constraints: (city.constraints ?? {}) as GenerationRequest["constraints"],
        language: user.language === "de" ? "de" : "en",
        today: d.clock.today(),
      };
      const last = await d.prisma.curriculumVersion.findFirst({ where: { cityId }, orderBy: { version: "desc" }, select: { version: true } });
      const v = await d.prisma.curriculumVersion.create({
        data: {
          cityId, version: (last?.version ?? 0) + 1, status: "GENERATING", source: "GENERATED", contractVersion: CURRICULUM_CONTRACT_VERSION,
          content: {}, note: `Generated by ${config.generationProvider}:${config.generationModel} (${GENERATION_PROMPT_VERSION})`,
          progress: { step: "queued", label: "Starting", done: 0, total: 1 } as Prisma.InputJsonValue,
        },
      });
      running.add(cityId);
      void run(v.id, cityId, req);
      return { version: v.version, status: v.status };
    },
  };
}
export type GenerationService = ReturnType<typeof generationService>;
