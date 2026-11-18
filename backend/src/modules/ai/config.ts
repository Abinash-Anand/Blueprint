/**
 * AI configuration (AI design §10). Everything comes from the backend environment; nothing here reaches the browser
 * except the limits that `GET /ai/status` reports. With AI_ENABLED unset or false the app behaves exactly as before.
 */
export type ProviderName = "fake" | "gemini" | "anthropic";

export interface AiConfig {
  enabled: boolean;
  evaluationProvider: ProviderName;
  transcriptionProvider: ProviderName;
  evaluationModel: string;
  transcriptionModel: string;
  geminiApiKey?: string;
  anthropicApiKey?: string;
  language: string;
  maxRecordingSeconds: number;
  maxAudioBytes: number;
  maxFollowUps: number;
  maxEvaluationsPerHour: number;
  maxTranscriptionsPerHour: number;
  /** Requests a day across both operations; 0 = no daily cap (set it just below the free-tier quota). */
  dailyRequestLimit: number;
  /** Monthly cap on estimated cost; only reached when prices are configured (free tier: prices stay 0). */
  monthlyBudgetEur: number;
  priceInputPerMTokEur: number;
  priceOutputPerMTokEur: number;
  priceAudioPerMinEur: number;
  requestTimeoutMs: number;
  promptVersion: string;
}

const DEFAULT_MODELS: Record<ProviderName, string> = {
  fake: "fake-1",
  gemini: "gemini-2.5-flash",
  anthropic: "claude-haiku-5-5",
};

const num = (v: string | undefined, d: number, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if (v === undefined || v.trim() === "") return d;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid AI setting value: ${v}`);
  return n;
};

const provider = (v: string | undefined, d: ProviderName): ProviderName => {
  const p = (v ?? "").trim() || d;
  if (p !== "fake" && p !== "gemini" && p !== "anthropic") throw new Error(`Unknown AI provider: ${p}`);
  return p;
};

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const evaluationProvider = provider(env.AI_EVALUATION_PROVIDER, "gemini");
  // Claude has no speech-to-text, so transcription stays on Gemini unless set otherwise.
  const transcriptionProvider = provider(env.AI_TRANSCRIPTION_PROVIDER, evaluationProvider === "anthropic" ? "gemini" : evaluationProvider);
  if (transcriptionProvider === "anthropic") throw new Error("AI_TRANSCRIPTION_PROVIDER cannot be anthropic: Claude has no speech-to-text");
  return {
    enabled: env.AI_ENABLED === "true",
    evaluationProvider,
    transcriptionProvider,
    evaluationModel: env.AI_EVALUATION_MODEL?.trim() || DEFAULT_MODELS[evaluationProvider],
    transcriptionModel: env.AI_TRANSCRIPTION_MODEL?.trim() || DEFAULT_MODELS[transcriptionProvider],
    geminiApiKey: env.GEMINI_API_KEY?.trim() || undefined,
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || undefined,
    language: env.AI_LANGUAGE?.trim() || "en",
    maxRecordingSeconds: num(env.AI_MAX_RECORDING_SECONDS, 120, 10, 600),
    maxAudioBytes: num(env.AI_MAX_AUDIO_BYTES, 4_000_000, 100_000, 20_000_000),
    maxFollowUps: num(env.AI_MAX_FOLLOW_UPS, 1, 0, 2),
    maxEvaluationsPerHour: num(env.AI_MAX_EVALUATIONS_PER_HOUR, 30, 1, 1000),
    maxTranscriptionsPerHour: num(env.AI_MAX_TRANSCRIPTIONS_PER_HOUR, 30, 1, 1000),
    dailyRequestLimit: num(env.AI_DAILY_REQUEST_LIMIT, 0, 0, 100_000),
    monthlyBudgetEur: num(env.AI_MONTHLY_BUDGET_EUR, 5, 0, 1000),
    priceInputPerMTokEur: num(env.AI_PRICE_INPUT_PER_MTOK_EUR, 0, 0, 1000),
    priceOutputPerMTokEur: num(env.AI_PRICE_OUTPUT_PER_MTOK_EUR, 0, 0, 1000),
    priceAudioPerMinEur: num(env.AI_PRICE_AUDIO_PER_MIN_EUR, 0, 0, 100),
    requestTimeoutMs: num(env.AI_REQUEST_TIMEOUT_MS, 30_000, 1_000, 120_000),
    promptVersion: env.AI_PROMPT_VERSION?.trim() || "eval-criteria-v1",
  };
}

/** Disabled configuration used when nothing is configured (and by tests that do not exercise AI). */
export const AI_DISABLED: AiConfig = loadAiConfig({});
