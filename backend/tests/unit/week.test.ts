/** The "Your time" sheet's week (docs/Availability-Phase3-Plan.md): from a choice, and back. */
import { describe, expect, it } from "vitest";
import { PACE_SHARE } from "../../src/modules/ai/curriculum/generator.js";
import { PACES, type Week, describeWeek, weekFromChoice } from "../../src/domain/week.js";

/** A week like the local cities': `available/newTarget` on the given weekdays, rest days otherwise. */
const week = (days: number[], available: number, newTarget: number): Week =>
  Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, days.includes(d) ? { available, newTarget } : { available: 0, newTarget: 0 }]));
const MON_SAT = [1, 2, 3, 4, 5, 6];

describe("the week from the sheet", () => {
  it("uses the paces city creation uses", () => {
    expect(PACES).toEqual(PACE_SHARE);
  });

  it("gives study days their minutes and the pace's share as new material, in 15-minute steps; rest days nothing", () => {
    const w = weekFromChoice({ minutesPerDay: 150, studyDays: [1, 3, 5], pace: "STEADY" }, week(MON_SAT, 240, 180));
    expect(w[1]).toEqual({ available: 150, newTarget: 120 }); // 112.5 → 120 (nearest 15)
    expect(w[2]).toEqual({ available: 0, newTarget: 0 });
    expect(weekFromChoice({ minutesPerDay: 120, studyDays: [1], pace: "INTENSIVE" }, week([], 0, 0))[1]).toEqual({ available: 120, newTarget: 105 });
  });

  it("keeps each weekday's own split with the current pace, and gives a new study day the usual one", () => {
    const current = week(MON_SAT, 240, 240); // all new material, as Engineering City
    const w = weekFromChoice({ minutesPerDay: 180, studyDays: [1, 2, 7], pace: "CURRENT" }, current);
    expect([w[1], w[7]]).toEqual([{ available: 180, newTarget: 180 }, { available: 180, newTarget: 180 }]);
  });

  it("describes the local cities' weeks as the sheet shows them", () => {
    // RxJS in Angular: 120/90 Monday to Saturday is exactly Steady.
    expect(describeWeek(week(MON_SAT, 120, 90))).toMatchObject({ minutesPerDay: 120, studyDays: MON_SAT, pace: "STEADY", uniform: true });
    // AI Engineer: 240/180 every day, Steady.
    expect(describeWeek(week([1, 2, 3, 4, 5, 6, 7], 240, 180)).pace).toBe("STEADY");
    // Engineering City, all new material: no preset matches.
    expect(describeWeek(week(MON_SAT, 240, 240))).toMatchObject({ pace: "CURRENT", share: 1 });
    // Full-Stack AI Engineer, 270/210: 202.5 rounds to 210, so it is Steady.
    expect(describeWeek(week(MON_SAT, 270, 210)).pace).toBe("STEADY");
    // The German cities, 180/150: Steady gives 135 and Intensive 165, so it stays Current.
    expect(describeWeek(week([1, 2, 3, 4, 5], 180, 150))).toMatchObject({ pace: "CURRENT", minutesPerDay: 180, studyDays: [1, 2, 3, 4, 5] });
  });

  it("gives back exactly the current week for the choice that describes it", () => {
    for (const w of [week(MON_SAT, 120, 90), week(MON_SAT, 240, 240), week(MON_SAT, 270, 210), week([1, 2, 3, 4, 5], 180, 150), week([1, 2, 3, 4, 5, 6, 7], 120, 120)]) {
      const d = describeWeek(w);
      expect(weekFromChoice(d, w)).toEqual(w);
    }
  });

  it("says when study days differ, as the sheet's one number would change some of them", () => {
    const w = { ...week(MON_SAT, 120, 90), 6: { available: 240, newTarget: 180 } };
    expect(describeWeek(w)).toMatchObject({ minutesPerDay: 120, uniform: false });
  });
});
