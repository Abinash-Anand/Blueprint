/**
 * The scheduler (Blueprint relationship model, phase 2; docs/Scheduler-Phase2-Plan.md). Pure and deterministic: given
 * a city's tasks and its time, it decides on which day each open task goes from today on. It never changes a due date
 * (the revision engine owns those) and never reads the database or the clock.
 *
 * Each study day, in order:
 *   1. fixed work (finished, manual, pinned tasks, and today's open tasks) uses up its time;
 *   2. recalls, oldest due first, go in the day's revision time and may borrow up to a share of its new-material time;
 *   3. new material, in its original order, fills what is left of the new-material time.
 * The forecast walks the same day rules (dayBudget, takeRecall), so the plan and the forecast cannot disagree.
 */
import { type ISODate, addDays, isoWeekday } from "./dates.js";

/* ---------------- the day rules (shared with the forecast) ---------------- */

/** How much of a day's new-material time extra revision may borrow (the learner's answer to the phase 2 plan). */
export const BORROW_SHARE = 0.5;

/** A weekday's time: what the learner has (availability) and how much of it is new material (allocation). */
export interface DayTime { available: number; newTarget: number }

/** A day's time split as the relationship model says: revision time, new-material time, and what revision may borrow. */
export interface DayBudget { available: number; revision: number; newMaterial: number; borrow: number }

export function dayBudget(d: DayTime, borrowShare = BORROW_SHARE): DayBudget {
  const available = Math.max(d.available, d.newTarget);
  return { available, revision: available - d.newTarget, newMaterial: d.newTarget, borrow: Math.floor(d.newTarget * borrowShare) };
}

/** What a day has used so far: revision minutes, new-material minutes (including what revision borrowed), and the borrowing. */
export interface DayUse { revision: number; newMaterial: number; borrowed: number }
export const emptyUse = (): DayUse => ({ revision: 0, newMaterial: 0, borrowed: 0 });

/** Revision that is already on the day (a finished recall): it uses revision time first, then the new-material time. */
export function useRevision(b: DayBudget, u: DayUse, minutes: number) {
  const room = Math.max(0, b.revision - u.revision);
  const over = Math.max(0, minutes - room);
  u.revision += minutes - over;
  u.newMaterial += over;
  u.borrowed += over;
}

/**
 * Whether a recall of `minutes` fits the day: in what is left of the revision time, or with the rest borrowed from the
 * new-material time, within the borrow cap and what new-material time is left. Records it when it fits.
 */
export function takeRecall(b: DayBudget, u: DayUse, minutes: number): boolean {
  const room = Math.max(0, b.revision - u.revision);
  const over = Math.max(0, minutes - room);
  if (over > 0 && (over > b.borrow - u.borrowed || over > b.newMaterial - u.newMaterial)) return false;
  u.revision += minutes - over;
  u.newMaterial += over;
  u.borrowed += over;
  return true;
}

/** New-material minutes still free on the day. */
export const newRoom = (b: DayBudget, u: DayUse) => Math.max(0, b.newMaterial - u.newMaterial);

/* ---------------- re-planning ---------------- */

export interface SchedStage {
  id: string;
  kind: "MAIN" | "PARALLEL";
  start: ISODate;
  end: ISODate;
  /** ISO weekdays (1 = Monday … 7 = Sunday) the stage studies on. */
  weekdays: number[];
  /** Tasks of stages with the same queue form one sequence. */
  queue: string;
}

export interface SchedTask {
  id: number;
  kind: "NEW" | "RECALL";
  /**
   * OPEN: may move. FIXED: never moves, and uses time on its day (finished, the learner's own, moved by hand, or the
   * old revision system's). SKIPPED: never moves and uses no time.
   */
  state: "OPEN" | "FIXED" | "SKIPPED";
  minutes: number;
  /** The day it is on now. */
  date: ISODate;
  /** New material: its place in the order (with position). A recall: its due date. */
  originalDate: ISODate;
  position: number;
  /** New material's stage (its weekdays, start and queue); null or unknown: any study day, in its own queue. */
  stageId: string | null;
}

export interface ReplanInput {
  today: ISODate;
  /** Minutes per ISO weekday. */
  week: Record<number, DayTime>;
  stages: SchedStage[];
  tasks: SchedTask[];
  borrowShare?: number;
  /** How far ahead to place work at most (default three years); what does not fit stays where it is. */
  horizonDays?: number;
}

export interface Move { id: number; from: ISODate; to: ISODate }

/**
 * A task split to fill a day's room: the task keeps `minutes` (on its moved day), and each part becomes a new task
 * right after it (same original date and position, a higher id), in order.
 */
