import { type ISODate, dateIn, isValidISODate } from "../domain/dates.js";
import { currentTimeZone } from "./zone.js";

/** Source of "today" (SRS FR-CAL-08). Injected so tests and demos can fix the date. */
export interface Clock {
  today(): ISODate;
  now(): Date;
}

/** A timestamp on a pinned day (noon UTC is the same calendar day in Berlin), so "now" and "today" agree. */
const onDay = (iso: ISODate) => new Date(`${iso}T12:00:00Z`);

export const systemClock = (override?: string): Clock => {
  if (override) {
    if (!isValidISODate(override)) throw new Error(`APP_TODAY must be YYYY-MM-DD, got "${override}"`);
    return { today: () => override, now: () => onDay(override) };
  }
  // "Today" in the time zone of the city at hand (lib/zone.ts), Europe/Berlin outside one.
  return { today: () => dateIn(currentTimeZone(), new Date()), now: () => new Date() };
};

export const fixedClock = (iso: ISODate): Clock => ({ today: () => iso, now: () => onDay(iso) });

/** Mutable clock for integration tests. */
export class TestClock implements Clock {
  constructor(public date: ISODate) {}
  today() { return this.date; }
  now() { return onDay(this.date); }
}
