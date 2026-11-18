import { describe, expect, it } from "vitest";
import {
  addDays, berlinDate, diffDays, eachDay, isValidISODate, isoWeekday, monthEnd, weekStart,
} from "../../src/domain/dates.js";

describe("dates", () => {
  it("validates real calendar dates only", () => {
    expect(isValidISODate("2026-11-17")).toBe(true);
    expect(isValidISODate("2027-02-29")).toBe(false);
    expect(isValidISODate("2028-02-29")).toBe(true);
    expect(isValidISODate("2026-13-01")).toBe(false);
    expect(isValidISODate("17.11.2026")).toBe(false);
  });

  it("computes ISO weekdays (journey starts on a Tuesday)", () => {
    expect(isoWeekday("2026-11-17")).toBe(2);
    expect(isoWeekday("2026-11-22")).toBe(7);
    expect(isoWeekday("2026-11-23")).toBe(1);
  });

  it("does arithmetic across month, year and DST boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-03-27", 2)).toBe("2027-03-29"); // CET→CEST on 28 Mar 2027
    expect(diffDays("2026-11-17", "2027-08-17")).toBe(273);
    expect(eachDay("2026-11-17", "2026-11-23")).toHaveLength(7);
  });

  it("finds the Monday of a week and the end of a month", () => {
    expect(weekStart("2026-11-17")).toBe("2026-11-16");
    expect(weekStart("2026-11-22")).toBe("2026-11-16");
    expect(monthEnd("2027-02-10")).toBe("2027-02-28");
  });

  it("uses the Berlin calendar date, not UTC", () => {
    // 23:30 UTC on 17 Nov = 00:30 CET on 18 Nov.
    expect(berlinDate(new Date("2026-11-17T23:30:00Z"))).toBe("2026-11-18");
    // 22:30 UTC on 30 Jun = 00:30 CEST on 1 Jul.
    expect(berlinDate(new Date("2027-06-30T22:30:00Z"))).toBe("2027-07-01");
    expect(berlinDate(new Date("2026-11-17T10:00:00Z"))).toBe("2026-11-17");
  });
});
