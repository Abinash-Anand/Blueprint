/**
 * Recall (docs/Recall-Plan.md, phase 1): the due list, a review from the blank slate to the results, the hidden locked
 * checklist, grading in the background, and the schedule. The AI writes the checklist once and labels each point of an
 * explanation; everything else is code (rules.ts).
 *
 * - Every query goes through the city-scoped client the route passes in; background work opens its own city scope.
 * - Checklist points reach the client only after the review is checked (they are the answers).
 * - Grading uses the checklist's pinned model at temperature 0 and never switches model: when the provider is busy it
 *   waits and retries; invalid output is retried once, then the learner can check again.
 * - Recordings are transcribed and dropped; only their text is kept.
 */
import type { Prisma, PrismaClient, RecallChecklist, RecallPoint, RecallReview } from "@prisma/client";
import { d2i, i2d } from "../../db.js";
import { type ISODate, addDays, diffDays } from "../../domain/dates.js";
import type { Clock } from "../../lib/clock.js";
import { cityScoped } from "../../lib/cityScope.js";
import { HttpError, notFound } from "../../lib/http.js";
import type { AiConfig } from "../ai/config.js";
import { jobCaller } from "../ai/jobCaller.js";
import { type AiProviders, ProviderError, asProviderError, isProviderOutage } from "../ai/providers/types.js";
import type { UsageService } from "../ai/usage.js";
import type { AuthService } from "../auth/service.js";
import {
  CHECKLIST_PROMPT_VERSION, ChecklistReply, type Context, GRADE_PROMPT_VERSION, GradeReplySchema, type Language, NarrativeReply,
  ProbeReply, SKETCH_PROMPT_VERSION, SketchReply, VERDICT_PROMPT_VERSION, VerdictReply, checklistJsonSchema, checklistPrompt,
  curriculumLanguage, gradeJsonSchema, gradePrompt, narrativeJsonSchema, narrativePrompt, probeJsonSchema, probePrompt, sketchJsonSchema, sketchPrompt,
  toDraft, toGradeReply, verdictJsonSchema, verdictPrompt,
} from "./prompts.js";
import { completeRecallTask, syncRecallTasks } from "./tasks.js";
import {
  type AttemptView, type Depth, GradeError, type PointStatus, checklistProblems, computeSessionDiff, cuedRating, dailyLimit, depthOf, imageType, nextSchedule, outcomeOf,
  recallScore, tierShares, verifyGrade,
} from "./rules.js";

export const RECALL = {
  /** An explanation needs a few words to be worth checking. */
  minChars: 20,
  maxChars: 20_000,
  maxParts: 20,
  /** Waits before checking again while the grading model is busy (about an hour in all), then the learner retries. */
  retryDelaysMs: [10_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_200_000, 1_200_000],
  upcomingDays: 14,
  /** Phase 3: sketches per recall, and the largest photo. */
  maxSketches: 3,
  maxSketchBytes: 5 * 1024 * 1024,
  /** Phase 2: the follow-up answer. */
  minAnswerChars: 4,
} as const;

export interface RecallDeps {
  prisma: PrismaClient;
  clock: Clock;
  ai: { config: AiConfig; providers: AiProviders };
  usage: UsageService;
  auth: AuthService;
  /** Overridable in tests: how long to wait before the next grading try. */
  retryDelaysMs?: readonly number[];
}

const parts = (v: Prisma.JsonValue): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const misconceptionsOf = (v: Prisma.JsonValue): { claim: string; correction: string }[] =>
  Array.isArray(v) ? (v as { claim: string; correction: string }[]) : [];
/** The text that is graded: the spoken parts in order, then what was typed. */
/** The text that is graded: the spoken parts in order, what was typed, then each sketch as "[SKETCH n]: …" (phase 3). */
export const explanationOf = (spoken: string[], typed: string, sketches: string[] = []) =>
  [...spoken, typed, ...sketches.map((x, i) => `[SKETCH ${i + 1}]: ${x.trim()}`)].map((x) => x.trim()).filter(Boolean).join("\n\n");
const sketchesOf = (v: Prisma.JsonValue): string[] =>
  Array.isArray(v) ? v.map((x) => (x && typeof x === "object" && "description" in x ? String((x as { description: unknown }).description) : "")).filter(Boolean) : [];

