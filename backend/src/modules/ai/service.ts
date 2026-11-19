/**
 * AI service (AI design §4–§7): transcription, answer checking with one optional follow-up, status and consent.
 *
 * Invariants (§2.3): this module writes only RevisionEvaluation, AiUsage and Settings.aiConsentAt. It never touches
 * learning, demonstration, tasks or schedules, and a provider call never runs inside a database transaction.
 */
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { evaluationPresentation, suggestionPresentation, verdictPresentation } from "../../domain/presentation.js";
import type { Clock } from "../../lib/clock.js";
import { HttpError, notFound } from "../../lib/http.js";
import { resolvePrompt } from "../revision/service.js";
import type { AiConfig } from "./config.js";
import { splitCriteria } from "./evaluation/criteria.js";
import { SYSTEM_PROMPT, buildUserPrompt, transcriptionInstruction, vocabulary } from "./evaluation/prompt.js";
import { EvaluationResult, evaluationJsonSchema } from "./evaluation/schema.js";
import { suggestScore, suggestedMistakes } from "./evaluation/score.js";
import { VerificationError, type VerifiedCriterion, type VerifiedResult, verifyResult } from "./evaluation/verify.js";
import { type AiProviders, ProviderError, type ProviderUsage, asProviderError, isProviderOutage } from "./providers/types.js";
import { usageService } from "./usage.js";
import { WavError, parseWav } from "./voice/wav.js";

const UNLINKED_RETENTION_DAYS = 30;
const USAGE_RETENTION_DAYS = 400;

export interface EvaluateInput {
  scheduleId: number;
  promptId?: number;
  templateKey?: string;
  transcript: string;
  parentId?: number;
}

/** Stored in RevisionEvaluation.result for a SUCCEEDED evaluation. */
interface StoredResult {
  relevant: boolean;
  criteria: VerifiedCriterion[];
  misconceptions: VerifiedResult["misconceptions"];
  feedback: string;
  followUpQuestion: string | null;
  suggestedMistakes: string;
  assisted: boolean;
  rootId: number;
  downgraded: number;
}

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

type EvalRow = Prisma.RevisionEvaluationGetPayload<object>;

