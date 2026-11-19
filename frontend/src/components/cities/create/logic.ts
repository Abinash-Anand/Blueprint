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
export const addMonthsIso = (iso: string, months: number) => {
  const d = toDate(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

export interface TimeInput {
  hoursPerDay: number;
  weekdays: number[];
  pace: Pace;
  startDate: string;
  targetDate?: string;
  /** The understood estimate of hours the goal needs. */
  estimatedHours?: number;
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

export function timePlan(t: TimeInput, paces: Record<Pace, number> = DEFAULT_PACES): TimePlan {
  const weeklyHours = Math.round(t.hoursPerDay * t.weekdays.length * 10) / 10;
  const newHoursPerWeek = weeklyHours * (paces[t.pace] ?? DEFAULT_PACES.STEADY);
  const est = t.estimatedHours && t.estimatedHours > 0 ? t.estimatedHours : null;
  if (t.targetDate) {
    const weeks = Math.max(0, daysBetween(t.startDate, t.targetDate)) / 7;
    const fitHours = Math.round(weeks * newHoursPerWeek);
    return { weeklyHours, newHoursPerWeek, finish: null, fitHours, short: est !== null && fitHours < est * 0.9, tooLong: false };
  }
  if (!est || newHoursPerWeek <= 0) return { weeklyHours, newHoursPerWeek, finish: null, fitHours: null, short: false, tooLong: false };
  const days = Math.ceil(est / newHoursPerWeek) * 7;
  const tooLong = days > MAX_JOURNEY_DAYS;
  return { weeklyHours, newHoursPerWeek, finish: addDaysIso(t.startDate, Math.min(days, MAX_JOURNEY_DAYS)), fitHours: null, short: tooLong, tooLong };
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

/** A short name from the learner's own words, until the AI suggests one. */
export const provisionalName = (brief: string) => {
  const words = brief.replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ");
  return words.length > 2 ? words.slice(0, 60) : "New city";
};
