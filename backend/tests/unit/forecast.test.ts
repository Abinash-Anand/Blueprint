/** The forecast (Blueprint relationship model, phase 1): finish, plan and target checks, revision load. */
import { describe, expect, it } from "vitest";
import { forecast, type ForecastInput } from "../../src/domain/forecast.js";
import { gapFor } from "../../src/modules/recall/rules.js";

// Monday 23 Nov 2026. Weekdays: 120 min available, 90 of them new material; weekends are rest days.
const weekdays = (available: number, newTarget: number) =>
  Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, d <= 5 ? { available, newTarget } : { available: 0, newTarget: 0 }]));
const base: ForecastInput = {
  today: "2026-11-23", planEnd: "2026-12-04", targetDate: null, week: weekdays(120, 90),
  remainingNewMinutes: 900, recalls: [], recallMinutes: 8, gapFor,
};

describe("forecast", () => {
  it("fills each study day's new-material target and skips rest days", () => {
    const f = forecast(base); // 900 min at 90 a day: 10 study days → Fri 4 Dec
    expect(f).toMatchObject({ projectedFinish: "2026-12-04", daysVsPlan: 0, meetsTarget: null, week: { available: 600, newMaterial: 450, revision: 150 } });
    expect(forecast({ ...base, remainingNewMinutes: 0 }).projectedFinish).toBe("2026-11-23");
  });

  it("does revision first: within revision time it costs no new material, beyond it the finish moves", () => {
    const recalls = Array.from({ length: 3 }, () => ({ stage: 0, nextDueDate: "2026-11-23" }));
    // 3 recalls × 8 min fit in the 30 min of revision time: the finish does not move.
    expect(forecast({ ...base, recalls }).projectedFinish).toBe("2026-12-04");
    // A city that planned its full hours as new material has no revision time: recalls push the finish out.
    const full = forecast({ ...base, week: weekdays(90, 90), recalls });
    expect(full.projectedFinish! > "2026-12-04").toBe(true);
    expect(full.daysVsPlan).toBeGreaterThan(0);
  });

  it("waits with a recall due on a rest day until the next study day, and counts the next four weeks' revision", () => {
    const f = forecast({ ...base, recalls: [{ stage: 0, nextDueDate: "2026-11-28" }] }); // Saturday
    // Waits to Mon 30 Nov; each remembered recall goes up a stage: gaps 1, 2, 4, 7 → Tue 1, Thu 3, Mon 7, Mon 14 Dec.
    expect(f.revisionLoad.map((w) => [w.weekStart, w.recalls, w.minutes])).toEqual([
      ["2026-11-23", 0, 0], ["2026-11-30", 3, 24], ["2026-12-07", 1, 8], ["2026-12-14", 1, 8],
    ]);
  });

  it("checks the target date and says what a week would need to meet it", () => {
    const late = forecast({ ...base, targetDate: "2026-11-27" });
    expect(late).toMatchObject({ meetsTarget: false, neededNewMinutesPerWeek: 1260 }); // 900 min in 5 days = 1260 a week
    expect(forecast({ ...base, targetDate: "2026-12-31" }).meetsTarget).toBe(true);
    expect(forecast({ ...base, targetDate: "2026-11-01" }).neededNewMinutesPerWeek).toBeNull(); // already past
  });

  it("gives no finish when the work does not fit within the horizon", () => {
    const f = forecast({ ...base, remainingNewMinutes: 1_000_000, targetDate: "2027-01-01" });
    expect(f).toMatchObject({ projectedFinish: null, daysVsPlan: null, meetsTarget: false });
  });
});
