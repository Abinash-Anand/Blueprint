import type { AiConfig, ProviderName } from "../config.js";
import { anthropicProvider } from "./anthropic.js";
import { fakeProvider } from "./fake.js";
import { geminiProvider } from "./gemini.js";
import type { AiProviders, EvaluationProvider, TranscriptionProvider } from "./types.js";

export function createProviders(c: AiConfig): AiProviders {
  const evaluation: Record<ProviderName, () => EvaluationProvider> = {
    fake: () => fakeProvider(),
    gemini: () => geminiProvider(c.geminiApiKey),
    anthropic: () => anthropicProvider(c.anthropicApiKey),
  };
  const transcription: Record<Exclude<ProviderName, "anthropic">, () => TranscriptionProvider> = {
    fake: () => fakeProvider(),
    gemini: () => geminiProvider(c.geminiApiKey),
  };
  return {
    evaluation: evaluation[c.evaluationProvider](),
    transcription: transcription[c.transcriptionProvider as Exclude<ProviderName, "anthropic">](),
  };
}
