import { describe, expect, it } from "vitest";
import { placeOverdue } from "../../src/domain/reschedule.js";
import { DEFAULT_TARGETS } from "../../src/curriculum/index.js";

const task = (id: number, minutes: number, originalDate = "2026-11-17", position = id) => ({
  id, minutes, scheduledDate: originalDate, originalDate, position,
});

describe("placeOverdue (FR-TODAY-10)", () => {
  it("fills today's free capacity first, in original order", () => {
    const load = new Map([["2026-11-20", 120]]);
    const moves = placeOverdue([task(2, 60), task(1, 60)], load, DEFAULT_TARGETS, "2026-11-20");
    expect(moves).toEqual([
      { id: 1, from: "2026-11-17", to: "2026-11-20" },
      { id: 2, from: "2026-11-17", to: "2026-11-20" },
    ]);
  });

  it("moves on when a day is full and never uses Sunday", () => {
    // Sat 21 Nov full, Sun 22 Nov rest → Mon 23 Nov.
    const load = new Map([["2026-11-21", 240]]);
    const moves = placeOverdue([task(1, 90)], load, DEFAULT_TARGETS, "2026-11-21");
    expect(moves[0].to).toBe("2026-11-23");
  });

  it("starting on a Sunday places tasks on Monday", () => {
    const moves = placeOverdue([task(1, 30)], new Map(), DEFAULT_TARGETS, "2026-11-22");
    expect(moves[0].to).toBe("2026-11-23");
  });

  it("does not mutate tasks it was given and keeps the original date in the result", () => {
    const t = task(1, 30, "2026-11-18");
    placeOverdue([t], new Map(), DEFAULT_TARGETS, "2026-11-24");
    expect(t.scheduledDate).toBe("2026-11-18");
  });
});
