/** Display formatting. Dates are ISO calendar dates (Europe/Berlin), formatted without time zones. */
const parse = (iso: string) => new Date(`${iso}T12:00:00Z`);

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts });
const dShort = fmt({ weekday: "short", day: "numeric", month: "short" });
const dLong = fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dDay = fmt({ day: "numeric", month: "short" });
const dMonth = fmt({ month: "short" });
const dMonthYear = fmt({ month: "long", year: "numeric" });

export const shortDate = (iso: string) => dShort.format(parse(iso)); // "Tue, 17 Nov"
export const longDate = (iso: string) => dLong.format(parse(iso)); // "Tuesday 17 November 2026"
export const dayMonth = (iso: string) => dDay.format(parse(iso)); // "17 Nov"
export const monthName = (yyyyMm: string) => dMonthYear.format(parse(`${yyyyMm}-01`));
export const monthAbbr = (iso: string) => dMonth.format(parse(iso)).toUpperCase();
export const weekdayShort = (iso: string) => fmt({ weekday: "short" }).format(parse(iso));

/** 95 → "1 h 35", 240 → "4 h", 30 → "30 min". */
export function hm(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}

/** 95 → "1.6 h" */
export const hours1 = (minutes: number) => `${(Math.round((minutes / 60) * 10) / 10).toLocaleString("en-GB")} h`;

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "NOV–DEC" for a date range; a single month when start and end share it. */
export function monthRange(start: string, end: string): string {
  const a = monthAbbr(start);
  const b = monthAbbr(end);
  return a === b ? a : `${a}–${b}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const PRIORITY_LABEL = { CORE: "Core", IMPORTANT: "Important", OPTIONAL: "Optional" } as const;
export const STATUS_LABEL = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  LEARNED: "Learned",
  DEMONSTRATED: "Demonstrated",
} as const;
export const KIND_LABEL = { STUDY: "Study", PRACTICE: "Practice", REVISION: "Revision" } as const;