export function recallService(d: RecallDeps) {
  const { config, providers } = d.ai;
  const today = () => d.clock.today();
  const delays = d.retryDelaysMs ?? RECALL.retryDelaysMs;
  /** Reviews being graded in this process, so a review is never graded twice at once. */
  const grading = new Set<number>();
  /** Reviews being started in this process, by sub-topic (sub-topic ids are unique across cities). */
  const starting = new Map<number, Promise<ReturnType<typeof reviewDTO>>>();

  async function availability(userId: string) {
    const consented = !!(await d.auth.hasConsent(userId, "AI_PROCESSING"));
    const reason = !config.enabled ? "AI_DISABLED" : !providers.generation ? "NO_PROVIDER" : !consented ? "CONSENT_REQUIRED" : null;
    return { available: reason === null, reason, consented, provider: config.generationProvider, model: config.recallModel };
  }
  async function requireAi(userId: string) {
    const a = await availability(userId);
    if (a.reason === "AI_DISABLED" || a.reason === "NO_PROVIDER") throw new HttpError(403, "AI_DISABLED", "Recall needs the AI check, which is switched off on this server.");
    if (a.reason === "CONSENT_REQUIRED") throw new HttpError(403, "AI_CONSENT_REQUIRED", "Read and accept the AI notice first.");
  }

  async function subtopicOf(db: PrismaClient, subtopicId: number) {
    const s = await db.subtopic.findUnique({
      where: { id: subtopicId },
      include: { topic: { include: { district: { select: { name: true } }, subtopics: { select: { id: true, name: true }, orderBy: { position: "asc" } } } }, recallState: true },
    });
    if (!s) throw notFound("Sub-topic");
    return s;
  }

  /* ---------------- the checklist ---------------- */

  const currentChecklist = (db: PrismaClient, subtopicId: number) =>
    db.recallChecklist.findFirst({ where: { subtopicId }, orderBy: { version: "desc" }, include: { points: { orderBy: { position: "asc" } } } });

  /** Builds and locks a sub-topic's checklist (§4): one repair round, then a clear error. Runs before the first review. */
  async function buildChecklist(db: PrismaClient, cityId: string, subtopicId: number) {
    const s = await subtopicOf(db, subtopicId);
    const city = await d.prisma.city.findUniqueOrThrow({ where: { id: cityId }, select: { name: true, goal: true } });
    const others = s.topic.subtopics.filter((x) => x.id !== s.id).map((x) => x.name);
    const language: Language = curriculumLanguage([city.name, city.goal, s.topic.district.name, s.topic.name, s.topic.description, ...s.topic.subtopics.map((x) => x.name)]);
    const input = { city: city.name, district: s.topic.district.name, topic: s.topic.name, topicDescription: s.topic.description, subtopic: s.name, otherSubtopics: others, language };
    await d.usage.check("RECALL", providers.generation!.name, config.generationDailyLimit, 2);
    const caller = jobCaller({ config, provider: providers.generation!, usage: d.usage, op: "RECALL", notice: async () => {} });
    let problems: string[] = [];
    for (let round = 0; round < 2; round++) {
      let draft;
      try {
        const out = await caller.call({ name: "recall_checklist", label: CHECKLIST_PROMPT_VERSION }, checklistPrompt(input, problems), checklistJsonSchema, 3000);
        const parsed = ChecklistReply.safeParse(out);
        if (!parsed.success) { problems = ["the reply did not match the JSON shape"]; continue; }
        draft = toDraft(parsed.data);
      } catch (e) {
        const err = asProviderError(e);
        if (err.kind === "INVALID_OUTPUT" && round === 0) { problems = ["the reply was not valid JSON"]; continue; }
        throw new HttpError(503, "AI_UNAVAILABLE", "This sub-topic's checklist couldn't be prepared right now. Try again in a few minutes.", { retryable: true });
      }
      problems = checklistProblems(draft, others);
      if (problems.length) continue;
      const last = await db.recallChecklist.findFirst({ where: { subtopicId }, orderBy: { version: "desc" }, select: { version: true } });
      return d.prisma.$transaction(async (tx) => {
        const c = await tx.recallChecklist.create({
          data: {
            cityId, subtopicId, version: (last?.version ?? 0) + 1, provider: providers.generation!.name, model: caller.used().join(" + ") || config.generationModel,
            gradingModel: config.recallModel, promptVersion: CHECKLIST_PROMPT_VERSION, language, lockedAt: d.clock.now(),
          },
        });
        await tx.recallPoint.createMany({
          data: draft.map((p, i) => ({ cityId, checklistId: c.id, code: `c${i + 1}`, position: i, label: p.label, description: p.description, tier: p.tier, weight: p.tier })),
        });
        return tx.recallChecklist.findUniqueOrThrow({ where: { id: c.id }, include: { points: { orderBy: { position: "asc" } } } });
      });
    }
    console.warn(JSON.stringify({ level: "warn", msg: "Recall checklist rejected", problems: problems.slice(0, 5) }));
    throw new HttpError(503, "CHECKLIST_FAILED", "This sub-topic's checklist couldn't be prepared. Try again later.", { retryable: true });
  }

  /* ---------------- grading ---------------- */

  /** One grading call with the pinned model at temperature 0; usage recorded. Never another model. */
  async function gradeOnce(checklist: RecallChecklist & { points: RecallPoint[] }, subtopic: string, topic: string, explanation: string, only?: RecallPoint[]) {
    const scored = only ?? checklist.points.filter((p) => !p.leftOutAt);
    const prompt = gradePrompt({ subtopic, topic, explanation, language: checklist.language as Language, points: scored.map((p) => ({ code: p.code, label: p.label, description: p.description })) });
    await d.usage.check("RECALL", providers.generation!.name, config.generationDailyLimit, 1);
    const t0 = performance.now();
    let output: unknown;
    try {
      const r = await providers.generation!.generate({
        ...prompt, jsonSchema: gradeJsonSchema, model: checklist.gradingModel, name: "recall_grade", maxTokens: 4000, temperature: 0,
        signal: AbortSignal.timeout(config.generationTimeoutMs),
      });
      await d.usage.record("RECALL", providers.generation!.name, checklist.gradingModel, r.usage, performance.now() - t0, "OK");
      output = r.output;
    } catch (e) {
      const err = asProviderError(e);
      await d.usage.record("RECALL", providers.generation!.name, checklist.gradingModel, {}, performance.now() - t0, err.kind);
      console.warn(JSON.stringify({ level: "warn", msg: "AI provider error", op: "RECALL", model: checklist.gradingModel, kind: err.kind, status: err.status ?? null }));
      throw err;
    }
    // The checks in code (§5.4): a reply that fails them counts as invalid output.
    const parsed = GradeReplySchema.safeParse(output);
    if (!parsed.success) throw new ProviderError("INVALID_OUTPUT", "The grading reply did not match its shape");
    try {
      return verifyGrade(toGradeReply(parsed.data), scored.map((p) => p.code), explanation);
    } catch (e) {
      if (e instanceof GradeError) throw new ProviderError("INVALID_OUTPUT", e.message);
      throw e;
    }
  }

  /** Applies a verified grade to the review and the schedule (§6), in one transaction. */
  async function applyGrade(cityId: string, review: RecallReview, checklist: RecallChecklist & { points: RecallPoint[] }, graded: Awaited<ReturnType<typeof gradeOnce>>) {
    const db = cityScoped(d.prisma, cityId);
    const scored = checklist.points.filter((p) => !p.leftOutAt);
    const status = new Map(graded.points.map((p) => [p.code, p]));
    const points = scored.map((p) => ({ tier: p.tier, weight: p.weight, status: status.get(p.code)!.status as PointStatus }));
    const score = recallScore(points, graded.misconceptions.length);
    const outcome = outcomeOf(score, graded.misconceptions.length);
    const state = await db.recallState.findUnique({ where: { subtopicId: review.subtopicId } });
    const stageBefore = state?.stage ?? 0;
    const reviewed = d2i(review.date);
    const next = nextSchedule(stageBefore, outcome, reviewed);
    await d.prisma.$transaction(async (tx) => {
      await tx.recallPointResult.deleteMany({ where: { reviewId: review.id } });
      await tx.recallPointResult.createMany({
        data: scored.map((p) => ({ cityId, reviewId: review.id, pointId: p.id, status: status.get(p.code)!.status, evidence: status.get(p.code)!.evidence })),
      });
      await tx.recallReview.update({
        where: { id: review.id },
        data: {
          status: "CHECKED", gradingModel: checklist.gradingModel, promptVersion: GRADE_PROMPT_VERSION, score, depth: depthOf(points), outcome,
          misconceptions: graded.misconceptions as unknown as Prisma.InputJsonValue, stageBefore, stageAfter: next.stage, nextDueDate: i2d(next.nextDueDate),
          waitReason: null, checkedAt: d.clock.now(),
        },
      });
      const st = await tx.recallState.upsert({
        where: { subtopicId: review.subtopicId },
        create: { cityId, subtopicId: review.subtopicId, stage: next.stage, nextDueDate: i2d(next.nextDueDate), lastReviewDate: review.date, lastGapDays: next.gap },
        update: { stage: next.stage, nextDueDate: i2d(next.nextDueDate), lastReviewDate: review.date, lastGapDays: next.gap },
      });
      // The recall task is done by this check; the next one is planned below.
      await completeRecallTask(tx, st.id, reviewed, d.clock.now());
    });
    await syncRecallTasks(db, today());
    if (graded.rejectedQuotes) console.log(JSON.stringify({ level: "info", msg: "Recall quotes rejected", count: graded.rejectedQuotes }));
  }

  /** Grades a sent review in the background: retries while the model is busy, once on invalid output, then waits for the learner. */
  async function runGrade(cityId: string, reviewId: number) {
    if (grading.has(reviewId)) return;
    grading.add(reviewId);
    const db = cityScoped(d.prisma, cityId);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      let invalid = 0;
      for (let attempt = 0; ; attempt++) {
        const review = await db.recallReview.findUnique({ where: { id: reviewId }, include: { checklist: { include: { points: { orderBy: { position: "asc" } } } }, subtopic: { include: { topic: { select: { name: true } } } } } });
        if (!review || review.status !== "WAITING") return;
        try {
          const graded = await gradeOnce(review.checklist, review.subtopic.name, review.subtopic.topic.name, review.explanation);
          await applyGrade(cityId, review, review.checklist, graded);
          return;
        } catch (e) {
          const err = e instanceof HttpError ? null : asProviderError(e);
          const busy = !!err && (isProviderOutage(err) || err.kind === "TIMEOUT" || err.kind === "RATE_LIMITED");
          if (err?.kind === "INVALID_OUTPUT" && invalid++ < 1) continue;
          const reason = busy ? "The AI is busy right now; your recall will be checked as soon as it answers." : err?.kind === "INVALID_OUTPUT" ? "The check returned something unusable. Try again." : e instanceof HttpError ? e.message : "The check couldn't run. Try again.";
          await db.recallReview.update({ where: { id: reviewId }, data: { waitReason: reason } });
          if (!busy || attempt >= delays.length) return;
          await wait(delays[attempt]);
        }
      }
    } finally {
      grading.delete(reviewId);
    }
  }

  /* ---------------- phase 2: the senior engineer and progress over time ---------------- */

  const contextOf = (r: ReviewRow): Context => ({ district: r.subtopic.topic.district.name, topic: r.subtopic.topic.name, subtopic: r.subtopic.name, language: r.checklist.language as Language });

  /** One structured call with the generation model; usage recorded; errors as ProviderError. */
  async function generateJson(name: string, model: string, prompt: { system: string; user: string }, jsonSchema: Record<string, unknown>, maxTokens: number, temperature: number, images?: { mimeType: string; data: Buffer }[]) {
    await d.usage.check("RECALL", providers.generation!.name, config.generationDailyLimit, 1);
    const t0 = performance.now();
    try {
      const r = await providers.generation!.generate({ ...prompt, jsonSchema, model, name, maxTokens, temperature, images, signal: AbortSignal.timeout(config.generationTimeoutMs) });
      await d.usage.record("RECALL", providers.generation!.name, model, r.usage, performance.now() - t0, "OK");
      return r.output;
    } catch (e) {
      const err = asProviderError(e);
      await d.usage.record("RECALL", providers.generation!.name, model, {}, performance.now() - t0, err.kind);
      console.warn(JSON.stringify({ level: "warn", msg: "AI provider error", op: "RECALL", stage: name, model, kind: err.kind, status: err.status ?? null }));
      throw err;
    }
  }
  const unavailable = (what: string) => new HttpError(503, "AI_UNAVAILABLE", `${what} couldn't be written right now: the AI is busy or unreachable. Try again in a moment.`, { retryable: true });

  /** The points of a checked review by status (points left out are not counted). */
  function byStatus(r: ReviewRow) {
    const res = new Map(r.results.map((x) => [x.pointId, x]));
    const counted = r.checklist.points.filter((p) => !p.leftOutAt && res.has(p.id));
    const of = (s: PointStatus) => counted.filter((p) => res.get(p.id)!.status === s);
    return { res, counted, accurate: of("ACCURATE"), partial: of("PARTIAL"), missed: of("MISSED") };
  }

  /** The verdict (§3.4): written by the model from the results; the cued-reasoning rating is worked out in code. */
  async function writeVerdict(r: ReviewRow): Promise<SeniorVerdict | null> {
    const { res, accurate, partial, missed } = byStatus(r);
    const recalled = missed.filter((p) => res.get(p.id)!.recalledWhenAsked);
    const answered = !!r.followupAnswer;
    try {
      const out = await generateJson("recall_verdict", config.generationModel, verdictPrompt({
        context: contextOf(r), scorePercent: Math.round((r.score ?? 0) * 100), depth: r.depth ?? "", outcome: r.outcome ?? "",
        accurate: accurate.map((p) => p.label), partial: partial.map((p) => p.label), missed: missed.map((p) => p.label), misconceptions: misconceptionsOf(r.misconceptions),
        followup: answered && r.followupQuestion ? { question: r.followupQuestion, answer: r.followupAnswer!, recalledWhenAsked: recalled.map((p) => p.label) } : null,
      }), verdictJsonSchema, 1500, 0.2);
      const v = VerdictReply.parse(out);
      return { ...v, cuedReasoningRating: cuedRating(missed.length, recalled.length, answered), recalledWhenAsked: recalled.map((p) => p.label), promptVersion: VERDICT_PROMPT_VERSION, model: config.generationModel };
    } catch (e) {
      console.warn(JSON.stringify({ level: "warn", msg: "Recall verdict not written", error: String((e as Error)?.message ?? e).slice(0, 200) }));
      return null;
    }
  }

  /** The analysis over time (§7): the diff in code; a short summary from the diff only. Runs in the background. */
  async function runAnalysis(cityId: string, reviewId: number) {
    const db = cityScoped(d.prisma, cityId);
    try {
      const r = (await db.recallReview.findUnique({ where: { id: reviewId }, include: reviewInclude })) as ReviewRow | null;
      if (!r || r.status !== "COMPLETE") return;
      const reviews = await db.recallReview.findMany({
        where: { subtopicId: r.subtopicId, checklistId: r.checklistId, status: "COMPLETE", attempt: { lte: r.attempt } },
        orderBy: { attempt: "asc" },
        include: { results: { select: { pointId: true, status: true, recalledWhenAsked: true } } },
      });
      if (reviews.length < 2) return;
      const history: AttemptView[] = reviews.map((x) => ({
        attempt: x.attempt, date: d2i(x.date), score: x.score ?? 0, depth: (x.depth ?? "FOUNDATIONAL") as Depth,
        points: Object.fromEntries(x.results.map((p) => [p.pointId, { status: p.status as PointStatus, recalledWhenAsked: p.recalledWhenAsked }])),
        misconceptions: misconceptionsOf(x.misconceptions),
      }));
      const labels = new Map(r.checklist.points.filter((p) => !p.leftOutAt).map((p) => [p.id, p.label]));
      const diff = computeSessionDiff(history, labels);
      let narrative = "";
      let model: string | null = null;
      try {
        const out = await generateJson("recall_narrative", config.recallNarrativeModel, narrativePrompt(contextOf(r), diff), narrativeJsonSchema, 800, 0.2);
        narrative = NarrativeReply.parse(out).sentences.map((x) => x.trim()).join(" ");
        model = config.recallNarrativeModel;
      } catch {
        /* the computed diff is shown without a summary */
      }
      await d.prisma.recallAnalysis.upsert({
        where: { reviewId },
        create: { cityId, reviewId, subtopicId: r.subtopicId, attempt: r.attempt, diffPayload: diff as unknown as Prisma.InputJsonValue, narrative, model },
        update: { diffPayload: diff as unknown as Prisma.InputJsonValue, narrative, model },
      });
    } catch (e) {
      console.warn(JSON.stringify({ level: "warn", msg: "Recall analysis failed", error: String((e as Error)?.message ?? e).slice(0, 200) }));
    }
  }

  /* ---------------- views ---------------- */

  type ReviewRow = RecallReview & {
    subtopic: { name: string; topic: { id: string; name: string; district: { name: string } } };
    checklist: RecallChecklist & { points: RecallPoint[] };
    results: { pointId: number; status: PointStatus; evidence: string | null; recalledWhenAsked: boolean }[];
  };
  const reviewInclude = {
    subtopic: { select: { name: true, topic: { select: { id: true, name: true, district: { select: { name: true } } } } } },
    checklist: { include: { points: { orderBy: { position: "asc" as const } } } },
    results: { select: { pointId: true, status: true, evidence: true, recalledWhenAsked: true } },
  };

  function reviewDTO(r: ReviewRow) {
    const checked = r.status === "CHECKED" || r.status === "COMPLETE";
    const byPoint = new Map(r.results.map((x) => [x.pointId, x]));
    const scored = r.checklist.points.filter((p) => byPoint.has(p.id)).map((p) => ({ tier: p.tier, weight: p.weight, status: byPoint.get(p.id)!.status }));
    return {
      id: r.id, subtopicId: r.subtopicId, subtopic: r.subtopic.name, topicId: r.subtopic.topic.id, topic: r.subtopic.topic.name, attempt: r.attempt, status: r.status,
      date: d2i(r.date), spokenParts: parts(r.spokenParts), typed: r.typed, sketches: sketchesOf(r.sketchParts), waitReason: r.waitReason, language: r.checklist.language,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      // Phase 2: the senior engineer's follow-up and verdict (after checking only).
      followupQuestion: checked ? r.followupQuestion : null,
      followupAnswer: checked ? r.followupAnswer : null,
      seniorVerdict: checked ? (r.seniorVerdict as unknown as SeniorVerdict | null) : null,
      // The checklist is the answer: it is shown only once the review is checked.
      result: checked ? {
        score: r.score!, depth: r.depth!, outcome: r.outcome!, misconceptions: misconceptionsOf(r.misconceptions),
        stageBefore: r.stageBefore!, stageAfter: r.stageAfter!, nextDueDate: r.nextDueDate ? d2i(r.nextDueDate) : null,
        tierShares: tierShares(scored), gradingModel: r.gradingModel,
        points: r.checklist.points.map((p) => {
          const x = byPoint.get(p.id);
          return { id: p.id, code: p.code, label: p.label, description: p.description, tier: p.tier, leftOut: !!p.leftOutAt, status: x?.status ?? null, evidence: x?.evidence ?? null, recalledWhenAsked: x?.recalledWhenAsked ?? false };
        }),
      } : null,
    };
  }

  async function loadReview(db: PrismaClient, id: number) {
    const r = await db.recallReview.findUnique({ where: { id }, include: reviewInclude });
    if (!r) throw notFound("Review");
    return r as ReviewRow;
  }

  return {
    availability,

    /** Due today (within the daily limit), due but waiting for a free slot, and the next two weeks (plan §3.1). */
    async home(db: PrismaClient, userId: string) {
      const t = today();
      const settings = await db.settings.findFirst({ select: { revisionDailyMinutes: true } });
      const limit = dailyLimit(settings?.revisionDailyMinutes ?? 30);
      const [tasks, doneToday, open] = await Promise.all([
        db.task.findMany({
          where: { recallStateId: { not: null }, status: "TODO", scheduledDate: { lte: i2d(addDays(t, RECALL.upcomingDays)) } },
          include: { recallState: true, subtopic: { select: { id: true, name: true, topic: { select: { id: true, name: true, district: { select: { name: true } } } } } } },
          orderBy: [{ scheduledDate: "asc" }, { originalDate: "asc" }, { id: "asc" }],
        }),
        db.recallReview.count({ where: { date: i2d(t), status: { in: ["CHECKED", "COMPLETE"] } } }),
        db.recallReview.findMany({ where: { status: { in: ["DRAFT", "WAITING", "CHECKED"] } }, select: { id: true, subtopicId: true, status: true } }),
      ]);
      const item = (x: (typeof tasks)[number]) => ({
        subtopicId: x.subtopic!.id, subtopic: x.subtopic!.name, topicId: x.subtopic!.topic.id, topic: x.subtopic!.topic.name, district: x.subtopic!.topic.district.name,
        stage: x.recallState!.stage, nextDueDate: d2i(x.originalDate), lastReviewDate: x.recallState!.lastReviewDate ? d2i(x.recallState!.lastReviewDate) : null,
        taskId: x.id, scheduledDate: d2i(x.scheduledDate),
        overdueDays: d2i(x.scheduledDate) < t ? diffDays(d2i(x.scheduledDate), t) : 0,
      });
      const day = (x: (typeof tasks)[number]) => d2i(x.scheduledDate);
      return {
        today: t, limit, doneToday,
        // Planned for today or earlier (carried over): what to recall now.
        due: tasks.filter((x) => day(x) <= t).map(item),
        // Due already, but planned for a later day because of the daily limit.
        later: tasks.filter((x) => day(x) > t && d2i(x.originalDate) <= t).map(item),
        upcoming: tasks.filter((x) => day(x) > t && d2i(x.originalDate) > t).map(item),
        open: open.map((o) => ({ reviewId: o.id, subtopicId: o.subtopicId, status: o.status })),
        ai: await availability(userId),
      };
    },

    /** Every checked recall, newest first (the Revision tab's history, plan §3.5). */
    async history(db: PrismaClient) {
      const rows = await db.recallReview.findMany({
        where: { status: { in: ["CHECKED", "COMPLETE"] } },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take: 200,
        select: { id: true, date: true, attempt: true, score: true, depth: true, outcome: true, nextDueDate: true, subtopicId: true, subtopic: { select: { name: true, topic: { select: { name: true } } } } },
      });
      return rows.map((r) => ({
        reviewId: r.id, date: d2i(r.date), attempt: r.attempt, score: r.score!, depth: r.depth!, outcome: r.outcome!, nextDueDate: r.nextDueDate ? d2i(r.nextDueDate) : null,
        subtopicId: r.subtopicId, subtopic: r.subtopic.name, topic: r.subtopic.topic.name,
      }));
    },

    /** Plans every city's recall tasks (server start: sub-topics already in recall get their tasks). */
    async planAll() {
      const cities = await d.prisma.recallState.findMany({ distinct: ["cityId"], select: { cityId: true } });
      let n = 0;
      for (const c of cities) n += await syncRecallTasks(cityScoped(d.prisma, c.cityId), today());
      return n;
    },

    /** Starts (or continues) a review of a learned sub-topic; builds its checklist first if needed. */
    async start(db: PrismaClient, cityId: string, userId: string, subtopicId: number) {
      await requireAi(userId);
      const s = await subtopicOf(db, subtopicId);
      if (!s.completedAt || !s.recallState?.nextDueDate) throw new HttpError(409, "NOT_LEARNED", "Tick the sub-topic as learned first: recall starts the day after.");
      const openReview = async () => {
        const open = await db.recallReview.findFirst({ where: { subtopicId, status: { in: ["DRAFT", "WAITING", "CHECKED"] } }, orderBy: { id: "desc" } });
        return open ? reviewDTO(await loadReview(db, open.id)) : null;
      };
      const existing = await openReview();
      if (existing) return existing;
      // Two starts at once (a double click, a page opened twice) share one review and one checklist.
      const inflight = starting.get(subtopicId);
      if (inflight) return inflight;
      const job = (async () => {
        try {
          const checklist = (await currentChecklist(db, subtopicId)) ?? (await buildChecklist(db, cityId, subtopicId));
          const last = await db.recallReview.findFirst({ where: { subtopicId }, orderBy: { attempt: "desc" }, select: { attempt: true } });
          const r = await db.recallReview.create({ data: { subtopicId, checklistId: checklist.id, attempt: (last?.attempt ?? 0) + 1, date: i2d(today()) } });
          return reviewDTO(await loadReview(db, r.id));
        } catch (e) {
          // Another process got there first: use its review.
          if ((e as { code?: string }).code === "P2002") {
            const other = await openReview();
            if (other) return other;
          }
          throw e;
        }
      })().finally(() => starting.delete(subtopicId));
      starting.set(subtopicId, job);
      return job;
    },

    async review(db: PrismaClient, id: number) {
      return reviewDTO(await loadReview(db, id));
    },

    /** Saves what was typed so far (only while recalling). */
    async saveTyped(db: PrismaClient, id: number, typed: string) {
      const r = await loadReview(db, id);
      if (r.status !== "DRAFT") throw new HttpError(409, "REVIEW_SENT", "This recall was already sent.");
      await db.recallReview.update({ where: { id }, data: { typed: typed.slice(0, RECALL.maxChars) } });
      return reviewDTO(await loadReview(db, id));
    },

    /** Terms and language for transcribing a part of this review: names and the checklist's technical words, never its descriptions. */
    async transcriptionTerms(db: PrismaClient, id: number, forFollowup = false) {
      const r = await loadReview(db, id);
      if (forFollowup) {
        if (r.status !== "CHECKED" || !r.followupQuestion || r.followupAnswer) throw new HttpError(409, "NO_FOLLOWUP", "There is no open follow-up question.");
        return { terms: [r.subtopic.name, r.subtopic.topic.name, ...r.checklist.points.map((p) => p.label)], language: r.checklist.language };
      }
      if (r.status !== "DRAFT") throw new HttpError(409, "REVIEW_SENT", "This recall was already sent.");
      if (parts(r.spokenParts).length >= RECALL.maxParts) throw new HttpError(409, "TOO_MANY_PARTS", `A recall can have at most ${RECALL.maxParts} recorded parts.`);
      return { terms: [r.subtopic.name, r.subtopic.topic.name, ...r.checklist.points.map((p) => p.label)], language: r.checklist.language };
    },

    async addPart(db: PrismaClient, id: number, text: string) {
      const r = await loadReview(db, id);
      if (r.status !== "DRAFT") throw new HttpError(409, "REVIEW_SENT", "This recall was already sent.");
      const next = [...parts(r.spokenParts), text.trim()].filter(Boolean);
      await db.recallReview.update({ where: { id }, data: { spokenParts: next } });
      return reviewDTO(await loadReview(db, id));
    },

    async removePart(db: PrismaClient, id: number, index: number) {
      const r = await loadReview(db, id);
      if (r.status !== "DRAFT") throw new HttpError(409, "REVIEW_SENT", "This recall was already sent.");
      const xs = parts(r.spokenParts);
      if (index < 0 || index >= xs.length) throw notFound("Recorded part");
      xs.splice(index, 1);
      await db.recallReview.update({ where: { id }, data: { spokenParts: xs } });
      return reviewDTO(await loadReview(db, id));
    },

    /** Sends the explanation for checking (§5); grading runs in the background and the page follows it. */
    async submit(db: PrismaClient, cityId: string, userId: string, id: number) {
      const r = await loadReview(db, id);
      await requireAi(userId);
      if (r.status !== "DRAFT") return reviewDTO(r);
      const explanation = explanationOf(parts(r.spokenParts), r.typed, sketchesOf(r.sketchParts)).slice(0, RECALL.maxChars);
      if (explanation.length < RECALL.minChars) throw new HttpError(400, "EXPLANATION_TOO_SHORT", "Say or type a little more first: everything you remember about it.");
      await db.recallReview.update({ where: { id }, data: { status: "WAITING", explanation, submittedAt: d.clock.now(), waitReason: null } });
      void runGrade(cityId, id);
      return reviewDTO(await loadReview(db, id));
    },

    /** Checks a waiting review again, after the learner asks. */
    async retry(db: PrismaClient, cityId: string, userId: string, id: number) {
      const r = await loadReview(db, id);
      await requireAi(userId);
      if (r.status !== "WAITING") return reviewDTO(r);
      await db.recallReview.update({ where: { id }, data: { waitReason: null } });
      void runGrade(cityId, id);
      return reviewDTO(await loadReview(db, id));
    },

    /**
     * Finishes a checked review (§3.4): the senior engineer's verdict is written from the results (and the follow-up,
     * if answered), then the review is complete and its analysis over time is worked out in the background. A verdict
     * that cannot be written (AI busy) does not hold the review open; the score and the date never change here.
     */
    async complete(db: PrismaClient, cityId: string, id: number) {
      const r = await loadReview(db, id);
      if (r.status === "CHECKED") {
        const verdict = await writeVerdict(r);
        await db.recallReview.update({
          where: { id },
          data: { status: "COMPLETE", completedAt: d.clock.now(), seniorVerdict: verdict ? (verdict as unknown as Prisma.InputJsonValue) : undefined },
        });
        void runAnalysis(cityId, id);
      } else if (r.status !== "COMPLETE") throw new HttpError(409, "NOT_CHECKED", "This recall hasn't been checked yet.");
      return reviewDTO(await loadReview(db, id));
    },

    /**
     * The senior engineer's follow-up (§3.4): 1–2 questions about the missed and partly recalled points and any
     * misconception. Only while the results are open; written once. Nothing to ask when everything was recalled.
     */
    async probe(db: PrismaClient, userId: string, id: number) {
      const r = await loadReview(db, id);
      await requireAi(userId);
      if (r.status !== "CHECKED" || r.followupQuestion) return reviewDTO(r);
      const { res, missed, partial } = byStatus(r);
      const misconceptions = misconceptionsOf(r.misconceptions);
      if (!missed.length && !partial.length && !misconceptions.length) return reviewDTO(r);
      const gaps = [...missed, ...partial].sort((a, b) => b.tier - a.tier).map((p) => ({ label: p.label, description: p.description, tier: p.tier, status: res.get(p.id)!.status }));
      let questions: string[];
      try {
        questions = ProbeReply.parse(await generateJson("recall_probe", config.generationModel, probePrompt(contextOf(r), gaps, misconceptions), probeJsonSchema, 800, 0.3)).questions;
      } catch {
        throw unavailable("The follow-up question");
      }
      await db.recallReview.update({ where: { id }, data: { followupQuestion: questions.map((q) => q.trim()).join("\n") } });
      return reviewDTO(await loadReview(db, id));
    },

    /**
     * The answer to the follow-up (§6.4): checked with the same pinned model and rules, but only against the points
     * missed on their own. A point shown now is marked recalled when asked; its status, the score, the result and the
     * next date stay what the unprompted recall gave.
     */
    async followup(db: PrismaClient, userId: string, id: number, answer: string) {
      const r = await loadReview(db, id);
      await requireAi(userId);
      if (r.status !== "CHECKED" || !r.followupQuestion) throw new HttpError(409, "NO_FOLLOWUP", "There is no open follow-up question.");
      if (r.followupAnswer) return reviewDTO(r);
      const text = answer.trim().slice(0, RECALL.maxChars);
      if (text.length < RECALL.minAnswerChars) throw new HttpError(400, "ANSWER_TOO_SHORT", "Say or type your answer first.");
      const { missed } = byStatus(r);
      if (missed.length) {
        let graded;
        try {
          graded = await gradeOnce(r.checklist, r.subtopic.name, r.subtopic.topic.name, text, missed);
        } catch {
          throw unavailable("Your answer's check");
        }
        const shown = graded.points.filter((p) => p.status === "ACCURATE").map((p) => missed.find((m) => m.code === p.code)!.id);
        if (shown.length) await db.recallPointResult.updateMany({ where: { reviewId: id, pointId: { in: shown } }, data: { recalledWhenAsked: true } });
      }
      await db.recallReview.update({ where: { id }, data: { followupAnswer: text } });
      return reviewDTO(await loadReview(db, id));
    },

    /** The concept grid (§3.5): the current checklist's points × this sub-topic's checked reviews, and the analyses. */
    async matrix(db: PrismaClient, subtopicId: number) {
      const s = await db.subtopic.findUnique({ where: { id: subtopicId }, select: { id: true, name: true, topic: { select: { name: true } } } });
      if (!s) throw notFound("Sub-topic");
      const checklist = await db.recallChecklist.findFirst({ where: { subtopicId }, orderBy: { version: "desc" }, include: { points: { orderBy: { position: "asc" } } } });
      if (!checklist) return { subtopicId, subtopic: s.name, topic: s.topic.name, version: null, points: [], attempts: [], analyses: [] };
      const reviews = await db.recallReview.findMany({
        where: { subtopicId, checklistId: checklist.id, status: { in: ["CHECKED", "COMPLETE"] } },
        orderBy: { attempt: "asc" },
        include: { results: { select: { pointId: true, status: true, recalledWhenAsked: true } }, analysis: true },
      });
      return {
        subtopicId, subtopic: s.name, topic: s.topic.name, version: checklist.version,
        points: checklist.points.map((p) => ({ id: p.id, code: p.code, label: p.label, tier: p.tier, leftOut: !!p.leftOutAt })),
        attempts: reviews.map((x) => ({
          reviewId: x.id, attempt: x.attempt, date: d2i(x.date), score: x.score, depth: x.depth, outcome: x.outcome,
          cells: Object.fromEntries(x.results.map((c) => [c.pointId, { status: c.status, recalledWhenAsked: c.recalledWhenAsked }])),
        })),
        analyses: reviews.filter((x) => x.analysis).map((x) => ({ attempt: x.attempt, narrative: x.analysis!.narrative, diff: x.analysis!.diffPayload })),
      };
    },

    /**
     * A sketch drawn from memory (phase 3): the photo goes to the vision model once and is dropped; only its literal
     * description is kept, and it is graded with the explanation as "[SKETCH n]".
     */
    async addSketch(db: PrismaClient, userId: string, id: number, mimeType: string | undefined, data: Buffer) {
      const r = await loadReview(db, id);
      await requireAi(userId);
      if (r.status !== "DRAFT") throw new HttpError(409, "REVIEW_SENT", "This recall was already sent.");
      const sketches = Array.isArray(r.sketchParts) ? (r.sketchParts as Prisma.JsonArray) : [];
      if (sketches.length >= RECALL.maxSketches) throw new HttpError(409, "TOO_MANY_SKETCHES", `A recall can have at most ${RECALL.maxSketches} sketches.`);
      if (!data.length) throw new HttpError(400, "FILE_EMPTY", "The photo is empty.");
      if (data.length > RECALL.maxSketchBytes) throw new HttpError(413, "FILE_TOO_LARGE", "Photos can be at most 5 MB.");
      const kind = imageType(data);
      if (!kind || (mimeType && !mimeType.toLowerCase().startsWith(kind))) throw new HttpError(415, "FILE_UNSUPPORTED", "Add a photo as PNG, JPEG or WebP.");
      if (!providers.generation?.images) throw new HttpError(503, "AI_UNAVAILABLE", "Reading sketches needs an AI model that reads images.");
      let lines: string[];
      try {
        const out = SketchReply.parse(await generateJson("recall_sketch", config.generationModel, sketchPrompt(contextOf(r)), sketchJsonSchema, 3000, 0, [{ mimeType: kind, data }]));
        lines = out.readable ? out.lines.map((x) => x.trim()).filter(Boolean) : [];
      } catch {
        throw unavailable("The sketch's description");
      }
      if (!lines.length) throw new HttpError(422, "SKETCH_UNREADABLE", "Nothing could be read in this photo. Try a sharper photo in good light.");
      const description = lines.join("\n").slice(0, 4000);
      await db.recallReview.update({ where: { id }, data: { sketchParts: [...sketches, { description, promptVersion: SKETCH_PROMPT_VERSION }] as Prisma.InputJsonValue } });
      return reviewDTO(await loadReview(db, id));
    },

    async removeSketch(db: PrismaClient, id: number, index: number) {
      const r = await loadReview(db, id);
      if (r.status !== "DRAFT") throw new HttpError(409, "REVIEW_SENT", "This recall was already sent.");
      const sketches = Array.isArray(r.sketchParts) ? [...(r.sketchParts as Prisma.JsonArray)] : [];
      if (index < 0 || index >= sketches.length) throw notFound("Sketch");
      sketches.splice(index, 1);
      await db.recallReview.update({ where: { id }, data: { sketchParts: sketches as Prisma.InputJsonValue } });
      return reviewDTO(await loadReview(db, id));
    },

    /**
     * "This point isn't part of this sub-topic" (§4.3): left out of scoring from now on. While the latest review is
     * still open on its results, its score, depth, result and next date are worked out again without the point.
     */
    async leaveOut(db: PrismaClient, cityId: string, pointId: number, leftOut: boolean) {
      const p = await db.recallPoint.findUnique({ where: { id: pointId } });
      if (!p) throw notFound("Point");
      await db.recallPoint.update({ where: { id: pointId }, data: { leftOutAt: leftOut ? d.clock.now() : null } });
      const latest = await db.recallReview.findFirst({ where: { checklistId: p.checklistId }, orderBy: { attempt: "desc" }, include: reviewInclude });
      if (latest?.status === "CHECKED") {
        const checklist = (await db.recallChecklist.findUniqueOrThrow({ where: { id: p.checklistId }, include: { points: { orderBy: { position: "asc" } } } }));
        const scored = checklist.points.filter((x) => !x.leftOutAt);
        const byPoint = new Map((latest as ReviewRow).results.map((x) => [x.pointId, x]));
        const graded = {
          points: scored.map((x) => ({ code: x.code, status: byPoint.get(x.id)?.status ?? ("MISSED" as PointStatus), evidence: byPoint.get(x.id)?.evidence ?? null })),
          misconceptions: misconceptionsOf(latest.misconceptions), rejectedQuotes: 0,
        };
        // The schedule is worked out again from where this review started.
        await db.recallState.update({ where: { subtopicId: latest.subtopicId }, data: { stage: latest.stageBefore ?? 0 } });
        await applyGrade(cityId, latest, checklist, graded);
        return reviewDTO(await loadReview(db, latest.id));
      }
      return null;
    },

    /**
     * Rebuilds a sub-topic's checklist with the current prompt (an owner's decision, §4, §14): a new version, built and
     * locked like the first. Earlier versions and their reviews stay as they were graded, and the schedule is kept. An
     * unsent draft moves to the new version, since nothing in it is graded yet; a review on its results stays on its
     * version; a review waiting for its grade stops the rebuild.
     */
    async rebuildChecklist(db: PrismaClient, cityId: string, subtopicId: number) {
      const old = await currentChecklist(db, subtopicId);
      if (!old) throw notFound("Checklist");
      if (await db.recallReview.count({ where: { subtopicId, status: "WAITING" } }))
        throw new HttpError(409, "REVIEW_WAITING", "A recall of this sub-topic is being checked; rebuild its checklist afterwards.");
      const fresh = await buildChecklist(db, cityId, subtopicId);
      const moved = await db.recallReview.updateMany({ where: { subtopicId, checklistId: old.id, status: "DRAFT" }, data: { checklistId: fresh.id } });
      const view = (c: typeof old) => ({ id: c.id, version: c.version, promptVersion: c.promptVersion, points: c.points.map((p) => ({ tier: p.tier, label: p.label })) });
      return { subtopicId, from: view(old), to: view(fresh), movedDrafts: moved.count };
    },

    /** "Not today": the sub-topic moves to tomorrow without a result (§3.2). */
    async postpone(db: PrismaClient, subtopicId: number) {
      const s = await db.recallState.findUnique({ where: { subtopicId } });
      if (!s?.nextDueDate) throw notFound("Sub-topic in recall");
      const tomorrow = addDays(today(), 1);
      await db.recallState.update({ where: { subtopicId }, data: { nextDueDate: i2d(tomorrow) } });
      await syncRecallTasks(db, today());
      return { subtopicId, nextDueDate: tomorrow };
    },

    /** Grading that was waiting when the server stopped carries on after a restart. */
    async resumeWaiting() {
      const waiting = await d.prisma.recallReview.findMany({ where: { status: "WAITING" }, select: { id: true, cityId: true } });
      for (const w of waiting) void runGrade(w.cityId, w.id);
      return waiting.length;
    },

    /** For tests: whether a review is being graded right now. */
    isGrading: (id: number) => grading.has(id),
  };
}

