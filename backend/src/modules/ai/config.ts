/**
 * AI configuration (AI design §10). Everything comes from the backend environment; nothing here reaches the browser
 * except the limits that `GET /ai/status` reports. With AI_ENABLED unset or false the app behaves exactly as before.
 */
export type ProviderName = "fake" | "gemini" | "anthropic" | "gwdg";

export interface AiConfig {
  enabled: boolean;
  evaluationProvider: ProviderName;
  transcriptionProvider: ProviderName;
  evaluationModel: string;
  transcriptionModel: string;
  /**
   * Tried once when the provider reports a server-side failure (HTTP 5xx, e.g. Gemini's 503 "high demand") for the main
   * model. Never for quota refusals, timeouts, bad requests or invalid output. null = no fallback.
   */
  evaluationFallbackModel: string | null;
  transcriptionFallbackModel: string | null;
  /** Curriculum generation (AI design §10.3): a large model, called a few times per city, in the background. */
  generationProvider: ProviderName;
  generationModel: string;
  /** Same-provider model used when the main one keeps answering 5xx (GWDG: Mistral Large 4). null = none. */
  generationFallbackModel: string | null;
  /** Pauses before retrying the main model after a 5xx (ms); then the fallback model takes over. */
  generationRetryDelaysMs: number[];
  /** Districts written at the same time after the outline (GWDG allows 10 requests per 10 s). */
  generationConcurrency: number;
  /** Per call: a district's detail can take minutes on a large model. */
  generationTimeoutMs: number;
  maxGenerationsPerHour: number;
  /** Revision packs built per hour on this server (Revision v2 plan §7), apart from curriculum generation. */
  maxPacksPerHour: number;
  /** Daily cap on calls to the generation provider (GWDG allows far more than Gemini's free tier). 0 = none. */
  generationDailyLimit: number;
  geminiApiKey?: string;
  anthropicApiKey?: string;
  /** GWDG Academic Cloud (SAIA): one key for the chat and the audio host. */
  gwdg: { apiKey?: string; chatBaseUrl: string; audioBaseUrl: string; disableThinking: boolean };
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

type Role = "evaluation" | "transcription" | "generation";

/**
 * Default model per provider and job. GWDG ids follow the SAIA naming; the exact ids come from GET /v1/models
 * (eval/models.ts) and can be set with AI_EVALUATION_MODEL / AI_TRANSCRIPTION_MODEL.
 */
const DEFAULT_MODELS: Record<ProviderName, Record<Role, string>> = {
  fake: { evaluation: "fake-1", transcription: "fake-1", generation: "fake-1" },
  gemini: { evaluation: "gemini-3.8-flash", transcription: "gemini-3.8-flash", generation: "gemini-3.8-flash" }, // benchmarked 18 Nov 2026 (§10.1)
  anthropic: { evaluation: "claude-haiku-5-5", transcription: "", generation: "" },
  gwdg: { evaluation: "qwen3.8-27b", transcription: "whisper-large-v3", generation: "qwen3.5-397b-a17b" }, // chosen 19 Nov 2026 (§10.2, §10.3)
};

/** Same-provider fallback when the main model is overloaded (HTTP 5xx). Never another provider: no second company. */
const DEFAULT_FALLBACK: Record<ProviderName, Record<Role, string | null>> = {
  fake: { evaluation: null, transcription: null, generation: null },
  gemini: { evaluation: "gemini-2.5-flash", transcription: "gemini-2.5-flash", generation: null },
  anthropic: { evaluation: null, transcription: null, generation: null },
  gwdg: { evaluation: "gemma-4-31b-it", transcription: "whisper-large-v2", generation: "mistral-large-4-1t-a52b" },
};

/**
 * AI_EVALUATION_FALLBACK_MODEL / AI_TRANSCRIPTION_FALLBACK_MODEL, else AI_FALLBACK_MODEL, else the provider's default;
 * "none" = off. A fallback equal to the main model is pointless.
 */
const fallback = (specific: string | undefined, shared: string | undefined, p: ProviderName, role: Role, main: string): string | null => {
  const raw = specific?.trim() || shared?.trim();
  const m = !raw ? DEFAULT_FALLBACK[p][role] : raw.toLowerCase() === "none" ? null : raw;
  return m && m !== main ? m : null;
};

const num = (v: string | undefined, d: number, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if (v === undefined || v.trim() === "") return d;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid AI setting value: ${v}`);
  return n;
};

const provider = (v: string | undefined, d: ProviderName): ProviderName => {
  const p = (v ?? "").trim() || d;
  if (p !== "fake" && p !== "gemini" && p !== "anthropic" && p !== "gwdg") throw new Error(`Unknown AI provider: ${p}`);
  return p;
};

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const evaluationProvider = provider(env.AI_EVALUATION_PROVIDER, "gemini");
  // Claude has no speech-to-text, so transcription stays on Gemini unless set otherwise.
  const transcriptionProvider = provider(env.AI_TRANSCRIPTION_PROVIDER, evaluationProvider === "anthropic" ? "gemini" : evaluationProvider);
  if (transcriptionProvider === "anthropic") throw new Error("AI_TRANSCRIPTION_PROVIDER cannot be anthropic: Claude has no speech-to-text");
  const evaluationModel = env.AI_EVALUATION_MODEL?.trim() || DEFAULT_MODELS[evaluationProvider].evaluation;
  // Generation defaults to GWDG when its key is set (the free Gemini quota is too small for a whole curriculum).
  const generationProvider = provider(env.AI_GENERATION_PROVIDER, env.SAIA_API_KEY?.trim() ? "gwdg" : evaluationProvider === "anthropic" ? "gemini" : evaluationProvider);
  if (generationProvider === "anthropic") throw new Error("AI_GENERATION_PROVIDER cannot be anthropic (no adapter for long structured output)");
  const transcriptionModel = env.AI_TRANSCRIPTION_MODEL?.trim() || DEFAULT_MODELS[transcriptionProvider].transcription;
  return {
    enabled: env.AI_ENABLED === "true",
    evaluationProvider,
    transcriptionProvider,
    evaluationModel,
    transcriptionModel,
    generationProvider,
    generationModel: env.AI_GENERATION_MODEL?.trim() || DEFAULT_MODELS[generationProvider].generation,
    generationFallbackModel: fallback(env.AI_GENERATION_FALLBACK_MODEL, undefined, generationProvider, "generation", env.AI_GENERATION_MODEL?.trim() || DEFAULT_MODELS[generationProvider].generation),
    generationRetryDelaysMs: (env.AI_GENERATION_RETRY_DELAYS_MS?.trim() || "4000,10000").split(",").map((x) => num(x, 0, 0, 120_000)),
    generationTimeoutMs: num(env.AI_GENERATION_TIMEOUT_MS, 300_000, 10_000, 900_000),
    generationConcurrency: num(env.AI_GENERATION_CONCURRENCY, 6, 1, 8),
    maxGenerationsPerHour: num(env.AI_MAX_GENERATIONS_PER_HOUR, 3, 1, 100),
    maxPacksPerHour: num(env.AI_MAX_PACKS_PER_HOUR, 20, 1, 500),
    generationDailyLimit: num(env.AI_GENERATION_DAILY_LIMIT, 300, 0, 100_000),
    evaluationFallbackModel: fallback(env.AI_EVALUATION_FALLBACK_MODEL, env.AI_FALLBACK_MODEL, evaluationProvider, "evaluation", evaluationModel),
    transcriptionFallbackModel: fallback(env.AI_TRANSCRIPTION_FALLBACK_MODEL, env.AI_FALLBACK_MODEL, transcriptionProvider, "transcription", transcriptionModel),
    geminiApiKey: env.GEMINI_API_KEY?.trim() || undefined,
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || undefined,
    gwdg: {
      apiKey: env.SAIA_API_KEY?.trim() || undefined,
      chatBaseUrl: (env.SAIA_BASE_URL?.trim() || "https://chat-ai.academiccloud.de/v1").replace(/\/+$/, ""),
      audioBaseUrl: (env.SAIA_AUDIO_BASE_URL?.trim() || "https://saia.gwdg.de/v1").replace(/\/+$/, ""),
      disableThinking: env.AI_DISABLE_THINKING !== "false",
    },
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
    requestTimeoutMs: num(env.AI_REQUEST_TIMEOUT_MS, 60_000, 1_000, 120_000),
    promptVersion: env.AI_PROMPT_VERSION?.trim() || "eval-criteria-v1",
  };
}

/** Disabled configuration used when nothing is configured (and by tests that do not exercise AI). */
export const AI_DISABLED: AiConfig = loadAiConfig({});
