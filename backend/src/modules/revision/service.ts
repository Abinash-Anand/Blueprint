/**
 * Revision module (Revision spec, SRS §3.9, LLD §12.5): eligibility, adaptive scheduling, attempts, corrections,
 * learning checkpoints and prompts. Every multi-record change runs in one transaction (NFR-REV-03).
 * Nothing here touches Subtopic.completedAt, Topic.demonstratedAt or district progress (REV-15, REV-16).
 */
import type { CheckpointResult, Prisma, PrismaClient, RetrievalMethod, RevisionScope } from "@prisma/client";
import { checkpointPresentation, outcomePresentation, revisionPresentation } from "../../domain/presentation.js";
import { type ISODate, addDays, berlinDate } from "../../domain/dates.js";
import {
  REVISION_POLICY, type RecallScore, type RevisionPolicy, applyAttempt, displayStatus, dueAfterCorrection, firstDueDate,
  isWeak, placeRevisions,
} from "../../domain/revision.js";
import { d2i, i2d } from "../../db.js";
import type { Clock } from "../../lib/clock.js";
import { HttpError, notFound } from "../../lib/http.js";
import { loadTargets } from "../schedule/service.js";
import { TEMPLATES, templateByKey, unitSubject } from "./templates.js";

type Db = Prisma.TransactionClient;

export const unitKey = (scope: RevisionScope, topicId: string, subtopicId: number | null) =>
  scope === "TOPIC" ? `t:${topicId}` : `s:${subtopicId}`;

export async function revisionPolicy(db: Db | PrismaClient): Promise<RevisionPolicy> {
  const s = await db.settings.findFirst({ select: { revisionDailyMinutes: true, revisionWeeklyOvertimeMinutes: true } });
  return {
    ...REVISION_POLICY,
    dailyBudgetMinutes: s?.revisionDailyMinutes ?? REVISION_POLICY.dailyBudgetMinutes,
    weeklyOvertimeMinutes: s?.revisionWeeklyOvertimeMinutes ?? REVISION_POLICY.weeklyOvertimeMinutes,
  };
}

const label = (s: { scope: RevisionScope; topic: { name: string }; subtopic: { name: string } | null }) =>
  s.scope === "TOPIC" ? `${s.topic.name} (whole topic)` : (s.subtopic?.name ?? s.topic.name);

/**
 * REV-02 / REV-03: bring a topic's schedules in line with what the learner has marked.
 * A learned sub-topic gets a schedule; the topic gets one once two sub-topics are learned or it is demonstrated.
 * A unit that stops being eligible is suspended (history kept) and its open revision task is removed.
 */
export async function syncTopic(db: Db, topicId: string, now: Date) {
  const t = await db.topic.findUnique({
    where: { id: topicId },
    include: { subtopics: { orderBy: { position: "asc" } }, revisionSchedules: true },
  });
  if (!t) return;
  const existing = new Map(t.revisionSchedules.map((s) => [s.unit, s]));
  const learnedDates = t.subtopics.filter((s) => s.completedAt).map((s) => berlinDate(s.completedAt!)).sort();
  const candidates = [learnedDates[1], t.demonstratedAt ? berlinDate(t.demonstratedAt) : undefined].filter((d): d is ISODate => !!d).sort();
  const want: { scope: RevisionScope; subtopicId: number | null; since: ISODate | null }[] = [
    ...t.subtopics.map((s) => ({ scope: "SUBTOPIC" as const, subtopicId: s.id, since: s.completedAt ? berlinDate(s.completedAt) : null })),
    { scope: "TOPIC", subtopicId: null, since: candidates[0] ?? null },
  ];
  for (const w of want) {
    const unit = unitKey(w.scope, topicId, w.subtopicId);
    const s = existing.get(unit);
    if (w.since) {
      if (!s) {
        await db.revisionSchedule.create({
          data: {
            unit, scope: w.scope, topicId, subtopicId: w.subtopicId,
            eligibleSince: i2d(w.since), nextDueDate: i2d(firstDueDate(w.scope, w.since)),
          },
        });
      } else if (s.suspendedAt) {
        await db.revisionSchedule.update({ where: { id: s.id }, data: { suspendedAt: null } });
      }
    } else if (s && !s.suspendedAt) {
      await db.revisionSchedule.update({ where: { id: s.id }, data: { suspendedAt: now } });
      await db.task.deleteMany({ where: { revisionScheduleId: s.id, status: "TODO", source: "REVISION" } });
    }
  }
}

