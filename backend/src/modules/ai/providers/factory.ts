import type { AiConfig, ProviderName } from "../config.js";
import { anthropicProvider } from "./anthropic.js";
import { fakeProvider } from "./fake.js";
import { geminiProvider } from "./gemini.js";
import { gwdgProvider } from "./gwdg.js";
import type { AiProviders, EvaluationProvider, GenerationProvider, TranscriptionProvider } from "./types.js";

export function createProviders(c: AiConfig): AiProviders {
  const evaluation: Record<ProviderName, () => EvaluationProvider> = {
    fake: () => fakeProvider(),
    gemini: () => geminiProvider(c.geminiApiKey),
    anthropic: () => anthropicProvider(c.anthropicApiKey),
    gwdg: () => gwdgProvider(c.gwdg),
  };
  const transcription: Record<Exclude<ProviderName, "anthropic">, () => TranscriptionProvider> = {
    fake: () => fakeProvider(),
    gemini: () => geminiProvider(c.geminiApiKey),
    gwdg: () => gwdgProvider(c.gwdg),
  };
  const generation: Partial<Record<ProviderName, () => GenerationProvider>> = {
    fake: () => fakeProvider(),
    gemini: () => geminiProvider(c.geminiApiKey),
    gwdg: () => gwdgProvider(c.gwdg),
  };
  return {
    generation: generation[c.generationProvider]?.(),
    evaluation: evaluation[c.evaluationProvider](),
    transcription: transcription[c.transcriptionProvider as Exclude<ProviderName, "anthropic">](),
  };
}
