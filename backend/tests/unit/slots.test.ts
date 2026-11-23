/** Study slots (docs/Google-Calendar-MVP-Plan.md §9): clashes between cities, and the next free time. */
import { describe, expect, it } from "vitest";
import { clashes, hhmm, nextFree, toMinute } from "../../src/domain/slots.js";

const weekdays = (minutes: number, days = [1, 2, 3, 4, 5]) => Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, days.includes(d) ? minutes : 0]));

describe("study slots", () => {
  const german = { name: "German C1", start: toMinute("18:00"), minutes: weekdays(180) };
  it("clash when they overlap on a shared study day, and say where", () => {
    const angular = { name: "", start: toMinute("19:00"), minutes: weekdays(180, [1, 2, 6]) };
    expect(clashes(angular, [german])).toEqual([{ city: "German C1", from: "18:00", to: "21:00", days: [1, 2] }]);
    // Back to back is not a clash; different days are not either.
    expect(clashes({ ...angular, start: toMinute("21:00") }, [german])).toEqual([]);
    expect(clashes({ ...angular, minutes: weekdays(180, [6, 7]) }, [german])).toEqual([]);
  });
  it("find the next time that clashes with nothing and ends by midnight", () => {
    expect(hhmm(nextFree({ name: "", start: toMinute("19:00"), minutes: weekdays(180) }, [german])!)).toBe("21:00");
    expect(nextFree({ name: "", start: toMinute("19:00"), minutes: weekdays(240) }, [german])).toBeNull();
  });
});