export type RecallService = ReturnType<typeof recallService>;

/** The senior engineer's verdict, stored on the review. The rating is worked out in code (rules.ts › cuedRating). */
export interface SeniorVerdict {
  foundationsSummary: string;
  architectureAndEdgeCasesSummary: string;
  focusNext: string;
  cuedReasoningRating: "Strong" | "Developing" | "Needs Work" | null;
  recalledWhenAsked: string[];
  promptVersion: string;
  model: string;
}

/**
 * A sub-topic ticked learned enters recall, due the next day (§3.1); unticked, nothing is due until it is learned
 * again. Called inside the learner's own update, with the city-scoped client.
 */
export async function syncRecallState(db: Prisma.TransactionClient | PrismaClient, subtopicId: number, learned: boolean, today: ISODate) {
  const s = await db.recallState.findUnique({ where: { subtopicId } });
  if (learned) {
    if (!s) await db.recallState.create({ data: { subtopicId, nextDueDate: i2d(addDays(today, 1)) } });
    else if (!s.nextDueDate) await db.recallState.update({ where: { subtopicId }, data: { nextDueDate: i2d(addDays(today, 1)) } });
  } else if (s?.nextDueDate) {
    await db.recallState.update({ where: { subtopicId }, data: { nextDueDate: null } });
  }
}