/**
 * Give every active schedule that has a due date but no open task a revision task, placed by priority within
 * the daily revision allowance (spec §8.5, REV-13, REV-19). Existing placements are never reshuffled.
 */
export async function planOpenRevisions(db: Db, today: ISODate) {
  const schedules = await db.revisionSchedule.findMany({
    where: { suspendedAt: null, nextDueDate: { not: null }, tasks: { none: { status: "TODO" } } },
    include: { topic: { select: { name: true } }, subtopic: { select: { name: true } } },
  });
  if (schedules.length === 0) return [];
  const [policy, targets] = await Promise.all([revisionPolicy(db), loadTargets(db as PrismaClient)]);
  const range = { gte: i2d(today), lte: i2d(addDays(today, policy.horizonDays)) };
  const [learning, revision] = await Promise.all([
    db.task.groupBy({ by: ["scheduledDate"], where: { status: { not: "SKIPPED" }, scheduledDate: range, revisionScheduleId: null }, _sum: { estimatedMinutes: true } }),
    db.task.groupBy({ by: ["scheduledDate"], where: { status: { not: "SKIPPED" }, scheduledDate: range, revisionScheduleId: { not: null } }, _sum: { estimatedMinutes: true } }),
  ]);
  const toMap = (rows: typeof learning) => new Map(rows.map((r) => [d2i(r.scheduledDate), r._sum.estimatedMinutes ?? 0]));
  const minutes = (scope: RevisionScope) => (scope === "TOPIC" ? policy.topicMinutes : policy.subtopicMinutes);
  const byId = new Map(schedules.map((s) => [s.id, s]));
  const placements = placeRevisions(
    schedules.map((s) => ({
      scheduleId: s.id, dueDate: d2i(s.nextDueDate!), minutes: minutes(s.scope), weak: isWeak(s, policy),
      lastScore: s.lastScore, lastAttemptDate: s.lastAttemptDate ? d2i(s.lastAttemptDate) : null,
    })),
    toMap(learning), toMap(revision), targets, today, policy,
  );
  for (const p of placements) {
    const s = byId.get(p.scheduleId)!;
    await db.task.create({
      data: {
        title: `Revise: ${label(s)}`,
        kind: "REVISION",
        source: "REVISION",
        estimatedMinutes: minutes(s.scope),
        // The due date is the task's original date, so lateness stays visible however often it moves (REV-18).
        originalDate: s.nextDueDate!,
        scheduledDate: i2d(p.date),
        position: 100,
        topicId: s.topicId,
        subtopicId: s.subtopicId,
        revisionScheduleId: s.id,
      },
    });
  }
  return placements;
}

/** Re-place overdue revision tasks by priority (used by "Move all forward"). Their due dates are kept. */
export async function replaceOverdueRevisions(db: Db, today: ISODate) {
  const overdue = await db.task.findMany({
    where: { status: "TODO", scheduledDate: { lt: i2d(today) }, revisionScheduleId: { not: null } },
    include: { revisionSchedule: true },
  });
  if (overdue.length === 0) return [];
  const [policy, targets] = await Promise.all([revisionPolicy(db), loadTargets(db as PrismaClient)]);
  const range = { gte: i2d(today), lte: i2d(addDays(today, policy.horizonDays)) };
  const [learning, revision] = await Promise.all([
    db.task.groupBy({ by: ["scheduledDate"], where: { status: { not: "SKIPPED" }, scheduledDate: range, revisionScheduleId: null }, _sum: { estimatedMinutes: true } }),
    db.task.groupBy({ by: ["scheduledDate"], where: { status: { not: "SKIPPED" }, scheduledDate: range, revisionScheduleId: { not: null } }, _sum: { estimatedMinutes: true } }),
  ]);
  const toMap = (rows: typeof learning) => new Map(rows.map((r) => [d2i(r.scheduledDate), r._sum.estimatedMinutes ?? 0]));
  const byId = new Map(overdue.map((t) => [t.revisionScheduleId!, t]));
  const placements = placeRevisions(
    overdue.map((t) => ({
      scheduleId: t.revisionScheduleId!, dueDate: d2i(t.originalDate), minutes: t.estimatedMinutes,
      weak: t.revisionSchedule ? isWeak(t.revisionSchedule, policy) : false,
      lastScore: t.revisionSchedule?.lastScore ?? null,
      lastAttemptDate: t.revisionSchedule?.lastAttemptDate ? d2i(t.revisionSchedule.lastAttemptDate) : null,
    })),
    toMap(learning), toMap(revision), targets, today, policy,
  );
  const moves = [];
  for (const p of placements) {
    const t = byId.get(p.scheduleId)!;
    await db.task.update({ where: { id: t.id }, data: { scheduledDate: i2d(p.date), rescheduleCount: { increment: 1 } } });
    moves.push({ id: t.id, from: d2i(t.scheduledDate), to: p.date });
  }
  return moves;
}