export function evaluationDTO(e: EvalRow, maxFollowUps: number, depth: number) {
  const r = e.result as unknown as StoredResult | null;
  return {
    id: e.id,
    parentId: e.parentId,
    rootId: r?.rootId ?? e.id,
    status: e.status,
    presentation: evaluationPresentation(e.status),
    errorCode: e.errorCode,
    transcript: e.transcript,
    suggestedScore: e.suggestedScore,
    suggestion: suggestionPresentation(e.suggestedScore),
    relevant: r?.relevant ?? null,
    criteria: (r?.criteria ?? []).map((c) => ({
      index: c.index, text: c.text, verdict: c.verdict, presentation: verdictPresentation(c.verdict), evidence: c.evidence, recoveredInFollowUp: c.recoveredInFollowUp,
    })),
    misconceptions: r?.misconceptions ?? [],
    feedback: r?.feedback ?? "",
    followUpQuestion: depth < maxFollowUps ? (r?.followUpQuestion ?? null) : null,
    suggestedMistakes: r?.suggestedMistakes ?? "",
    assisted: r?.assisted ?? false,
    createdAt: e.createdAt.toISOString(),
  };
}

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

  /**
   * The unit's names and question texts, for transcription spelling hints. A sub-topic unit also gets its topic's
   * curriculum question, which holds most of the topic's technical terms (its own prompts are mostly templates).
   */
  async function unitTerms(scheduleId: number) {
    const s = await prisma.revisionSchedule.findUnique({
      where: { id: scheduleId },
      include: { topic: { select: { name: true } }, subtopic: { select: { name: true } } },
    });
    if (!s) return [];
    const select = { content: true, expectedAnswer: true } as const;
    const own = await prisma.revisionPrompt.findMany({ where: { topicId: s.topicId, subtopicId: s.subtopicId, isActive: true }, select, orderBy: { id: "asc" }, take: 5 });
    const topic =
      s.subtopicId === null
        ? []
        : await prisma.revisionPrompt.findMany({ where: { topicId: s.topicId, subtopicId: null, source: "CURRICULUM", isActive: true }, select, orderBy: { id: "asc" }, take: 2 });
    return vocabulary([s.topic.name, s.subtopic?.name ?? "", ...[...own, ...topic].flatMap((p) => [p.content, p.expectedAnswer])]);
  }

  async function ancestors(e: EvalRow) {
    const chain: EvalRow[] = [];
    let cur: EvalRow | null = e;
    while (cur?.parentId) {
      cur = await prisma.revisionEvaluation.findUnique({ where: { id: cur.parentId } });
      if (cur) chain.unshift(cur);
    }
    return chain;
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

    async transcribe(scheduleId: number, audio: Buffer, contentType: string | undefined) {
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
      const schedule = await prisma.revisionSchedule.findUnique({ where: { id: scheduleId }, select: { id: true } });
      if (!schedule) throw notFound("Revision unit");
      await usage.check("TRANSCRIBE", providers.transcription.name);
      const terms = await unitTerms(scheduleId);
      const p = providers.transcription;
      try {
        const r = await withFallback("TRANSCRIBE", p.name, config.transcriptionModel, config.transcriptionFallbackModel, (model, signal) =>
          p.transcribe({ audio, mimeType: "audio/wav", audioSeconds: Math.round(seconds), instruction: transcriptionInstruction(config.language, terms), language: config.language, vocabulary: terms, model, signal }),
        );
        return { text: r.text.slice(0, 5000), audioSeconds: Math.round(seconds * 10) / 10 };
      } catch (e) {
        if (e instanceof ProviderError) throw providerHttpError(e, "TRANSCRIBE");
        throw e;
      }
      // The audio buffer goes out of scope here; it is never written anywhere (I-5).
    },

    async evaluate(input: EvaluateInput) {
      await requireReady();
      const transcript = input.transcript.trim();
      if (!transcript) throw new HttpError(400, "VALIDATION_ERROR", "There is no answer to check yet.");

      const schedule = await prisma.revisionSchedule.findUnique({ where: { id: input.scheduleId } });
      if (!schedule || schedule.suspendedAt) throw new HttpError(409, "NOT_ELIGIBLE", "This isn't ready for revision.");

      let parent: EvalRow | null = null;
      let chain: EvalRow[] = [];
      if (input.parentId !== undefined) {
        parent = await prisma.revisionEvaluation.findUnique({ where: { id: input.parentId } });
        if (!parent || parent.scheduleId !== schedule.id) throw notFound("AI check");
        if (parent.status !== "SUCCEEDED") throw new HttpError(409, "EVALUATION_STALE", "The first AI check did not finish.");
        chain = [...(await ancestors(parent)), parent];
        if (chain.length > config.maxFollowUps) throw new HttpError(409, "AI_FOLLOW_UP_LIMIT", "No more follow-up questions for this answer.");
        if (!(parent.result as unknown as StoredResult).followUpQuestion) throw new HttpError(409, "AI_FOLLOW_UP_LIMIT", "There is no follow-up question to answer.");
      }
      const root = chain[0] ?? null;

      // The rubric comes from the stored prompt, never from the client (§6.1). For a follow-up it is the root's snapshot.
      let promptText: string;
      let criteriaText: string;
      let promptId: number | null;
      let retrievalMethod: string;
      if (root) {
        promptText = root.promptText;
        criteriaText = root.criteriaText;
        promptId = root.promptId;
        retrievalMethod = (await prisma.revisionPrompt.findUnique({ where: { id: root.promptId ?? -1 }, select: { retrievalMethod: true } }))?.retrievalMethod ?? "CONCEPTUAL";
      } else {
        if ((input.promptId === undefined) === (input.templateKey === undefined)) throw new HttpError(400, "VALIDATION_ERROR", "Provide exactly one of promptId or templateKey");
        const prompt = await prisma.$transaction((tx) => resolvePrompt(tx, schedule, input.promptId, input.templateKey));
        promptText = prompt.content;
        criteriaText = prompt.expectedAnswer;
        promptId = prompt.id;
        retrievalMethod = prompt.retrievalMethod;
      }
      const criteria = splitCriteria(criteriaText);
      if (criteria.length === 0) throw new HttpError(409, "AI_NO_CRITERIA", "This question has no expected points to check against. Add them to the prompt first.");

      const followUpQuestion = parent ? (parent.result as unknown as StoredResult).followUpQuestion! : null;
      const inputHash = createHash("sha256")
        .update(JSON.stringify([config.promptVersion, providers.evaluation.name, config.evaluationModel, promptText, criteria, transcript, followUpQuestion, parent?.id ?? null]))
        .digest("hex");
      const depth = chain.length;

      await usage.check("EVALUATE", providers.evaluation.name);

      // Reserve the work (§7.1). A repeat of the same answer returns the stored result and costs nothing.
      let row: EvalRow;
      try {
        row = await prisma.revisionEvaluation.create({
          data: {
            scheduleId: schedule.id, promptId, parentId: parent?.id ?? null, inputHash, promptText, criteriaText, transcript,
            followUpQuestion, provider: providers.evaluation.name, model: config.evaluationModel, promptVersion: config.promptVersion,
          },
        });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
        const existing = await prisma.revisionEvaluation.findUniqueOrThrow({ where: { scheduleId_inputHash: { scheduleId: schedule.id, inputHash } } });
        if (existing.status === "SUCCEEDED") return evaluationDTO(existing, config.maxFollowUps, depth);
        const staleBefore = new Date(clock.now().getTime() - config.requestTimeoutMs - 10_000);
        const reset = await prisma.revisionEvaluation.updateMany({
          where: { id: existing.id, OR: [{ status: "FAILED" }, { status: "PENDING", createdAt: { lt: staleBefore } }] },
          data: { status: "PENDING", errorCode: null, createdAt: clock.now(), completedAt: null },
        });
        if (reset.count === 0) throw new HttpError(409, "EVALUATION_IN_PROGRESS", "This answer is already being checked.", { retryable: true });
        row = { ...existing, status: "PENDING" };
      }

      const fail = async (code: string) => {
        await prisma.revisionEvaluation.update({ where: { id: row.id }, data: { status: "FAILED", errorCode: code, completedAt: clock.now() } });
      };

      const parentResult = parent ? (parent.result as unknown as StoredResult) : null;
      const fullAnswer = [root?.transcript ?? null, ...chain.slice(1).map((c) => c.transcript), transcript].filter((x): x is string => !!x).join("\n");
      const p = providers.evaluation;
      let output: unknown;
      let latencyMs: number;
      let usedModel = config.evaluationModel;
      try {
        const r = await withFallback("EVALUATE", p.name, config.evaluationModel, config.evaluationFallbackModel, (model, signal) =>
          p.evaluate({
            system: SYSTEM_PROMPT,
            user: buildUserPrompt({
              promptText, retrievalMethod, criteria,
              answer: root ? [root.transcript, ...chain.slice(1).map((c) => c.transcript)].join("\n") : transcript,
              followUp: parent && parentResult ? { question: followUpQuestion!, answer: transcript, previous: parentResult.criteria.map((c) => ({ index: c.index, verdict: c.verdict })) } : undefined,
            }),
            jsonSchema: evaluationJsonSchema(),
            model,
            signal,
          }),
        );
        output = r.output;
        latencyMs = r.latencyMs;
        usedModel = r.model;
      } catch (e) {
        if (e instanceof ProviderError) {
          await fail(providerHttpError(e).code);
          throw providerHttpError(e);
        }
        await fail("AI_PROVIDER_ERROR");
        throw e;
      }

      const parsed = EvaluationResult.safeParse(output);
      let verified: VerifiedResult;
      try {
        if (!parsed.success) throw new VerificationError("Output does not match the schema");
        verified = verifyResult(parsed.data, criteria, fullAnswer);
      } catch (e) {
        if (!(e instanceof VerificationError)) throw e;
        await fail("AI_INVALID_OUTPUT");
        throw providerHttpError(new ProviderError("INVALID_OUTPUT", e.message));
      }

      // Follow-up (§4.4): what was recovered only after the question counts as assisted; the suggestion stays the
      // one from the original answer, and the existing rule turns an assisted 3 into a 2 for scheduling.
      let suggestedScore: number;
      let mistakes: string;
      let assisted = false;
      const criteriaOut = verified.criteria.map((c) => ({ ...c }));
      if (parentResult && root) {
        const rootResult = root.result as unknown as StoredResult;
        const before = new Map(parentResult.criteria.map((c) => [c.index, c.verdict]));
        const rank = { MISSING: 0, INCORRECT: 0, PARTIAL: 1, COVERED: 2 } as const;
        for (const c of criteriaOut) {
          const was = before.get(c.index) ?? "MISSING";
          if (rank[c.verdict] > rank[was]) c.recoveredInFollowUp = true;
        }
        assisted = criteriaOut.some((c) => c.recoveredInFollowUp) || parentResult.assisted;
        suggestedScore = root.suggestedScore!;
        const recovered = criteriaOut.filter((c) => c.recoveredInFollowUp).map((c) => c.text);
        mistakes = [rootResult.suggestedMistakes, recovered.length ? `Recalled only after the follow-up question: ${recovered.join("; ")}.` : ""].filter(Boolean).join(" ");
      } else {
        suggestedScore = suggestScore({ relevant: verified.relevant, verdicts: verified.criteria.map((c) => c.verdict), misconceptions: verified.misconceptions.length });
        mistakes = suggestedMistakes(verified.criteria, verified.misconceptions);
      }
      const stored: StoredResult = {
        relevant: verified.relevant,
        criteria: criteriaOut,
        misconceptions: verified.misconceptions,
        feedback: verified.feedback,
        followUpQuestion: depth + 1 <= config.maxFollowUps ? verified.followUpQuestion : null,
        suggestedMistakes: mistakes,
        assisted,
        rootId: root?.id ?? row.id,
        downgraded: verified.downgraded,
      };
      const done = await prisma.revisionEvaluation.update({
        where: { id: row.id },
        // The model that actually answered (the fallback when the main model was overloaded).
        data: { status: "SUCCEEDED", result: stored as unknown as Prisma.InputJsonValue, suggestedScore, latencyMs, model: usedModel, completedAt: clock.now() },
      });
      return evaluationDTO(done, config.maxFollowUps, depth);
    },

    /** Startup housekeeping (§8.3): unfinished checks become FAILED; old unlinked checks and old usage rows go. */
    async cleanup() {
      const now = clock.now().getTime();
      await prisma.revisionEvaluation.updateMany({ where: { status: "PENDING" }, data: { status: "FAILED", errorCode: "AI_TIMEOUT", completedAt: new Date(now) } });
      const cut = new Date(now - UNLINKED_RETENTION_DAYS * 86_400_000);
      const removed = await prisma.revisionEvaluation.deleteMany({ where: { parentId: null, attempt: null, createdAt: { lt: cut } } });
      const usageRemoved = await prisma.aiUsage.deleteMany({ where: { at: { lt: new Date(now - USAGE_RETENTION_DAYS * 86_400_000) } } });
      return { evaluations: removed.count, usage: usageRemoved.count };
    },

    unitTerms,
  };
}

export type AiService = ReturnType<typeof aiService>;
