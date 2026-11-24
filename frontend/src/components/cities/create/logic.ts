/**
 * City creation, the parts without UI: what the time screen promises (it uses the same pace shares and the same
 * three-year limit as the backend generator, so the finish date shown is the one the plan will have), which files can
 * be added, and where a returning learner continues.
 */
import type { CityAttachment, CityConstraints, CurriculumVersion, Understanding } from "../../../api/types";

export type Pace = "LIGHT" | "STEADY" | "INTENSIVE";
/** Fallback when the server does not say (it always does since city intake). */
export const DEFAULT_PACES: Record<Pace, number> = { LIGHT: 0.6, STEADY: 0.75, INTENSIVE: 0.9 };
/** The longest journey Blueprint plans (backend contract MAX_JOURNEY_DAYS). */
export const MAX_JOURNEY_DAYS = 3 * 366;

const DAY = 86_400_000;
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const addDaysIso = (iso: string, days: number) => new Date(toDate(iso).getTime() + days * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
/** "14 May 2027" */
export const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const isoWeekday = (iso: string) => toDate(iso).getUTCDay() || 7;
/** The date of the `n`th study day from `start` (start itself counts when it is a study day). */
export function nthStudyDay(start: string, n: number, weekdays: number[]) {
  let d = start, count = 0;
  if (!weekdays.length) return start;
  for (;;) {
    if (weekdays.includes(isoWeekday(d)) && ++count >= n) return d;
    d = addDaysIso(d, 1);
  }
}
/** Study days from `start` to `end`, both included. */
export function studyDaysBetween(start: string, end: string, weekdays: number[]) {
  let n = 0;
  for (let d = start; d <= end; d = addDaysIso(d, 1)) if (weekdays.includes(isoWeekday(d))) n++;
  return n;
}

export interface TimeInput {
  hoursPerDay: number;
  weekdays: number[];
  pace: Pace;
  startDate: string;
  targetDate?: string;
  /** When study starts each day ("18:00"), so goals don't clash (docs/Google-Calendar-MVP-Plan.md §9). */
  studyStart?: string;
  /** The understood estimate of hours the goal needs. */
  estimatedHours?: number;
  /** Districts the city will have (the subjects kept): each is one stage with its own buffer. */
  districts?: number;
}

export interface TimePlan {
  weeklyHours: number;
  /** Hours a week for new material at this pace. */
  newHoursPerWeek: number;
  /** Without a finish-by date: when the estimated hours are done (capped to three years). */
  finish: string | null;
  /** With a finish-by date: hours of new material that fit before it. */
  fitHours: number | null;
  /** The goal needs more than fits (before the date, or within three years). */
  short: boolean;
  /** The plan would run past three years without a date. */
  tooLong: boolean;
}

/**
 * New material per study day, exactly as the generator's calendar has it (generator.ts buildCalendar): the pace's share
 * of the hours a day, in 30-minute steps, at least 30 minutes and at most 4 hours.
 */
export const newMinutesPerDay = (hoursPerDay: number, share: number) => Math.max(30, Math.min(240, Math.round((hoursPerDay * 60 * share) / 30) * 30));

/**
 * Study days a plan of `hours` takes, with the generator's stage buffer: one stage per district, each long enough for
 * its hours plus 15 % buffer days and one more (Math.ceil(days × 1.15) per stage). The hours are taken as shared evenly.
 */
export function studyDaysFor(hours: number, minutesPerDay: number, districts = 1) {
  const n = Math.max(1, districts);
  const per = Math.ceil((hours * 60) / n / minutesPerDay);
  return n * (per + Math.ceil(per * 0.15) + 1);
}

/**
 * What the time screen promises, worked out as the generator's calendar will be (so a schedule confirmed here doesn't
 * end "after your date" on the review): the finish date with the stage buffer, and with a finish-by date the hours that
 * fit before it and whether the goal does.
 */
export function timePlan(t: TimeInput, paces: Record<Pace, number> = DEFAULT_PACES): TimePlan {
  const weeklyHours = Math.round(t.hoursPerDay * t.weekdays.length * 10) / 10;
  const share = paces[t.pace] ?? DEFAULT_PACES.STEADY;
  const newHoursPerWeek = weeklyHours * share;
  const est = t.estimatedHours && t.estimatedHours > 0 ? t.estimatedHours : null;
  const perDay = newMinutesPerDay(t.hoursPerDay, share);
  const districts = Math.max(1, t.districts ?? 1);
  const finishFor = (hours: number) => {
    const days = studyDaysFor(hours, perDay, districts);
    return { days, finish: nthStudyDay(t.startDate, days, t.weekdays) };
  };
  if (!t.weekdays.length) return { weeklyHours, newHoursPerWeek, finish: null, fitHours: null, short: false, tooLong: false };
  if (t.targetDate) {
    // The study days before the date, less each stage's buffer, at the new material a day.
    const studyDays = studyDaysBetween(t.startDate, t.targetDate, t.weekdays);
    const fitHours = Math.max(0, Math.floor((((studyDays - districts) / 1.15) * perDay) / 60));
    const short = est !== null && finishFor(est).finish > t.targetDate;
    return { weeklyHours, newHoursPerWeek, finish: null, fitHours, short, tooLong: false };
  }
  if (!est || newHoursPerWeek <= 0) return { weeklyHours, newHoursPerWeek, finish: null, fitHours: null, short: false, tooLong: false };
  const { finish } = finishFor(est);
  const tooLong = daysBetween(t.startDate, finish) > MAX_JOURNEY_DAYS;
  return { weeklyHours, newHoursPerWeek, finish: tooLong ? addDaysIso(t.startDate, MAX_JOURNEY_DAYS) : finish, fitHours: null, short: tooLong, tooLong };
}

/* ---------------- plan files ---------------- */

export const FILE_LIMITS = { maxFiles: 3, maxBytes: 5 * 1024 * 1024 } as const;
const BY_EXT: Record<string, string> = { pdf: "application/pdf", txt: "text/plain", text: "text/plain", md: "text/markdown", markdown: "text/markdown" };

/** The upload type for a file, from its type or (Windows often leaves .md empty) its extension; null if not accepted. */
export function fileType(f: { name: string; type: string }): string | null {
  const t = f.type.toLowerCase();
  if (["application/pdf", "text/plain", "text/markdown", "text/x-markdown"].includes(t)) return t;
  return BY_EXT[f.name.toLowerCase().split(".").pop() ?? ""] ?? null;
}

/** "4 pages · 9,800 characters read", or the reason nothing was read. */
export function fileSummary(a: CityAttachment) {
  if (!a.hasText) return a.mimeType === "application/pdf" ? "No text found: it looks scanned" : "No text found";
  const n = a.chars.toLocaleString("en-GB");
  return a.pages ? `${a.pages} page${a.pages === 1 ? "" : "s"} · ${n} characters read` : `${n} characters read`;
}

/* ---------------- resuming a draft ---------------- */

export type StepId = "goal" | "understood" | "time" | "build";

/** Where a returning learner continues: the build screen once generation started, else the furthest answered step. */
export function resumeStep(r: { understood?: Understanding } | null, c: CityConstraints | null, versions: Pick<CurriculumVersion, "status">[]): StepId {
  if (versions.some((v) => v.status === "GENERATING" || v.status === "PROPOSED")) return "build";
  if (r?.understood?.subjects?.length && c?.startDate && c.weekdays?.length) return "time";
  if (r?.understood?.subjects?.length) return "understood";
  return "goal";
}

/** A new city's name until "Here's what I understood" gives it one (never words cut from the learner's text). */
export const UNTITLED = "Untitled draft";

/* ---------------- "Here's what I understood" ---------------- */

const UNDERSTANDING_KEYS = [
  "name", "category", "goal", "currentLevel", "targetLevel", "subjects", "alreadyKnown", "resources", "focusOptions",
  "questions", "plan", "planDays", "estimatedHours",
] as const;
/**
 * Only the summary's own fields. The AI step's reply carries more (prompt version, model, provider), and the draft's
 * save refuses fields it doesn't know: sending the reply back as it came failed with "Request validation failed"
 * until a reload, which read the summary back from the saved draft.
 */
export function onlyUnderstanding(r: object): Understanding {
  const src = r as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of UNDERSTANDING_KEYS) if (src[k] !== undefined) out[k] = src[k];
  return out as Understanding;
}
