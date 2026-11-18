import { type ISODate, berlinDate, isValidISODate } from "../domain/dates.js";

/** Source of "today" (SRS FR-CAL-08). Injected so tests and demos can fix the date. */
export interface Clock {
  today(): ISODate;
  now(): Date;
}

export const systemClock = (override?: string): Clock => {
  if (override) {
    if (!isValidISODate(override)) throw new Error(`APP_TODAY must be YYYY-MM-DD, got "${override}"`);
    return { today: () => override, now: () => new Date() };
  }
  return { today: () => berlinDate(new Date()), now: () => new Date() };
};

export const fixedClock = (iso: ISODate): Clock => ({ today: () => iso, now: () => new Date() });

/** Mutable clock for integration tests. */
export class TestClock implements Clock {
  constructor(public date: ISODate) {}
  today() { return this.date; }
  now() { return new Date(); }
}
