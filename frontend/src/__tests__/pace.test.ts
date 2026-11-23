/** Pace follows the week, and choosing a pace sets the week (lib/pace.ts). */
import { describe, expect, it } from "vitest";
import { paceFor, weekForPace } from "../lib/pace";

describe("pace and the week", () => {
  it("follows the hours a week: light up to 8, steady up to 16, intensive above", () => {
    expect(paceFor(1 * 4)).toBe("LIGHT");
    expect(paceFor(2 * 4)).toBe("LIGHT");
    expect(paceFor(3 * 4)).toBe("STEADY");
    expect(paceFor(4 * 4)).toBe("STEADY");
    expect(paceFor(5 * 5)).toBe("INTENSIVE");
    // Combinations the day-count rule left open.
    expect(paceFor(3 * 6)).toBe("INTENSIVE");
    expect(paceFor(5 * 2)).toBe("STEADY");
  });

  it("sets the hours a day when a pace is chosen, keeping the days where it can", () => {
    const weekdays = [1, 2, 3, 4];
    expect(weekForPace("LIGHT", weekdays)).toEqual({ hoursPerDay: 1.5, weekdays });
    expect(weekForPace("STEADY", weekdays)).toEqual({ hoursPerDay: 3, weekdays });
    // Intensive needs at least 5 days: one is added.
    expect(weekForPace("INTENSIVE", weekdays)).toEqual({ hoursPerDay: 4.5, weekdays: [1, 2, 3, 4, 5] });
    // Every day of the week: lighter days keep the week in its band.
    const all = [1, 2, 3, 4, 5, 6, 7];
    expect(weekForPace("LIGHT", all)).toEqual({ hoursPerDay: 1, weekdays: all });
    expect(weekForPace("STEADY", all)).toEqual({ hoursPerDay: 2, weekdays: all });
    // Two days: steady needs longer days.
    expect(weekForPace("STEADY", [6, 7])).toEqual({ hoursPerDay: 4.5, weekdays: [6, 7] });
    for (const [pace, days] of [["LIGHT", all], ["STEADY", [6, 7]], ["INTENSIVE", [1]]] as const) {
      const w = weekForPace(pace, [...days]);
      expect(paceFor(w.hoursPerDay * w.weekdays.length)).toBe(pace);
    }
  });
});
