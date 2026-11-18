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
    expect(parseHash("")).toEqual({ view: "today", param: null });
    expect(parseHash("#/city/be.api")).toEqual({ view: "city", param: "be.api" });
    expect(parseHash("#/week/2026-11-23")).toEqual({ view: "week", param: "2026-11-23" });
    expect(parseHash("#/nonsense")).toEqual({ view: "today", param: null });
  });
});
