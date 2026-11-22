/**
 * Forecast (Blueprint relationship model, phase 1): what is realistically achievable with the learner's time. Pure and
 * deterministic; it reports and never schedules.
 *
 * It walks the calendar from today with the scheduler's day rules (domain/scheduler.ts), so it predicts what the plan
 * will do. Each day offers the learner's available minutes (availability). Recalls that are due are done first, in the
 * day's revision time (available − new-material target); revision that does not fit there may borrow up to half the
 * new-material time, and the rest waits for the next study day. New material then fills what is left of the day's
 * new-material target (allocation). Every recall is assumed remembered (its stage goes up), so the forecast is the
 * best case for revision; sub-topics that are not yet in recall add no recall demand.
 */
import { type ISODate, addDays, diffDays, isoWeekday, weekStart } from "./dates.js";
import { dayBudget, emptyUse, newRoom, takeRecall } from "./scheduler.js";

export interface ForecastDay { available: number; newTarget: number }

export interface ForecastInput {
  today: ISODate;
  /** The plan's last day (the journey's end). */
  planEnd: ISODate;
  /** The finish date the learner asked for, if any. */
  targetDate: ISODate | null;
  /** Minutes per ISO weekday (1 = Monday … 7 = Sunday). */
  week: Record<number, ForecastDay>;
  /** New-material work still open (study and practice tasks not done or skipped), in minutes. */
  remainingNewMinutes: number;
  /** Sub-topics in recall: their stage and next due date. */
  recalls: { stage: number; nextDueDate: ISODate }[];
  recallMinutes: number;
  /** Days until a recall is due again after a remembered recall at a stage (rules.ts gapFor). */
  gapFor: (stage: number) => number;
  /** The forecast looks this far ahead at most (default three years). */
  horizonDays?: number;
}

export interface Forecast {
  remainingNewMinutes: number;
  /** When the open new material is done; null when it does not fit within the horizon. */
  projectedFinish: ISODate | null;
  planEnd: ISODate;
  /** projectedFinish − planEnd in days (positive: later than the plan). */
  daysVsPlan: number | null;
  targetDate: ISODate | null;
  /** Null without a target date. */
  meetsTarget: boolean | null;
  /** New-material minutes a week needed from today to finish by the target date (null without one, or past it). */
  neededNewMinutesPerWeek: number | null;
  /** The learner's week as planned: available, new material and revision minutes. */
  week: { available: number; newMaterial: number; revision: number };
  /** Expected revision for the next four weeks (Monday-based), best case. */
  revisionLoad: { weekStart: ISODate; recalls: number; minutes: number }[];
}

export function forecast(i: ForecastInput): Forecast {
  const horizon = i.horizonDays ?? 3 * 366;
  const day = (d: ISODate) => i.week[isoWeekday(d)] ?? { available: 0, newTarget: 0 };
  const week = [1, 2, 3, 4, 5, 6, 7].reduce(
    (a, wd) => {
      const x = i.week[wd] ?? { available: 0, newTarget: 0 };
      const available = Math.max(x.available, x.newTarget);
      return { available: a.available + available, newMaterial: a.newMaterial + x.newTarget, revision: a.revision + available - x.newTarget };
    },
    { available: 0, newMaterial: 0, revision: 0 },
  );

  // Due recalls, as a queue of next due dates with their stages.
  let due = i.recalls.map((r) => ({ stage: r.stage, at: r.nextDueDate < i.today ? i.today : r.nextDueDate }));
  const loadStart = weekStart(i.today);
  const loadWeeks = [0, 1, 2, 3].map((n) => ({ weekStart: addDays(loadStart, 7 * n), recalls: 0, minutes: 0 }));
  const loadEnd = addDays(loadStart, 28);

  let left = Math.max(0, i.remainingNewMinutes);
  let finish: ISODate | null = left === 0 ? i.today : null;
  for (let n = 0; n < horizon && (finish === null || addDays(i.today, n) < loadEnd); n++) {
    const d = addDays(i.today, n);
    const b = dayBudget(day(d));
    if (b.available <= 0) continue;
    // Revision first, oldest first, as far as the day's rules allow.
    const ready = due.filter((r) => r.at <= d).sort((a, b) => a.at.localeCompare(b.at));
    const u = emptyUse();
    for (const r of ready) {
      if (!takeRecall(b, u, i.recallMinutes)) break;
      r.stage += 1;
      r.at = addDays(d, i.gapFor(r.stage));
      if (d < loadEnd) {
        const w = loadWeeks[Math.floor(diffDays(loadStart, d) / 7)];
        if (w) { w.recalls += 1; w.minutes += i.recallMinutes; }
      }
    }

    // New material: what is left of the day's target after any revision that borrowed from it.
    const fresh = newRoom(b, u);
    if (finish === null && left > 0) {
      left -= fresh;
      if (left <= 0) finish = d;
    }
  }

  const target = i.targetDate;
  const weeksToTarget = target && target >= i.today ? (diffDays(i.today, target) + 1) / 7 : null;
  return {
    remainingNewMinutes: Math.max(0, i.remainingNewMinutes),
    projectedFinish: finish,
    planEnd: i.planEnd,
    daysVsPlan: finish ? diffDays(i.planEnd, finish) : null,
    targetDate: target,
    meetsTarget: target ? finish !== null && finish <= target : null,
    neededNewMinutesPerWeek: weeksToTarget && weeksToTarget > 0 ? Math.ceil(i.remainingNewMinutes / weeksToTarget) : null,
    week,
    revisionLoad: loadWeeks,
  };
}
