/**
 * The time zone "today" is counted in for the work at hand: the request's city (set by requireCity) or the city a
 * background job works on. Europe/Berlin outside any city, the zone every city had before cities kept their own.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const DEFAULT_TIME_ZONE = "Europe/Berlin";
const store = new AsyncLocalStorage<string>();

/** Runs `fn` (and everything it starts) with "today" counted in `timeZone`; an unknown zone falls back to the default. */
export function withTimeZone<T>(timeZone: string | null | undefined, fn: () => T): T {
  return store.run(validTimeZone(timeZone), fn);
}

export const currentTimeZone = () => store.getStore() ?? DEFAULT_TIME_ZONE;

export function validTimeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}