/** Idempotent backfill for learning marked before revision existed (run by the seed on every start). */
export async function backfillRevision(prisma: PrismaClient, today: ISODate) {
  const topics = await prisma.topic.findMany({
    where: { OR: [{ subtopics: { some: { completedAt: { not: null } } } }, { demonstratedAt: { not: null } }, { revisionSchedules: { some: {} } }] },
    select: { id: true },
  });
  return prisma.$transaction(async (tx) => {
    for (const t of topics) await syncTopic(tx, t.id, new Date());
    return planOpenRevisions(tx, today);
  }, { maxWait: 10_000, timeout: 60_000 });
}

export interface AttemptInput {
  topicId: string;
  subtopicId?: number;
  promptId?: number;
  templateKey?: string;
  retrievalMethod: RetrievalMethod;
  score: RecallScore;
  usedHints: boolean;
  usedNotes: boolean;
  correctionCompleted: boolean;
  durationMinutes?: number;
  response?: string;
  mistakes?: string;
  comment?: string;
  /** AI assessment the learner looked at (AI design §5.3). */
  evaluationId?: number;
  selfScore?: RecallScore;
  inputMode?: "TYPED" | "SPOKEN";
}

export interface CheckpointInput {
  topicId: string;
  subtopicId: number;
  promptId?: number;
  templateKey?: string;
  result: CheckpointResult;
  neededAssistance: boolean;
  gaps?: string;
  response?: string;
}

export interface PromptInput {
  topicId: string;
  subtopicId?: number;
  title?: string;
  content: string;
  retrievalMethod: RetrievalMethod;
  expectedAnswer: string;
  difficulty?: number;
}

export interface PromptPatch {
  title?: string;
  content?: string;
  retrievalMethod?: RetrievalMethod;
  expectedAnswer?: string;
  difficulty?: number | null;
  isActive?: boolean;
}

/**
 * AI design §5.3 (I-3): only a finished assessment of this unit, of exactly the answer being saved, that no other
 * attempt uses, can be linked. The link is reference data: the learner's score drives scheduling as before.
 */
async function checkEvaluationLink(tx: Db, evaluationId: number, scheduleId: number, response: string) {
  const stale = (why: string) => new HttpError(409, "EVALUATION_STALE", why);
  const e = await tx.revisionEvaluation.findUnique({ where: { id: evaluationId }, include: { attempt: { select: { id: true } } } });
  if (!e || e.scheduleId !== scheduleId) throw stale("That AI check belongs to a different revision.");
  if (e.parentId !== null) throw stale("Link the first AI check of the answer, not the follow-up.");
  if (e.status !== "SUCCEEDED") throw stale("That AI check did not finish. Check again or save without it.");
  if (e.transcript.trim() !== response.trim()) throw stale("The answer changed after the AI check. Check again or save without it.");
  if (e.attempt) throw stale("That AI check is already part of another attempt.");
}

const notEligible = () =>
  new HttpError(409, "NOT_ELIGIBLE", "This isn't ready for revision yet. Mark the sub-topic as learned first, or use a recall check while studying.");

/** A stored prompt for the unit, or a template rendered and stored for it on first use. */
export async function resolvePrompt(
  tx: Db,
  unit: { scope: RevisionScope; topicId: string; subtopicId: number | null },
  promptId?: number,
  templateKey?: string,
) {
  if (promptId) {
    const p = await tx.revisionPrompt.findUnique({ where: { id: promptId } });
    if (!p) throw notFound("Prompt");
    const matches = p.topicId === unit.topicId && (p.subtopicId ?? null) === unit.subtopicId;
    if (!matches) throw new HttpError(400, "VALIDATION_ERROR", "The prompt belongs to a different topic or sub-topic");
    return p;
  }
  const tpl = templateKey ? templateByKey.get(templateKey) : undefined;
  if (!tpl) throw new HttpError(400, "VALIDATION_ERROR", "Provide promptId or a valid templateKey");
  const topic = await tx.topic.findUniqueOrThrow({
    where: { id: unit.topicId },
    include: { subtopics: { orderBy: { position: "asc" } } },
  });
  const sub = unit.subtopicId ? topic.subtopics.find((s) => s.id === unit.subtopicId) : null;
  if (unit.subtopicId && !sub) throw new HttpError(400, "VALIDATION_ERROR", "subtopicId does not belong to topicId");
  const content = tpl.content(
    unitSubject({ scope: unit.scope, topicName: topic.name, subtopicName: sub?.name, learned: topic.subtopics.filter((s) => s.completedAt).map((s) => s.name) }),
  );
  const key = `tpl:${tpl.key}:${unitKey(unit.scope, unit.topicId, unit.subtopicId)}`;
  const data = { title: tpl.label, content, retrievalMethod: tpl.method(topic.districtId), expectedAnswer: tpl.expected };
  return tx.revisionPrompt.upsert({
    where: { key },
    update: data,
    create: { ...data, key, topicId: unit.topicId, subtopicId: unit.subtopicId, source: "TEMPLATE", templateKey: tpl.key },
  });
}

