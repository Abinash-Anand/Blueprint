/**
 * One structured call that doesn't wait long on a slow model, for calls a learner is waiting on (recall). The main
 * model gets `switchAfterMs`; if it times out or the provider reports an outage (HTTP 5xx), the fallback model (same
 * provider) gets the full `timeoutMs`. Without a fallback, the main model gets the full time, as before. Every try is
 * checked against the limits and recorded in the usage ledger. The result says which model answered, so what is
 * stored (and shown as "Checked by …") is the model that actually did the work.
 */
import type { AiOperation } from "@prisma/client";
import { type GenerateInput, type GenerationProvider, ProviderError, asProviderError, isProviderOutage } from "./providers/types.js";
import type { UsageService } from "./usage.js";

export interface SwitchingCall {
  provider: GenerationProvider;
  usage: Pick<UsageService, "record">;
  op: AiOperation;
  model: string;
  fallback: string | null;
  switchAfterMs: number;
  timeoutMs: number;
  input: Omit<GenerateInput, "model" | "signal">;
  /** Runs before each try (the usage limits), so a switch is a request like any other. */
  before?: () => Promise<void>;
}

export async function generateSwitching(o: SwitchingCall): Promise<{ output: unknown; model: string }> {
  const alt = o.fallback && o.fallback !== o.model ? o.fallback : null;
  const tries: [string, number][] = alt ? [[o.model, Math.min(o.switchAfterMs, o.timeoutMs)], [alt, o.timeoutMs]] : [[o.model, o.timeoutMs]];
  for (let i = 0; i < tries.length; i++) {
    const [model, ms] = tries[i];
    await o.before?.();
    const t0 = performance.now();
    try {
      const r = await o.provider.generate({ ...o.input, model, signal: AbortSignal.timeout(ms) });
      await o.usage.record(o.op, o.provider.name, model, r.usage, performance.now() - t0, "OK");
      return { output: r.output, model };
    } catch (e) {
      const err = asProviderError(e);
      await o.usage.record(o.op, o.provider.name, model, {}, performance.now() - t0, err.kind);
      console.warn(JSON.stringify({ level: "warn", msg: "AI provider error", op: o.op, stage: o.input.name, model, kind: err.kind, status: err.status ?? null }));
      const next = tries[i + 1];
      if (!next || !(err.kind === "TIMEOUT" || isProviderOutage(err))) throw err;
      console.warn(JSON.stringify({ level: "warn", msg: "AI fallback model", op: o.op, stage: o.input.name, from: model, to: next[0], reason: err.kind, afterMs: Math.round(performance.now() - t0) }));
    }
  }
  throw new ProviderError("PROVIDER_ERROR", "No model answered");
}