export interface Split { id: number; minutes: number; parts: { minutes: number; date: ISODate }[] }

export interface ReplanResult {
  /** Open tasks whose day changes (for a split task, the day of its first part). */
  moves: Move[];
  /** Tasks split across days. */
  splits: Split[];
  /** Open tasks that found no day within the horizon: left where they are. */
  unplaced: number[];
}

/** New material is split in steps of this many minutes, and no part is shorter than MIN_PART. */
export const SPLIT_STEP = 15;
export const MIN_PART = 30;

const byOrder = (a: SchedTask, b: SchedTask) => a.originalDate.localeCompare(b.originalDate) || a.position - b.position || a.id - b.id;

/**
 * Re-plans a city's open work from today. Today's open tasks stay on today (the learner may be partway through); only
 * work carried over from earlier days may join them in today's free time. From tomorrow, all open work flows again.
 * A task that does not fit the room left in a day is split: the part that fits goes there (in SPLIT_STEP minutes, at
 * least MIN_PART), the rest continues on the next days, so time is not left unused when the learner's hours change.
 * Guarantees (tests/unit/scheduler.test.ts): new material keeps its order within its queue; no day gets more new
 * material than its new-material time, or more than its time in all (unless fixed work already overfills it, a day
 * too short for any part takes a task alone, or a recall too big for any day goes alone); a recall never goes before
 * its due date; fixed and skipped tasks never move; re-planning its own result moves and splits nothing.
 */
