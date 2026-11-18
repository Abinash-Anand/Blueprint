/**
 * Active recall and adaptive revision (Revision spec §7–§8, SRS §3.9, LLD §12.5). Pure and deterministic:
 * identical inputs and policy always give identical schedules (NFR-REV-01).
 */
import { type ISODate, addDays, diffDays, isoWeekday, weekStart } from "./dates.js";

export type RecallScore = 0 | 1 | 2 | 3;

/**
 * Initial product policy, not a proven optimum (spec §8.1). Tune it from real attempt data later (spec phase 8).
 */
export const REVISION_POLICY = {
  /** First retrieval of a sub-topic: the day after it was marked learned. */
  firstIntervalDays: 1,
  /** First topic-level (integration) revision after the topic becomes eligible. */
  topicFirstIntervalDays: 3,
  /** Scores 0–1: try again the next day (after correcting the gap). */
  failIntervalDays: 1,
  /** Score 2: moderate interval, no extension. */
  partialIntervalDays: 3,
  /** Score 3 on the 1st, 2nd, 3rd consecutive success; afterwards the interval doubles. */
  successLadder: [7, 14, 30] as readonly number[],
  maxIntervalDays: 60,
  /** Consecutive scores of 0–1 that flag a unit as weak (spec §8.2 rule D). */
  weakAfterFailures: 2,
  /** Session lengths chosen from the capacity simulation (SRS A.4): one concept vs. an integration question. */
  subtopicMinutes: 10,
  topicMinutes: 20,
  /**
   * Revision minutes a study day always accepts on top of its planned learning, so revision is never starved by a
   * full curriculum day. A day with free capacity (a buffer day) accepts up to that free capacity instead.
   */
  dailyBudgetMinutes: 30,
  /**
   * Over-target revision minutes a whole week may carry (Mon–Sat). Revision first uses free capacity; only what does not
   * fit becomes over-target time, capped per day by dailyBudgetMinutes and per week by this value.
   * 0 for both gives a strict 4 h day (revision only in free capacity). Live value: Settings.revisionWeeklyOvertimeMinutes.
   */
  weeklyOvertimeMinutes: 120,
  /** How far ahead the placer looks for room. */
  horizonDays: 400,
};
export type RevisionPolicy = typeof REVISION_POLICY;

export interface ScheduleState {
  previousIntervalDays: number;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  lastAttemptDate: ISODate | null;
}

export interface AttemptFacts {
  score: RecallScore;
  usedHints: boolean;
  usedNotes: boolean;
  correctionCompleted: boolean;
  date: ISODate;
}

export interface ScheduleUpdate {
  state: ScheduleState;
  /** null = wait for the correction before scheduling anything (score 0, not yet corrected). */
  nextDueDate: ISODate | null;
  correctionPending: boolean;
  intervalDays: number;
  /** The score the scheduler acted on: a 3 achieved with hints or notes counts as 2. */
  effectiveScore: RecallScore;
}

/** Rules A–D (spec §8.2). */
export function applyAttempt(s: ScheduleState, a: AttemptFacts, p: RevisionPolicy = REVISION_POLICY): ScheduleUpdate {
  const effectiveScore: RecallScore = a.score === 3 && (a.usedHints || a.usedNotes) ? 2 : a.score;
  const next = (interval: number, state: ScheduleState, pending = false): ScheduleUpdate => ({
    state: { ...state, previousIntervalDays: interval, lastAttemptDate: a.date },
    nextDueDate: addDays(a.date, interval),
    correctionPending: pending,
    intervalDays: interval,
    effectiveScore,
  });

  if (effectiveScore <= 1) {
    // Rule A / D: reset the success sequence, keep the interval short, require a correction.
    const state = { ...s, consecutiveSuccesses: 0, consecutiveFailures: s.consecutiveFailures + 1 };
    const pending = !a.correctionCompleted;
    if (a.score === 0 && pending) {
      return {
        state: { ...state, previousIntervalDays: p.failIntervalDays, lastAttemptDate: a.date },
        nextDueDate: null,
        correctionPending: true,
        intervalDays: p.failIntervalDays,
        effectiveScore,
      };
    }
    return next(p.failIntervalDays, state, pending);
  }
  if (effectiveScore === 2) {
    // Rule B: keep the success history, moderate interval, no extension.
    return next(p.partialIntervalDays, { ...s, consecutiveFailures: 0 });
  }
  // Rule C: extend. Beyond the ladder, double the longer of the planned and the actually elapsed interval.
  const k = s.consecutiveSuccesses;
  const elapsed = s.lastAttemptDate ? diffDays(s.lastAttemptDate, a.date) : 0;
  const interval =
    k < p.successLadder.length
      ? p.successLadder[k]
      : Math.min(Math.max(s.previousIntervalDays, elapsed) * 2, p.maxIntervalDays);
  return next(interval, { ...s, consecutiveSuccesses: k + 1, consecutiveFailures: 0 });
}

/** A correction confirmed on `date`: a score-0 unit waiting for it is scheduled for the next day (spec §8.3). */
export function dueAfterCorrection(nextDueDate: ISODate | null, date: ISODate, p: RevisionPolicy = REVISION_POLICY): ISODate {
  return nextDueDate ?? addDays(date, p.failIntervalDays);
}

export const isWeak = (s: Pick<ScheduleState, "consecutiveFailures">, p: RevisionPolicy = REVISION_POLICY) =>
  s.consecutiveFailures >= p.weakAfterFailures;

