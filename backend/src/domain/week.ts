/**
 * The learner's week from the "Your time" sheet (docs/Availability-Phase3-Plan.md), and back. Pure. The preview and the
 * save both build the week here, so what is previewed is exactly what is saved.
 *
 * A study day is available for the minutes given and gets new material at the pace's share of them (to the nearest
 * 15 minutes); the rest of the day is revision time. A rest day is 0 for both. The "CURRENT" pace keeps each weekday's
 * own split, so a city whose split matches no preset keeps it until the learner picks one.
 */
import type { DayTime } from "./scheduler.js";

/** Share of the time planned for new material per pace: the same as at city creation (ai/curriculum/generator.ts). */
export const PACES = { LIGHT: 0.6, STEADY: 0.75, INTENSIVE: 0.9 } as const;
export type PresetPace = keyof typeof PACES;
export type Pace = PresetPace | "CURRENT";

export const STEP_MINUTES = 15;
export const MAX_MINUTES_PER_DAY = 16 * 60;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

export interface TimeChoice {
  /** Minutes on each study day. */
  minutesPerDay: number;
  /** ISO weekdays (1 = Monday … 7 = Sunday) the learner studies on. */
  studyDays: number[];
  pace: Pace;
}

export type Week = Record<number, DayTime>;

const toStep = (minutes: number) => Math.round(minutes / STEP_MINUTES) * STEP_MINUTES;

/** The share of new material on the current study days: the middle one, or Steady when there are none. */
function typicalShare(current: Week) {
  const shares = WEEKDAYS.map((d) => current[d]).filter((d) => d && d.available > 0).map((d) => d.newTarget / d.available).sort((a, b) => a - b);
  return shares.length ? shares[Math.floor(shares.length / 2)] : PACES.STEADY;
}

/** The week a choice makes. "CURRENT" keeps each weekday's split (a newly added study day takes the typical one). */
export function weekFromChoice(c: TimeChoice, current: Week): Week {
  const typical = typicalShare(current);
  const week: Week = {};
  for (const d of WEEKDAYS) {
    if (!c.studyDays.includes(d) || c.minutesPerDay <= 0) {
      week[d] = { available: 0, newTarget: 0 };
      continue;
    }
    const now = current[d];
    const share = c.pace === "CURRENT" ? (now && now.available > 0 ? now.newTarget / now.available : typical) : PACES[c.pace];
    week[d] = { available: c.minutesPerDay, newTarget: Math.min(c.minutesPerDay, toStep(c.minutesPerDay * share)) };
  }
  return week;
}

export interface WeekDescription extends TimeChoice {
  /** New material's share of the study time (the middle study day's), for showing "Current". */
  share: number;
  /** False when the study days do not all have the same minutes: the sheet's one number would change some. */
  uniform: boolean;
}

/** The sheet's view of the current week: its study days, minutes a day, and the preset it matches, else "CURRENT". */
export function describeWeek(current: Week): WeekDescription {
  const studyDays = WEEKDAYS.filter((d) => (current[d]?.available ?? 0) > 0);
  const counts = new Map<number, number>();
  for (const d of studyDays) counts.set(current[d].available, (counts.get(current[d].available) ?? 0) + 1);
  const minutesPerDay = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
  const same = (w: Week) => WEEKDAYS.every((d) => (w[d]?.available ?? 0) === (current[d]?.available ?? 0) && (w[d]?.newTarget ?? 0) === (current[d]?.newTarget ?? 0));
  const preset = (Object.keys(PACES) as PresetPace[]).find((p) => same(weekFromChoice({ minutesPerDay, studyDays, pace: p }, current)));
  return { minutesPerDay, studyDays, pace: preset ?? "CURRENT", share: typicalShare(current), uniform: counts.size <= 1 };
}
