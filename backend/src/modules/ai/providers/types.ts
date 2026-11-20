/**
 * Provider interfaces (AI design §6.2). Adapters return unknown output; validation and every business rule live in
 * Blueprint code, so changing vendor changes one folder.
 */
export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
}

export type ProviderErrorKind = "TIMEOUT" | "PROVIDER_ERROR" | "RATE_LIMITED" | "INVALID_OUTPUT";

export class ProviderError extends Error {
  /** HTTP status from the provider, when it answered with an error. */
  status?: number;
  constructor(
    public kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** The provider itself failed (HTTP 5xx: overloaded, unavailable, internal error): another model may still answer. */
export const isProviderOutage = (e: ProviderError) => e.kind === "PROVIDER_ERROR" && (e.status ?? 0) >= 500;

export interface TranscribeInput {
  audio: Buffer;
  mimeType: string;
  audioSeconds: number;
  /** Natural-language instruction (Gemini reads it; Whisper does not take instructions). */
  instruction: string;
  /** Spoken language code ("en", "de"), for speech models that take it. */
  language?: string;
  /** Curriculum terms to spell correctly (Whisper's prompt; Gemini gets them inside the instruction). */
  vocabulary?: string[];
  model: string;
  signal: AbortSignal;
}

export interface EvaluateInput {
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  model: string;
  signal: AbortSignal;
}

/** Long structured output (curriculum generation, AI design §10.3): same shape as evaluation, more tokens. */
export interface GenerateInput extends EvaluateInput {
  /** Short schema name for providers that label structured output ("curriculum_outline"). */
  name: string;
  maxTokens: number;
  /** Images sent with the user message (revision material photos); only for providers with `images`. */
  images?: { mimeType: string; data: Buffer }[];
}

export interface GenerationProvider {
  readonly name: string;
  /** The provider's generation models can read images (revision material photos and screenshots). */
  readonly images?: boolean;
  generate(input: GenerateInput): Promise<{ output: unknown; usage: ProviderUsage }>;
}

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(input: TranscribeInput): Promise<{ text: string; usage: ProviderUsage }>;
}

export interface EvaluationProvider {
  readonly name: string;
  evaluate(input: EvaluateInput): Promise<{ output: unknown; usage: ProviderUsage }>;
}

export interface AiProviders {
  transcription: TranscriptionProvider;
  evaluation: EvaluationProvider;
  /** Curriculum generation; absent when no provider is configured for it. */
  generation?: GenerationProvider;
}

/** Map a thrown error to a ProviderError (aborts are timeouts). */
export function asProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError" || /abort|timed? ?out/i.test(e.message)))
    return new ProviderError("TIMEOUT", "The AI provider did not answer in time");
  return new ProviderError("PROVIDER_ERROR", "The AI provider returned an error");
}