export type RevisionDisplayStatus = "SCHEDULED" | "DUE" | "OVERDUE" | "AWAITING_CORRECTION" | "SUSPENDED";

export function displayStatus(
  x: { nextDueDate: ISODate | null; correctionPending: boolean; suspended: boolean },
  today: ISODate,
): RevisionDisplayStatus {
  if (x.suspended) return "SUSPENDED";
  if (x.nextDueDate === null) return "AWAITING_CORRECTION";
  if (x.nextDueDate < today) return "OVERDUE";
  if (x.nextDueDate === today) return "DUE";
  return "SCHEDULED";
}

/** Earliest date a schedule becomes due when it is first created (REV-02, REV-03). */
export function firstDueDate(scope: "SUBTOPIC" | "TOPIC", eligibleSince: ISODate, p: RevisionPolicy = REVISION_POLICY): ISODate {
  return addDays(eligibleSince, scope === "TOPIC" ? p.topicFirstIntervalDays : p.firstIntervalDays);
}

export interface RevisionCandidate {
  scheduleId: number;
  dueDate: ISODate;
  minutes: number;
  weak: boolean;
  lastScore: number | null;
  lastAttemptDate: ISODate | null;
}

/**
 * Priority (spec §8.5): overdue weak units first, then the oldest due date, then the lowest last score,
 * then the longest time since the last attempt. Deterministic tie-break on id.
 */
export function revisionOrder(today: ISODate) {
  return (a: RevisionCandidate, b: RevisionCandidate) => {
    const aw = a.weak && a.dueDate < today ? 0 : 1;
    const bw = b.weak && b.dueDate < today ? 0 : 1;
    return (
      aw - bw ||
      a.dueDate.localeCompare(b.dueDate) ||
      (a.lastScore ?? 4) - (b.lastScore ?? 4) ||
      (a.lastAttemptDate ?? "").localeCompare(b.lastAttemptDate ?? "") ||
      a.scheduleId - b.scheduleId
    );
  };
}

export interface RevisionPlacement {
  scheduleId: number;
  date: ISODate;
}

/** Minutes a day is planned beyond its target (learning + revision − target), never negative. */
export function overTarget(learning: number, revision: number, target: number) {
  return Math.max(0, learning + revision - target);
}

/**
 * Place revision tasks on study days (REV-17, REV-19, SRS BR-18). Revision counts inside the planned workload:
 *
 *  1. From max(due date, today) to the Saturday of that week, take the first study day where the revision fits in the
 *     day's free capacity (target − planned learning − planned revision): no over-target time.
 *  2. Otherwise take the first day in that same range where the day's revision stays within
 *     max(daily allowance, free capacity) AND the week's over-target minutes stay within the weekly allowance.
 *  3. Otherwise try the next week.
 *
 * Sundays and 0-target days are never used, so Sunday stays optional. Learning tasks are only read, never moved.
 * Deterministic for identical inputs (NFR-REV-01). Mutates the revision load map.
 */
export function placeRevisions(
  candidates: RevisionCandidate[],
  learningLoad: Map<ISODate, number>,
  revisionLoad: Map<ISODate, number>,
  targetByWeekday: Record<number, number>,
  today: ISODate,
  p: RevisionPolicy = REVISION_POLICY,
): RevisionPlacement[] {
  const target = (d: ISODate) => targetByWeekday[isoWeekday(d)] ?? 0;
  const L = (d: ISODate) => learningLoad.get(d) ?? 0;
  const R = (d: ISODate) => revisionLoad.get(d) ?? 0;
  const study = (d: ISODate) => isoWeekday(d) !== 7 && target(d) > 0;
  const weekOver = (ws: ISODate) => {
    let o = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      o += overTarget(L(d), R(d), target(d));
    }
    return o;
  };
  const out: RevisionPlacement[] = [];
  const limit = addDays(today, p.horizonDays);
  for (const c of [...candidates].sort(revisionOrder(today))) {
    let from = c.dueDate > today ? c.dueDate : today;
    let placed: ISODate | null = null;
    while (!placed && from <= limit) {
      const ws = weekStart(from);
      const days: ISODate[] = [];
      for (let d = from; d <= addDays(ws, 5); d = addDays(d, 1)) if (study(d)) days.push(d);
      placed = days.find((d) => R(d) + c.minutes <= target(d) - L(d)) ?? null;
      if (!placed) {
        const used = weekOver(ws);
        placed =
          days.find((d) => {
            if (R(d) + c.minutes > Math.max(p.dailyBudgetMinutes, target(d) - L(d))) return false;
            const extra = overTarget(L(d), R(d) + c.minutes, target(d)) - overTarget(L(d), R(d), target(d));
            return used + extra <= p.weeklyOvertimeMinutes;
          }) ?? null;
      }
      from = addDays(ws, 7);
    }
    if (!placed) continue;
    revisionLoad.set(placed, R(placed) + c.minutes);
    out.push({ scheduleId: c.scheduleId, date: placed });
  }
  return out;
}

/**
 * Interleave a revision session (spec §11): keep the priority order but avoid two consecutive items from the same
 * topic when another topic is available.
 */
export function interleave<T>(items: T[], key: (t: T) => string): T[] {
  const rest = [...items];
  const out: T[] = [];
  while (rest.length) {
    const last = out.length ? key(out[out.length - 1]) : null;
    const i = rest.findIndex((x) => key(x) !== last);
    out.push(...rest.splice(i === -1 ? 0 : i, 1));
  }
  return out;
}
