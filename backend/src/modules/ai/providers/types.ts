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
  constructor(
    public kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface TranscribeInput {
  audio: Buffer;
  mimeType: string;
  audioSeconds: number;
  instruction: string;
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
}

/** Map a thrown error to a ProviderError (aborts are timeouts). */
export function asProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError" || /abort|timed? ?out/i.test(e.message)))
    return new ProviderError("TIMEOUT", "The AI provider did not answer in time");
  return new ProviderError("PROVIDER_ERROR", "The AI provider returned an error");
}
