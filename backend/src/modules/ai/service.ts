/**
 * AI service (AI design §4–§7): status, consent and transcription with the expected terms. The earlier revision
 * answer checks were retired with the old revision systems (docs/Recall-Plan.md §9); their stored history is kept.
 *
 * Invariants (§2.3): this module writes only AiUsage. It never touches
 * learning, demonstration, tasks or schedules, and a provider call never runs inside a database transaction.
 */
import type { PrismaClient } from "@prisma/client";
import type { Clock } from "../../lib/clock.js";
import { HttpError } from "../../lib/http.js";
import type { AiConfig } from "./config.js";
import { transcriptionInstruction } from "./evaluation/prompt.js";
import { type AiProviders, ProviderError, type ProviderUsage, asProviderError, isProviderOutage } from "./providers/types.js";
import { usageService } from "./usage.js";
import { WavError, parseWav } from "./voice/wav.js";

const USAGE_RETENTION_DAYS = 400;

const providerHttpError = (e: ProviderError, op: "TRANSCRIBE" | "EVALUATE" = "EVALUATE") => {
  // The provider is overloaded or down (after the fallback model was tried too): say so, it is not the learner's fault.
  if (isProviderOutage(e)) {
    const what = op === "TRANSCRIBE" ? "Your recording couldn't be transcribed" : "The AI check couldn't run";
    return new HttpError(503, "AI_PROVIDER_BUSY", `${what}: the AI provider is overloaded right now (HTTP ${e.status}). Try again in a few minutes, or carry on without it.`, { retryable: true });
  }
  switch (e.kind) {
    case "TIMEOUT":
      return new HttpError(504, "AI_TIMEOUT", "The AI check took too long. Try again, or carry on without it.", { retryable: true });
    case "RATE_LIMITED":
      return new HttpError(429, "AI_RATE_LIMITED", "The AI provider's limit is reached for now. Carry on without AI, or try again later.", { retryable: true });
    case "INVALID_OUTPUT":
      return new HttpError(502, "AI_INVALID_OUTPUT", "The AI check returned something unusable. Try again, or carry on without it.", { retryable: true });
    default:
      return new HttpError(502, "AI_PROVIDER_ERROR", "The AI service is not available right now. Try again, or carry on without it.", { retryable: true });
  }
};

/** The signed-in user's consent to AI processing (a ConsentRecord, GDPR Art. 7): read and grant. */
export interface AiConsent { get(): Promise<Date | null>; grant(): Promise<Date> }
const NO_CONSENT: AiConsent = { get: async () => null, grant: async () => { throw new HttpError(401, "AUTH_REQUIRED", "Sign in to continue."); } };

/**
 * `usage` must be shared by all requests of one app (its hourly counter lives in memory); routes pass the app's one
 * instance. Without it, a fresh one is used (start-up jobs, tests).
 */
