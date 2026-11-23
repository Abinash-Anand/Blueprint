import { describe, expect, it } from "vitest";
import { parseHash } from "../App";
import { addDays, hm, longDate, monthRange, shortDate } from "../lib/format";

describe("format", () => {
  it("formats durations", () => {
    expect(hm(30)).toBe("30 min");
    expect(hm(60)).toBe("1 h");
    expect(hm(95)).toBe("1 h 35");
    expect(hm(240)).toBe("4 h");
  });

  it("formats calendar dates without time-zone drift", () => {
    expect(longDate("2026-11-17")).toContain("17 November 2026");
    expect(shortDate("2026-11-17")).toContain("Tue");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("builds month ranges for road signposts", () => {
    expect(monthRange("2027-01-01", "2027-03-31")).toBe("JAN–MAR");
    expect(monthRange("2027-05-01", "2027-05-15")).toBe("MAY");
  });

  it("parses hash routes", () => {
    expect(parseHash("")).toMatchObject({ view: "today", param: null });
    expect(parseHash("#/city/be.api")).toMatchObject({ view: "city", param: "be.api" });
    expect(parseHash("#/week/2026-11-23")).toMatchObject({ view: "week", param: "2026-11-23" });
    expect(parseHash("#/nonsense")).toMatchObject({ view: "today", param: null });
    // The recall flow and recall over time have addresses of their own.
    expect(parseHash("#/recall/42")).toMatchObject({ recall: 42 });
    expect(parseHash("#/recall/x").recall).toBeUndefined();
    expect(parseHash("#/progress/history/7")).toMatchObject({ view: "progress", param: "history", sub: "7" });
    // A task, adding a task and logging time on a day: pages of their own, opened from Today.
    expect(parseHash("#/task/2026-11-23/12")).toMatchObject({ day: { page: "task", date: "2026-11-23", id: 12 } });
    expect(parseHash("#/add-task/2026-11-23")).toMatchObject({ day: { page: "add-task", date: "2026-11-23" } });
    expect(parseHash("#/log-time/2026-11-23")).toMatchObject({ day: { page: "log-time", date: "2026-11-23" } });
    expect(parseHash("#/task/x/12").day).toBeUndefined();
    // A stage's dates, opened from Progress.
    expect(parseHash("#/stage/fe")).toMatchObject({ view: "progress", stage: "fe" });
    // From a building's panel: adding a task on its topic.
    expect(parseHash("#/add-task/2026-11-23/fe.ts")).toMatchObject({ day: { page: "add-task", date: "2026-11-23", topic: "fe.ts" } });
  });
});