export interface ReportInput {
  reason: "OUT_OF_SYLLABUS" | "UNCLEAR" | "UNFAIR_CHECK" | "OTHER";
  promptText: string;
  note?: string;
  topicId?: string;
  scheduleId?: number;
  promptId?: number;
  evaluationId?: number;
}

export function revisionService(prisma: PrismaClient, clock: Clock) {
  return {
    /**
     * Records the learner flagging a question or an AI check. Only a record: no score, question or schedule changes.
     * Every reference must belong to this city (the scoped client finds nothing in another city).
     */
    async report(b: ReportInput) {
      const [topic, schedule, prompt, evaluation] = await Promise.all([
        b.topicId ? prisma.topic.findFirst({ where: { id: b.topicId }, select: { id: true } }) : true,
        b.scheduleId ? prisma.revisionSchedule.findFirst({ where: { id: b.scheduleId }, select: { id: true } }) : true,
        b.promptId ? prisma.revisionPrompt.findFirst({ where: { id: b.promptId }, select: { id: true } }) : true,
        b.evaluationId ? prisma.revisionEvaluation.findFirst({ where: { id: b.evaluationId }, select: { id: true } }) : true,
      ]);
      if (!topic) throw notFound("Topic");
      if (!schedule) throw notFound("Revision unit");
      if (!prompt) throw notFound("Prompt");
      if (!evaluation) throw notFound("Evaluation");
      const r = await prisma.revisionReport.create({
        data: {
          reason: b.reason, promptText: b.promptText.slice(0, 2000), note: (b.note ?? "").trim(),
          topicId: b.topicId ?? null, scheduleId: b.scheduleId ?? null, promptId: b.promptId ?? null, evaluationId: b.evaluationId ?? null,
        } as never,
      });
      return { id: r.id, reason: r.reason, createdAt: r.createdAt.toISOString() };
    },

    async submitAttempt(b: AttemptInput) {
      const today = clock.today();
      if (b.score <= 1 && !b.mistakes?.trim())
        throw new HttpError(400, "VALIDATION_ERROR", "Note what was missing or wrong: a failed retrieval is only useful once the gap is named");
      return prisma.$transaction(async (tx) => {
        const unit = b.subtopicId ? `s:${b.subtopicId}` : `t:${b.topicId}`;
        // Row lock: two submissions for the same unit (double click, two tabs) run one after the other, so the second
        // sees the first one's result instead of racing it (REV-13, NFR-REV-03). The row is found through the city
        // scope first, so the lock can only ever touch this city's row.
        const locked = await tx.revisionSchedule.findUnique({ where: { unit }, select: { id: true } });
        if (locked) await tx.$queryRaw`SELECT id FROM "RevisionSchedule" WHERE id = ${locked.id} FOR UPDATE`;
        const s = await tx.revisionSchedule.findUnique({
          where: { unit },
          include: { topic: { select: { name: true } }, subtopic: { select: { name: true } } },
        });
        if (!s || s.topicId !== b.topicId || s.suspendedAt) throw notEligible();
        if (s.correctionPending)
          throw new HttpError(409, "CORRECTION_REQUIRED", "Correct the gap from the last attempt first, then try again (REV-08).");
        // One recorded attempt per unit per day: a second one right after seeing the answer is re-reading, not
        // retrieval, and it would otherwise complete the next cycle's task (double submission, second tab).
        if (s.lastAttemptDate && d2i(s.lastAttemptDate) === today)
          throw new HttpError(409, "ALREADY_ATTEMPTED_TODAY", "You already recorded an attempt for this today. Its next revision is scheduled; try again then.");
        const prompt = await resolvePrompt(tx, s, b.promptId, b.templateKey);
        if (b.evaluationId !== undefined) await checkEvaluationLink(tx, b.evaluationId, s.id, b.response ?? "");
        const policy = await revisionPolicy(tx);
        const u = applyAttempt(
          {
            previousIntervalDays: s.previousIntervalDays, consecutiveSuccesses: s.consecutiveSuccesses,
            consecutiveFailures: s.consecutiveFailures, lastAttemptDate: s.lastAttemptDate ? d2i(s.lastAttemptDate) : null,
          },
          { score: b.score, usedHints: b.usedHints, usedNotes: b.usedNotes, correctionCompleted: b.correctionCompleted, date: today },
          policy,
        );
        const now = clock.now();
        const open = await tx.task.findFirst({ where: { revisionScheduleId: s.id, status: "TODO" } });
        const attempt = await tx.revisionAttempt.create({
          data: {
            scheduleId: s.id, promptId: prompt.id, taskId: open?.id ?? null, promptText: prompt.content,
            score: b.score, effectiveScore: u.effectiveScore, retrievalMethod: b.retrievalMethod,
            attemptedAt: now, attemptDate: i2d(today), durationMinutes: b.durationMinutes ?? null,
            usedHints: b.usedHints, usedNotes: b.usedNotes, response: b.response ?? "", mistakes: b.mistakes?.trim() ?? "",
            correctionCompleted: b.score <= 1 ? b.correctionCompleted : false,
            correctedAt: b.score <= 1 && b.correctionCompleted ? now : null,
            comment: b.comment ?? "", intervalDays: u.intervalDays, nextDueDate: u.nextDueDate ? i2d(u.nextDueDate) : null,
            evaluationId: b.evaluationId ?? null, selfScore: b.selfScore ?? null, inputMode: b.inputMode ?? "TYPED",
          },
        });
        await tx.revisionSchedule.update({
          where: { id: s.id },
          data: {
            nextDueDate: u.nextDueDate ? i2d(u.nextDueDate) : null,
            lastAttemptAt: now, lastAttemptDate: i2d(today), lastScore: b.score,
            previousIntervalDays: u.state.previousIntervalDays,
            consecutiveSuccesses: u.state.consecutiveSuccesses,
            consecutiveFailures: u.state.consecutiveFailures,
            correctionPending: u.correctionPending,
          },
        });
        if (open) {
          // Completing the revision task requires this recorded attempt (spec §9.3). It is done today, so it counts on
          // today's workload; originalDate (the due date) keeps any lateness visible.
          await tx.task.update({ where: { id: open.id }, data: { status: "DONE", completedAt: now, scheduledDate: i2d(today) } });
        }
        if (b.durationMinutes) {
          await tx.studySession.create({
            data: { date: i2d(today), minutes: b.durationMinutes, taskId: open?.id ?? null, topicId: s.topicId, note: `Revision: ${label(s)}` },
          });
        }
        await planOpenRevisions(tx, today);
        const next = await tx.task.findFirst({ where: { revisionScheduleId: s.id, status: "TODO" } });
        return {
          attempt: attemptDTO({ ...attempt, schedule: s }),
          nextDueDate: u.nextDueDate,
          nextTaskDate: next ? d2i(next.scheduledDate) : null,
          correctionPending: u.correctionPending,
          intervalDays: u.intervalDays,
          effectiveScore: u.effectiveScore,
        };
      });
    },

    /** Confirm the correction of a failed attempt (REV-08). The only permitted change to a submitted attempt. */
    async correctAttempt(id: number, mistakes?: string) {
      const today = clock.today();
      return prisma.$transaction(async (tx) => {
        const found = await tx.revisionAttempt.findUnique({ where: { id }, select: { scheduleId: true } });
        if (!found) throw notFound("Attempt");
        await tx.$queryRaw`SELECT id FROM "RevisionSchedule" WHERE id = ${found.scheduleId} FOR UPDATE`;
        const a = await tx.revisionAttempt.findUniqueOrThrow({ where: { id }, include: { schedule: true } });
        if (a.effectiveScore > 1) throw new HttpError(409, "NOTHING_TO_CORRECT", "Only attempts scored 0 or 1 need a correction");
        if (!a.correctionCompleted) {
          await tx.revisionAttempt.update({
            where: { id },
            data: { correctionCompleted: true, correctedAt: clock.now(), ...(mistakes?.trim() ? { mistakes: mistakes.trim() } : {}) },
          });
        }
        const latest = await tx.revisionAttempt.findFirst({ where: { scheduleId: a.scheduleId }, orderBy: [{ attemptedAt: "desc" }, { id: "desc" }] });
        if (latest?.id === a.id && a.schedule.correctionPending) {
          const due = dueAfterCorrection(a.schedule.nextDueDate ? d2i(a.schedule.nextDueDate) : null, today);
          await tx.revisionSchedule.update({ where: { id: a.scheduleId }, data: { correctionPending: false, nextDueDate: i2d(due) } });
          await planOpenRevisions(tx, today);
        }
        const s = await tx.revisionSchedule.findUniqueOrThrow({ where: { id: a.scheduleId } });
        const next = await tx.task.findFirst({ where: { revisionScheduleId: s.id, status: "TODO" } });
        return {
          id, correctionCompleted: true,
          nextDueDate: s.nextDueDate ? d2i(s.nextDueDate) : null,
          nextTaskDate: next ? d2i(next.scheduledDate) : null,
        };
      });
    },

    /** A learning checkpoint (spec §6). Recorded only; learned status and schedules are untouched (REV-05). */
    async createCheckpoint(b: CheckpointInput) {
      const today = clock.today();
      return prisma.$transaction(async (tx) => {
        const sub = await tx.subtopic.findUnique({ where: { id: b.subtopicId } });
        if (!sub) throw notFound("Subtopic");
        if (sub.topicId !== b.topicId) throw new HttpError(400, "VALIDATION_ERROR", "subtopicId does not belong to topicId");
        const prompt = await resolvePrompt(tx, { scope: "SUBTOPIC", topicId: b.topicId, subtopicId: b.subtopicId }, b.promptId, b.templateKey);
        const c = await tx.learningCheckpoint.create({
          data: {
            topicId: b.topicId, subtopicId: b.subtopicId, promptId: prompt.id, promptText: prompt.content,
            result: b.result, neededAssistance: b.neededAssistance, gaps: b.gaps?.trim() ?? "", response: b.response ?? "",
            date: i2d(today),
          },
        });
        return checkpointDTO(c);
      });
    },

    async createPrompt(b: PromptInput) {
      const t = await prisma.topic.findUnique({ where: { id: b.topicId } });
      if (!t) throw notFound("Topic");
      if (b.subtopicId) {
        const s = await prisma.subtopic.findUnique({ where: { id: b.subtopicId } });
        if (!s) throw notFound("Subtopic");
        if (s.topicId !== b.topicId) throw new HttpError(400, "VALIDATION_ERROR", "subtopicId does not belong to topicId");
      }
      const p = await prisma.revisionPrompt.create({
        data: {
          topicId: b.topicId, subtopicId: b.subtopicId ?? null, source: "LEARNER",
          title: b.title?.trim() || b.content.trim().slice(0, 80), content: b.content.trim(),
          retrievalMethod: b.retrievalMethod, expectedAnswer: b.expectedAnswer.trim(), difficulty: b.difficulty ?? null,
        },
      });
      return promptDTO(p);
    },

    async patchPrompt(id: number, b: PromptPatch) {
      const p = await prisma.revisionPrompt.findUnique({ where: { id } });
      if (!p) throw notFound("Prompt");
      const onlyActive = Object.keys(b).every((k) => k === "isActive");
      if (p.source !== "LEARNER" && !onlyActive)
        throw new HttpError(409, "PROMPT_READ_ONLY", "Curriculum and template prompts can only be switched on or off");
      const u = await prisma.revisionPrompt.update({
        where: { id },
        data: {
          ...(b.title !== undefined && { title: b.title.trim() || p.title }),
          ...(b.content !== undefined && { content: b.content.trim() }),
          ...(b.retrievalMethod !== undefined && { retrievalMethod: b.retrievalMethod }),
          ...(b.expectedAnswer !== undefined && { expectedAnswer: b.expectedAnswer.trim() }),
          ...(b.difficulty !== undefined && { difficulty: b.difficulty }),
          ...(b.isActive !== undefined && { isActive: b.isActive }),
        },
      });
      return promptDTO(u);
    },

    async deletePrompt(id: number) {
      const p = await prisma.revisionPrompt.findUnique({ where: { id }, include: { _count: { select: { attempts: true, checkpoints: true } } } });
      if (!p) throw notFound("Prompt");
      if (p.source !== "LEARNER") throw new HttpError(409, "PROMPT_READ_ONLY", "Only your own prompts can be deleted; switch this one off instead");
      if (p._count.attempts + p._count.checkpoints > 0)
        throw new HttpError(409, "PROMPT_IN_USE", "This prompt has recorded attempts. Switch it off instead, so the history keeps its question.");
      await prisma.revisionPrompt.delete({ where: { id } });
    },

    /** Everything the topic panel and the recall dialog need for one topic (LLD §4.3). */
    async topicRevision(topicId: string) {
      const today = clock.today();
      const policy = await revisionPolicy(prisma);
      const t = await prisma.topic.findUnique({
        where: { id: topicId },
        include: {
          subtopics: { orderBy: { position: "asc" } },
          revisionSchedules: {
            include: {
              tasks: { where: { status: "TODO" }, select: { id: true, scheduledDate: true } },
              attempts: { orderBy: [{ attemptedAt: "desc" }, { id: "desc" }] },
            },
          },
          prompts: { include: { _count: { select: { attempts: true, checkpoints: true } } }, orderBy: { id: "asc" } },
          checkpoints: { orderBy: [{ completedAt: "desc" }, { id: "desc" }], take: 30 },
        },
      });
      if (!t) throw notFound("Topic");
      const lastUse = new Map<number, string>();
      for (const s of t.revisionSchedules) for (const a of s.attempts) if (a.promptId && !lastUse.has(a.promptId)) lastUse.set(a.promptId, d2i(a.attemptDate));
      for (const c of t.checkpoints) if (c.promptId && !(lastUse.get(c.promptId)! >= d2i(c.date))) lastUse.set(c.promptId, d2i(c.date));
      const learned = t.subtopics.filter((s) => s.completedAt).map((s) => s.name);
      const sched = new Map(t.revisionSchedules.map((s) => [s.unit, s]));
      const subName = new Map(t.subtopics.map((s) => [s.id, s.name]));
      const unitLabel = (scope: RevisionScope, subtopicId: number | null) =>
        scope === "TOPIC" ? `${t.name} (whole topic)` : (subName.get(subtopicId!) ?? "Sub-topic");

      const options = (scope: RevisionScope, subtopicId: number | null) => {
        const stored = t.prompts.filter((p) => (p.subtopicId ?? null) === subtopicId && (scope === "TOPIC" ? p.subtopicId === null : true));
        const storedTpl = new Map(stored.filter((p) => p.source === "TEMPLATE").map((p) => [p.templateKey!, p]));
        const subject = unitSubject({ scope, topicName: t.name, subtopicName: subtopicId ? subName.get(subtopicId) : null, learned });
        const sourceOrder = { CURRICULUM: 0, LEARNER: 1, TEMPLATE: 2 } as const;
        const own = stored
          .filter((p) => p.source !== "TEMPLATE")
          .sort((a, b) => sourceOrder[a.source] - sourceOrder[b.source] || a.id - b.id)
          .map((p) => ({
            promptId: p.id, templateKey: null, source: p.source, title: p.title, content: p.content,
            retrievalMethod: p.retrievalMethod, expectedAnswer: p.expectedAnswer, difficulty: p.difficulty,
            isActive: p.isActive, uses: p._count.attempts + p._count.checkpoints, lastUsedDate: lastUse.get(p.id) ?? null,
          }));
        const tpls = TEMPLATES.map((tpl) => {
          const p = storedTpl.get(tpl.key);
          return {
            promptId: p?.id ?? null, templateKey: tpl.key, source: "TEMPLATE" as const, title: tpl.label,
            content: tpl.content(subject), retrievalMethod: tpl.method(t.districtId), expectedAnswer: tpl.expected,
            difficulty: null, isActive: p?.isActive ?? true,
            uses: p ? p._count.attempts + p._count.checkpoints : 0, lastUsedDate: p ? (lastUse.get(p.id) ?? null) : null,
          };
        });
        const all = [...own, ...tpls];
        // Suggest the least-used active prompt, oldest use first; curriculum and own prompts win ties (spec §9).
        let suggested = -1;
        all.forEach((o, i) => {
          if (!o.isActive) return;
          const best = all[suggested];
          if (!best || o.uses < best.uses || (o.uses === best.uses && (o.lastUsedDate ?? "") < (best.lastUsedDate ?? ""))) suggested = i;
        });
        return { options: all, suggested: Math.max(0, suggested) };
      };

      const unitDTO = (scope: RevisionScope, subtopicId: number | null, learnedAt: Date | null) => {
        const s = sched.get(unitKey(scope, t.id, subtopicId));
        const latest = s?.attempts[0];
        return {
          unit: unitKey(scope, t.id, subtopicId),
          scope, subtopicId, label: unitLabel(scope, subtopicId),
          learned: scope === "TOPIC" ? learned.length >= 2 || t.demonstratedAt !== null : learnedAt !== null,
          eligible: !!s && !s.suspendedAt,
          schedule: s
            ? {
                id: s.id,
                status: displayStatus({ nextDueDate: s.nextDueDate ? d2i(s.nextDueDate) : null, correctionPending: s.correctionPending, suspended: !!s.suspendedAt }, today),
                presentation: revisionPresentation(
                  {
                    suspended: !!s.suspendedAt, correctionPending: s.correctionPending, nextDueDate: s.nextDueDate ? d2i(s.nextDueDate) : null,
                    lastAttemptDate: s.lastAttemptDate ? d2i(s.lastAttemptDate) : null, weak: isWeak(s, policy),
                  },
                  today,
                ),
                nextDueDate: s.nextDueDate ? d2i(s.nextDueDate) : null,
                lastAttemptDate: s.lastAttemptDate ? d2i(s.lastAttemptDate) : null,
                lastScore: s.lastScore,
                consecutiveSuccesses: s.consecutiveSuccesses,
                consecutiveFailures: s.consecutiveFailures,
                weak: isWeak(s, policy),
                correctionPending: s.correctionPending,
                pendingAttemptId: s.correctionPending && latest ? latest.id : null,
                openTask: s.tasks[0] ? { id: s.tasks[0].id, scheduledDate: d2i(s.tasks[0].scheduledDate) } : null,
                attempts: s.attempts.length,
              }
            : null,
          ...options(scope, subtopicId),
        };
      };

      const attempts = t.revisionSchedules
        .flatMap((s) => s.attempts.map((a) => attemptDTO({ ...a, schedule: { scope: s.scope, topic: { name: t.name }, subtopic: s.subtopicId ? { name: subName.get(s.subtopicId) ?? "" } : null } })))
        .sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt) || b.id - a.id);

      return {
        topicId: t.id,
        today,
        policy: { subtopicMinutes: policy.subtopicMinutes, topicMinutes: policy.topicMinutes, dailyBudgetMinutes: policy.dailyBudgetMinutes },
        units: [unitDTO("TOPIC", null, null), ...t.subtopics.map((s) => unitDTO("SUBTOPIC", s.id, s.completedAt))],
        attempts,
        checkpoints: t.checkpoints.map((c) => ({ ...checkpointDTO(c), label: subName.get(c.subtopicId) ?? "" })),
        prompts: t.prompts.filter((p) => p.source !== "TEMPLATE").map(promptDTO),
      };
    },
  };
}

