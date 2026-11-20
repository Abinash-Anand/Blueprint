/**
 * Provider calls for a background job (curriculum generation, revision packs). Every request is recorded in the usage
 * ledger. An overloaded main model (HTTP 5xx) is retried after short pauses; if it stays down, the fallback model takes
 * over for the rest of the job, so one result is not written by two models taking turns. Other errors are not retried.
 * Calls may run in parallel, so the model is shared: once one call switches, the others follow.
 */
import type { AiOperation } from "@prisma/client";
import type { AiConfig } from "./config.js";
import { type GenerateInput, ProviderError, asProviderError, isProviderOutage, type GenerationProvider } from "./providers/types.js";
import type { UsageService } from "./usage.js";

export interface JobCallerInput {
  config: AiConfig;
  provider: GenerationProvider;
  usage: UsageService;
  /** Shown to the learner while the job waits or switches models. */
  notice: (step: "retry" | "fallback", label: string) => Promise<void>;
  /** The usage-ledger operation (and the logs). */
  op: AiOperation;
}

export function jobCaller({ config, provider, usage, notice, op }: JobCallerInput) {
  let model = config.generationModel;
  const used = new Set<string>();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const once = async (m: string, stage: { name: string; label: string }, prompt: { system: string; user: string }, jsonSchema: Record<string, unknown>, maxTokens: number, images?: GenerateInput["images"]) => {
    const t0 = performance.now();
    try {
      const r = await provider.generate({ ...prompt, jsonSchema, model: m, name: stage.name, maxTokens, images, signal: AbortSignal.timeout(config.generationTimeoutMs) });
      await usage.record(op, provider.name, m, r.usage, performance.now() - t0, "OK");
      return r.output;
    } catch (err) {
      const e = asProviderError(err);
      await usage.record(op, provider.name, m, {}, performance.now() - t0, e.kind);
      console.warn(JSON.stringify({ level: "warn", msg: "AI provider error", op, stage: stage.label, model: m, kind: e.kind, status: e.status ?? null }));
      throw e;
    }
  };

  async function call(stage: { name: string; label: string }, prompt: { system: string; user: string }, jsonSchema: Record<string, unknown>, maxTokens: number, images?: GenerateInput["images"]) {
    for (let attempt = 0; ; attempt++) {
      const m = model;
      try {
        const out = await once(m, stage, prompt, jsonSchema, maxTokens, images);
        used.add(m);
        return out;
      } catch (e) {
        if (!(e instanceof ProviderError) || !isProviderOutage(e)) throw e;
        if (model !== m) continue; // another call already switched to the fallback while this one waited
        if (model === config.generationModel && attempt < config.generationRetryDelaysMs.length) {
          await notice("retry", "The AI service is busy; trying again in a moment");
          await sleep(config.generationRetryDelaysMs[attempt]);
          continue;
        }
        if (config.generationFallbackModel && model !== config.generationFallbackModel) {
          console.warn(JSON.stringify({ level: "warn", msg: "AI fallback model", op, from: model, to: config.generationFallbackModel }));
          model = config.generationFallbackModel;
          await notice("fallback", "The main model is busy; continuing with a second model");
          continue;
        }
        throw e;
      }
    }
  }

  return {
    call,
    /** The models that answered, in order of first use. */
    used: () => [...used],
  };
}