export function aiService(prisma: PrismaClient, clock: Clock, config: AiConfig, providers: AiProviders, consentOf: AiConsent = NO_CONSENT, usage = usageService(prisma, config, () => clock.now())) {

  async function requireReady() {
    if (!config.enabled) throw new HttpError(403, "AI_DISABLED", "AI checks are switched off.");
    if (!(await consentOf.get())) throw new HttpError(403, "AI_CONSENT_REQUIRED", "Read and accept the AI notice first.");
  }

  async function timed<T>(op: "TRANSCRIBE" | "EVALUATE", provider: string, model: string, run: (signal: AbortSignal) => Promise<T & { usage: ProviderUsage }>) {
    const t0 = performance.now();
    try {
      const r = await run(AbortSignal.timeout(config.requestTimeoutMs));
      await usage.record(op, provider, model, r.usage, performance.now() - t0, "OK");
      return { ...r, latencyMs: Math.round(performance.now() - t0) };
    } catch (err) {
      const e = asProviderError(err);
      await usage.record(op, provider, model, {}, performance.now() - t0, e.kind);
      // The cause in the server log (no request content, no key): kind and the provider's HTTP status.
      console.warn(JSON.stringify({ level: "warn", msg: "AI provider error", op, provider, model, kind: e.kind, status: e.status ?? null }));
      throw e;
    }
  }

  /**
   * Calls the main model and, only if the provider reports an outage (HTTP 5xx), the fallback model once. Quota
   * refusals, timeouts and invalid output are not retried: another model would not fix them, or would double the wait.
   * The fallback is a second request: it passes the same limits and is recorded in the usage ledger like any other.
   */
  async function withFallback<T>(
    op: "TRANSCRIBE" | "EVALUATE",
    provider: string,
    model: string,
    fallbackModel: string | null,
    run: (model: string, signal: AbortSignal) => Promise<T & { usage: ProviderUsage }>,
  ) {
    try {
      return { ...(await timed(op, provider, model, (signal) => run(model, signal))), model };
    } catch (e) {
      if (!(e instanceof ProviderError) || !fallbackModel || !isProviderOutage(e)) throw e;
      await usage.check(op, provider);
      console.warn(JSON.stringify({ level: "warn", msg: "AI fallback model", op, from: model, to: fallbackModel, status: e.status ?? null }));
      return { ...(await timed(op, provider, fallbackModel, (signal) => run(fallbackModel, signal))), model: fallbackModel };
    }
  }

  /** `termsOf` gives the words to expect, and optionally the language spoken (a German pack's answers are German). */
  async function transcribeTerms(audio: Buffer, contentType: string | undefined, termsOf: () => Promise<string[] | { terms: string[]; language: string }>) {
    await requireReady();
    if (!/^audio\/(wav|x-wav|wave)\b/i.test(contentType ?? "")) throw new HttpError(415, "AUDIO_UNSUPPORTED", "Send the recording as 16-bit PCM WAV.");
    if (audio.length > config.maxAudioBytes) throw new HttpError(413, "AUDIO_TOO_LARGE", "The recording is too large.");
    let seconds: number;
    try {
      seconds = parseWav(audio).seconds;
    } catch (e) {
      if (e instanceof WavError) throw new HttpError(415, "AUDIO_UNSUPPORTED", "Send the recording as 16-bit PCM WAV.");
      throw e;
    }
    if (seconds < 0.5) throw new HttpError(400, "AUDIO_TOO_SHORT", "The recording is too short. Hold the button while you speak.");
    if (seconds > config.maxRecordingSeconds + 1) throw new HttpError(413, "AUDIO_TOO_LARGE", `Recordings can be at most ${config.maxRecordingSeconds} seconds.`);
    const got = await termsOf();
    const terms = Array.isArray(got) ? got : got.terms;
    const language = (Array.isArray(got) ? null : got.language) || config.language;
    await usage.check("TRANSCRIBE", providers.transcription.name);
    const p = providers.transcription;
    try {
      const r = await withFallback("TRANSCRIBE", p.name, config.transcriptionModel, config.transcriptionFallbackModel, (model, signal) =>
        p.transcribe({ audio, mimeType: "audio/wav", audioSeconds: Math.round(seconds), instruction: transcriptionInstruction(language, terms), language, vocabulary: terms, model, signal }),
      );
      return { text: r.text.slice(0, 5000), audioSeconds: Math.round(seconds * 10) / 10 };
    } catch (e) {
      if (e instanceof ProviderError) throw providerHttpError(e, "TRANSCRIBE");
      throw e;
    }
    // The audio buffer goes out of scope here; it is never written anywhere (I-5).
  }

  return {
    async status() {
      const consentedAt = await consentOf.get();
      const u = config.enabled ? await usage.summary(providers.evaluation.name) : { spentThisMonthEur: 0, requestsLast24h: 0 };
      return {
        enabled: config.enabled,
        consented: !!consentedAt,
        consentedAt: consentedAt?.toISOString() ?? null,
        evaluationProvider: config.evaluationProvider,
        transcriptionProvider: config.transcriptionProvider,
        evaluationModel: config.evaluationModel,
        transcriptionModel: config.transcriptionModel,
        evaluationFallbackModel: config.evaluationFallbackModel,
        transcriptionFallbackModel: config.transcriptionFallbackModel,
        maxRecordingSeconds: config.maxRecordingSeconds,
        maxAudioBytes: config.maxAudioBytes,
        maxFollowUps: config.maxFollowUps,
        dailyRequestLimit: config.dailyRequestLimit,
        requestsLast24h: u.requestsLast24h,
        monthlyBudgetEur: config.monthlyBudgetEur,
        spentThisMonthEur: u.spentThisMonthEur,
      };
    },

    async consent() {
      return { consentedAt: (await consentOf.grant()).toISOString() };
    },

    transcribeTerms,

    /**
     * Startup housekeeping (§8.3): usage rows older than the retention period go. The retired answer checks
     * (RevisionEvaluation) are history now and are no longer touched.
     */
    async cleanup() {
      const now = clock.now().getTime();
      const usageRemoved = await prisma.aiUsage.deleteMany({ where: { at: { lt: new Date(now - USAGE_RETENTION_DAYS * 86_400_000) } } });
      return { usage: usageRemoved.count };
    },
  };
}

export type AiService = ReturnType<typeof aiService>;