type AttemptRow = Prisma.RevisionAttemptGetPayload<object> & {
  schedule: { scope: RevisionScope; topic: { name: string }; subtopic: { name: string } | null };
};
export const attemptDTO = (a: AttemptRow) => ({
  id: a.id,
  scheduleId: a.scheduleId,
  label: label(a.schedule),
  scope: a.schedule.scope,
  promptId: a.promptId,
  promptText: a.promptText,
  score: a.score,
  presentation: outcomePresentation(a.score),
  effectiveScore: a.effectiveScore,
  retrievalMethod: a.retrievalMethod,
  attemptedAt: a.attemptedAt.toISOString(),
  attemptDate: d2i(a.attemptDate),
  durationMinutes: a.durationMinutes,
  usedHints: a.usedHints,
  usedNotes: a.usedNotes,
  response: a.response,
  mistakes: a.mistakes,
  correctionCompleted: a.correctionCompleted,
  correctedAt: a.correctedAt?.toISOString() ?? null,
  comment: a.comment,
  intervalDays: a.intervalDays,
  nextDueDate: a.nextDueDate ? d2i(a.nextDueDate) : null,
  evaluationId: a.evaluationId,
  selfScore: a.selfScore,
  inputMode: a.inputMode,
});

const checkpointDTO = (c: Prisma.LearningCheckpointGetPayload<object>) => ({
  id: c.id, topicId: c.topicId, subtopicId: c.subtopicId, promptId: c.promptId, promptText: c.promptText,
  result: c.result, presentation: checkpointPresentation(c.result), neededAssistance: c.neededAssistance, gaps: c.gaps, response: c.response,
  date: d2i(c.date), completedAt: c.completedAt.toISOString(),
});

const promptDTO = (p: Prisma.RevisionPromptGetPayload<object>) => ({
  id: p.id, topicId: p.topicId, subtopicId: p.subtopicId, source: p.source, title: p.title, content: p.content,
  retrievalMethod: p.retrievalMethod, expectedAnswer: p.expectedAnswer, difficulty: p.difficulty, isActive: p.isActive,
});
