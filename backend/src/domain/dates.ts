/**
 * Calendar-date arithmetic on ISO "YYYY-MM-DD" strings (LLD §12.1).
 * Calendar dates carry no time zone; they are converted to UTC-midnight Date
 * objects only at the Prisma boundary, so no offset can shift a day.
 */
export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidISODate(s: string): boolean {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function toDate(iso: ISODate): Date {
  if (!isValidISODate(iso)) throw new RangeError(`Invalid ISO date: ${iso}`);
  return new Date(`${iso}T00:00:00.000Z`);
}

export function fromDate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: ISODate, n: number): ISODate {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromDate(d);
}

/** Whole days from a to b (b − a). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

/** ISO 8601 weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(iso: ISODate): number {
  const w = toDate(iso).getUTCDay();
  return w === 0 ? 7 : w;
}

export function weekStart(iso: ISODate): ISODate {
  return addDays(iso, 1 - isoWeekday(iso));
}

export function monthKey(iso: ISODate): string {
  return iso.slice(0, 7);
}

export function monthStart(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`;
}

export function monthEnd(iso: ISODate): ISODate {
  const d = toDate(monthStart(iso));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return fromDate(d);
}

/** Inclusive list of dates from a to b. */
export function eachDay(a: ISODate, b: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

const berlinFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar date in Europe/Berlin for an instant (handles CET/CEST). */
export function berlinDate(now: Date): ISODate {
  return berlinFormatter.format(now);
}

export const maxDate = (a: ISODate, b: ISODate) => (a > b ? a : b);
export const minDate = (a: ISODate, b: ISODate) => (a < b ? a : b);
