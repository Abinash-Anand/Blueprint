/**
 * Bulk rescheduling of overdue tasks (SRS §6.8, LLD §12.3). Pure.
 */
import { type ISODate, addDays, isoWeekday } from "./dates.js";

export interface OverdueTask {
  id: number;
  minutes: number;
  scheduledDate: ISODate;
  originalDate: ISODate;
  position: number;
}

export interface Move {
  id: number;
  from: ISODate;
  to: ISODate;
}

/**
 * Place overdue tasks, oldest first, on the first study day from `today` onward whose
 * planned load plus the task fits within the day's target. Sundays (and 0-target days) are never used.
 * `load` maps date → planned minutes already on that day (non-skipped tasks).
 */
export function placeOverdue(
  overdue: OverdueTask[],
  load: Map<ISODate, number>,
  targetByWeekday: Record<number, number>,
  today: ISODate,
  horizonDays = 400,
): Move[] {
  const target = (d: ISODate) => targetByWeekday[isoWeekday(d)] ?? 0;
  const ordered = [...overdue].sort(
    (a, b) => a.originalDate.localeCompare(b.originalDate) || a.position - b.position || a.id - b.id,
  );
  const moves: Move[] = [];
  let d = today;
  const limit = addDays(today, horizonDays);
  for (const t of ordered) {
    // A task larger than any day's target goes onto the next empty study day.
    while (d <= limit) {
      const cap = target(d);
      const l = load.get(d) ?? 0;
      if (isoWeekday(d) !== 7 && cap > 0 && (l + t.minutes <= cap || (l === 0 && t.minutes > cap))) break;
      d = addDays(d, 1);
    }
    if (d > limit) break;
    load.set(d, (load.get(d) ?? 0) + t.minutes);
    moves.push({ id: t.id, from: t.scheduledDate, to: d });
  }
  return moves;
}