export function replan(input: ReplanInput): ReplanResult {
  const { today } = input;
  const share = input.borrowShare ?? BORROW_SHARE;
  const horizon = input.horizonDays ?? 3 * 366;
  const stage = new Map(input.stages.map((s) => [s.id, s]));
  const parallels = input.stages.filter((s) => s.kind === "PARALLEL");
  const budget = (d: ISODate) => dayBudget(input.week[isoWeekday(d)] ?? { available: 0, newTarget: 0 }, share);
  // Days a parallel stage claims are not used by main stages (as when the plan was first built).
  const reserved = (d: ISODate) => parallels.some((s) => d >= s.start && d <= s.end && s.weekdays.includes(isoWeekday(d)));
  // A stage starts on its start date, or earlier once every earlier stage of its kind has all its open work placed: more
  // time then means an earlier finish (docs/Availability-Phase3-Plan.md, 4b). Its weekdays, and the days a parallel stage
  // claims, still apply. Stage dates stay as they are: targets the learner can be ahead of or behind.
  const openLeft = new Map<string, number>();
  for (const t of input.tasks) {
    if (t.kind === "NEW" && t.state === "OPEN" && t.date !== today && t.stageId && stage.has(t.stageId)) openLeft.set(t.stageId, (openLeft.get(t.stageId) ?? 0) + 1);
  }
  const earlier = new Map(input.stages.map((s) => [s.id, input.stages.filter((o) => o.kind === s.kind && o.start < s.start).map((o) => o.id)]));
  const started = (s: SchedStage, d: ISODate) => d >= s.start || earlier.get(s.id)!.every((p) => !openLeft.get(p));
  const eligible = (t: SchedTask, d: ISODate) => {
    const s = t.stageId ? stage.get(t.stageId) : undefined;
    if (!s) return true;
    return started(s, d) && s.weekdays.includes(isoWeekday(d)) && (s.kind === "PARALLEL" || !reserved(d));
  };

  // What is already on each day and stays there: fixed work, and today's open tasks.
  const stays = (t: SchedTask) => t.state === "FIXED" || (t.state === "OPEN" && t.date === today);
  const fixed = new Map<ISODate, { revision: number; newMaterial: number }>();
  for (const t of input.tasks) {
    if (!stays(t) || t.date < today) continue;
    const f = fixed.get(t.date) ?? { revision: 0, newMaterial: 0 };
    if (t.kind === "RECALL") f.revision += t.minutes;
    else f.newMaterial += t.minutes;
    fixed.set(t.date, f);
  }

  const movable = input.tasks.filter((t) => t.state === "OPEN" && t.date !== today);
  const recalls = movable.filter((t) => t.kind === "RECALL").sort((a, b) => a.originalDate.localeCompare(b.originalDate) || a.id - b.id);
  // New material by queue, each in its original order; queues in the order their first stage starts.
  // Tasks without a (known) stage form one queue of their own, in order.
  const queueOf = (t: SchedTask) => (t.stageId && stage.get(t.stageId)?.queue) || "";
  const queues = new Map<string, SchedTask[]>();
  for (const t of movable.filter((x) => x.kind === "NEW").sort(byOrder)) queues.set(queueOf(t), [...(queues.get(queueOf(t)) ?? []), t]);
  const queueStart = (q: string) => input.stages.filter((s) => s.queue === q).map((s) => s.start).sort()[0] ?? "";
  const lines = [...queues.entries()].sort(([a, x], [b, y]) => queueStart(a).localeCompare(queueStart(b)) || byOrder(x[0], y[0])).map(([, ts]) => ts);

  // The largest recall any day can hold; a bigger one goes on a study day by itself, as revision must not wait forever.
  const weekBudgets = [1, 2, 3, 4, 5, 6, 7].map((wd) => dayBudget(input.week[wd] ?? { available: 0, newTarget: 0 }, share));
  const maxRecall = Math.max(0, ...weekBudgets.map((b) => b.revision + Math.min(b.borrow, b.newMaterial)));

  const placed = new Map<number, ISODate>();
  /** New material placed so far, by task: its parts in order (more than one when split). */
  const partsOf = new Map<number, { minutes: number; date: ISODate }[]>();
  const leftOf = (t: SchedTask) => t.minutes - (partsOf.get(t.id) ?? []).reduce((a, p) => a + p.minutes, 0);
  let pending = recalls;
  const heads = lines.map(() => 0);
  const left = () => pending.length > 0 || lines.some((ts, i) => heads[i] < ts.length);

  for (let n = 0; n < horizon && left(); n++) {
    const d = addDays(today, n);
    const b = budget(d);
    if (b.available <= 0) continue;
    const u = emptyUse();
    const f = fixed.get(d);
    if (f) {
      useRevision(b, u, f.revision);
      u.newMaterial += f.newMaterial;
    }
    // Today takes only work carried over from earlier days.
    const carried = (t: SchedTask) => n > 0 || t.date < today;

    // Recalls that are due, oldest due first; the first that does not fit waits for the next study day, with those behind it.
    const waiting: SchedTask[] = [];
    let full = false;
    for (const t of pending) {
      if (full || t.originalDate > d || !carried(t)) {
        waiting.push(t);
        continue;
      }
      const alone = t.minutes > maxRecall && u.revision === 0 && u.newMaterial === 0;
      if (alone) u.revision += t.minutes;
      else if (!takeRecall(b, u, t.minutes)) {
        full = true;
        waiting.push(t);
        continue;
      }
      placed.set(t.id, d);
    }
    pending = waiting;

    // New material: each queue in turn (in the order its stages start) takes what fits, in its own order. A task that
    // does not fit is split: the part that fits goes today and the rest waits at the head of its queue. A day too short
    // for any part takes a task whole, alone, rather than holding up its queue for ever.
    for (let i = 0; i < lines.length; i++) {
      for (let t = lines[i][heads[i]]; t; t = lines[i][heads[i]]) {
        if (!eligible(t, d) || !carried(t)) break;
        const left = leftOf(t);
        const room = newRoom(b, u);
        let take = left;
        if (left > room) {
          // The most that fits, leaving at least MIN_PART for later.
          const part = Math.min(Math.floor(room / SPLIT_STEP), Math.floor((left - MIN_PART) / SPLIT_STEP)) * SPLIT_STEP;
          if (part >= MIN_PART && left - part >= MIN_PART) take = part;
          else if (!(u.newMaterial === 0 && b.newMaterial > 0 && b.newMaterial < MIN_PART)) break;
        }
        u.newMaterial += take;
        partsOf.set(t.id, [...(partsOf.get(t.id) ?? []), { minutes: take, date: d }]);
        if (take < left) break; // the day is full; the rest of this task continues tomorrow
        placed.set(t.id, partsOf.get(t.id)![0].date);
        if (t.stageId && openLeft.has(t.stageId)) openLeft.set(t.stageId, openLeft.get(t.stageId)! - 1);
        heads[i]++;
      }
    }
  }

  const moves: Move[] = [];
  const splits: Split[] = [];
  const unplaced: number[] = [];
  for (const t of movable) {
    const to = placed.get(t.id);
    if (!to) {
      unplaced.push(t.id); // a task only partly placed within the horizon stays whole, where it is
      continue;
    }
    if (to !== t.date) moves.push({ id: t.id, from: t.date, to });
    const parts = partsOf.get(t.id);
    if (parts && parts.length > 1) splits.push({ id: t.id, minutes: parts[0].minutes, parts: parts.slice(1) });
  }
  return { moves: moves.sort((a, b) => a.id - b.id), splits: splits.sort((a, b) => a.id - b.id), unplaced: unplaced.sort((a, b) => a - b) };
}
