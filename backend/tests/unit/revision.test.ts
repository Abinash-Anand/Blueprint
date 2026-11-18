import { describe, expect, it } from "vitest";
import { addDays, isoWeekday } from "../../src/domain/dates.js";
import {
  REVISION_POLICY, applyAttempt, displayStatus, dueAfterCorrection, firstDueDate, interleave, isWeak, placeRevisions,
  type RevisionCandidate, type ScheduleState,
} from "../../src/domain/revision.js";

const fresh: ScheduleState = { previousIntervalDays: 0, consecutiveSuccesses: 0, consecutiveFailures: 0, lastAttemptDate: null };
const attempt = (score: 0 | 1 | 2 | 3, date = "2026-11-18", extra: Partial<{ usedHints: boolean; usedNotes: boolean; correctionCompleted: boolean }> = {}) => ({
  score, date, usedHints: false, usedNotes: false, correctionCompleted: true, ...extra,
});
const TARGETS = { 1: 240, 2: 240, 3: 240, 4: 240, 5: 240, 6: 240, 7: 0 };

describe("applyAttempt (spec §8.2 rules A–D)", () => {
  it("score 3 climbs the ladder 7 → 14 → 30, then doubles up to 60", () => {
    let s = fresh;
    let d = "2026-11-18";
    const intervals: number[] = [];
    for (let i = 0; i < 6; i++) {
      const u = applyAttempt(s, attempt(3, d));
      intervals.push(u.intervalDays);
      expect(u.nextDueDate).toBe(addDays(d, u.intervalDays));
      s = u.state;
      d = u.nextDueDate!;
    }
    expect(intervals).toEqual([7, 14, 30, 60, 60, 60]);
    expect(s.consecutiveSuccesses).toBe(6);
  });

  it("beyond the ladder, a late success doubles the actually elapsed interval (capped)", () => {
    const s: ScheduleState = { previousIntervalDays: 30, consecutiveSuccesses: 3, consecutiveFailures: 0, lastAttemptDate: "2026-11-01" };
    expect(applyAttempt(s, attempt(3, "2026-11-21")).intervalDays).toBe(60); // max(30, 20) * 2
    const short: ScheduleState = { ...s, previousIntervalDays: 20, lastAttemptDate: "2026-11-01" };
    expect(applyAttempt(short, attempt(3, "2026-11-26")).intervalDays).toBe(50); // max(20, 25) * 2
  });

  it("score 2 keeps the success history and uses a moderate interval (rule B)", () => {
    const s = { ...fresh, consecutiveSuccesses: 2, previousIntervalDays: 14 };
    const u = applyAttempt(s, attempt(2));
    expect(u.intervalDays).toBe(3);
    expect(u.state.consecutiveSuccesses).toBe(2);
    expect(u.correctionPending).toBe(false);
  });

  it("score 0 or 1 resets the sequence and keeps the interval short (rule A)", () => {
    const s = { ...fresh, consecutiveSuccesses: 3, previousIntervalDays: 30 };
    for (const score of [0, 1] as const) {
      const u = applyAttempt(s, attempt(score));
      expect(u.state.consecutiveSuccesses).toBe(0);
      expect(u.intervalDays).toBe(1);
      expect(u.nextDueDate).toBe("2026-11-19");
    }
  });

  it("score 0 without a correction schedules nothing until the gap is corrected (§8.3)", () => {
    const u = applyAttempt(fresh, attempt(0, "2026-11-18", { correctionCompleted: false }));
    expect(u.nextDueDate).toBeNull();
    expect(u.correctionPending).toBe(true);
    expect(dueAfterCorrection(u.nextDueDate, "2026-11-20")).toBe("2026-11-21");
  });

  it("score 1 without a correction is scheduled but flagged for correction (REV-08)", () => {
    const u = applyAttempt(fresh, attempt(1, "2026-11-18", { correctionCompleted: false }));
    expect(u.nextDueDate).toBe("2026-11-19");
    expect(u.correctionPending).toBe(true);
    expect(dueAfterCorrection(u.nextDueDate, "2026-11-20")).toBe("2026-11-19");
  });

  it("a 3 achieved with hints or notes counts as 2 and does not extend the interval", () => {
    for (const extra of [{ usedHints: true }, { usedNotes: true }]) {
      const u = applyAttempt({ ...fresh, consecutiveSuccesses: 1 }, attempt(3, "2026-11-18", extra));
      expect(u.effectiveScore).toBe(2);
      expect(u.intervalDays).toBe(3);
      expect(u.state.consecutiveSuccesses).toBe(1);
    }
  });

  it("two consecutive failures flag the unit as weak; a recall clears it (rule D)", () => {
    let s = applyAttempt(fresh, attempt(1)).state;
    expect(isWeak(s)).toBe(false);
    s = applyAttempt(s, attempt(0, "2026-11-19")).state;
    expect(isWeak(s)).toBe(true);
    s = applyAttempt(s, attempt(2, "2026-11-20")).state;
    expect(isWeak(s)).toBe(false);
  });

  it("is deterministic (NFR-REV-01)", () => {
    const s = { ...fresh, consecutiveSuccesses: 4, previousIntervalDays: 40, lastAttemptDate: "2026-10-01" };
    expect(applyAttempt(s, attempt(3))).toEqual(applyAttempt(s, attempt(3)));
  });
});

describe("eligibility and status", () => {
  it("sub-topics are first due the next day, topics three days after becoming eligible", () => {
    expect(firstDueDate("SUBTOPIC", "2026-11-18")).toBe("2026-11-19");
    expect(firstDueDate("TOPIC", "2026-11-18")).toBe("2026-11-21");
  });

  it("derives the display status from the due date", () => {
    const base = { correctionPending: false, suspended: false };
    expect(displayStatus({ ...base, nextDueDate: "2026-11-20" }, "2026-11-18")).toBe("SCHEDULED");
    expect(displayStatus({ ...base, nextDueDate: "2026-11-18" }, "2026-11-18")).toBe("DUE");
    expect(displayStatus({ ...base, nextDueDate: "2026-11-10" }, "2026-11-18")).toBe("OVERDUE");
    expect(displayStatus({ nextDueDate: null, correctionPending: true, suspended: false }, "2026-11-18")).toBe("AWAITING_CORRECTION");
    expect(displayStatus({ ...base, nextDueDate: "2026-11-10", suspended: true }, "2026-11-18")).toBe("SUSPENDED");
  });
});

describe("placeRevisions (spec §8.4–§8.5)", () => {
  const cand = (id: number, dueDate: string, extra: Partial<RevisionCandidate> = {}): RevisionCandidate => ({
    scheduleId: id, dueDate, minutes: 10, weak: false, lastScore: null, lastAttemptDate: null, ...extra,
  });

  it("never places on Sunday: a Sunday due date moves to Monday", () => {
    const [p] = placeRevisions([cand(1, "2026-11-22")], new Map(), new Map(), TARGETS, "2026-11-18");
    expect(isoWeekday("2026-11-22")).toBe(7);
    expect(p.date).toBe("2026-11-23");
  });

  it("never places before today; overdue units go on today", () => {
    const [p] = placeRevisions([cand(1, "2026-11-10")], new Map(), new Map(), TARGETS, "2026-11-18");
    expect(p.date).toBe("2026-11-18");
  });

  it("respects the daily allowance on full learning days and spills over to the next study day", () => {
    const learning = new Map([["2026-11-18", 240], ["2026-11-19", 240]]);
    const ps = placeRevisions([1, 2, 3, 4].map((i) => cand(i, "2026-11-18")), learning, new Map(), TARGETS, "2026-11-18");
    expect(ps.map((p) => p.date)).toEqual(["2026-11-18", "2026-11-18", "2026-11-18", "2026-11-19"]);
  });

  it("uses free capacity on buffer days beyond the allowance", () => {
    const ps = placeRevisions([1, 2, 3, 4, 5, 6].map((i) => cand(i, "2026-11-18")), new Map(), new Map(), TARGETS, "2026-11-18");
    expect(ps.every((p) => p.date === "2026-11-18")).toBe(true);
  });

  it("puts overdue weak units first, then the oldest due date", () => {
    const learning = new Map([["2026-11-18", 240]]);
    const ps = placeRevisions(
      [cand(1, "2026-11-17"), cand(2, "2026-11-12"), cand(3, "2026-11-16", { weak: true }), cand(4, "2026-11-15")],
      learning, new Map(), { ...TARGETS }, "2026-11-18", { ...REVISION_POLICY, dailyBudgetMinutes: 20 },
    );
    expect(ps.filter((p) => p.date === "2026-11-18").map((p) => p.scheduleId)).toEqual([3, 2]);
  });

  it("counts revisions already placed against the allowance and records new ones", () => {
    const learning = new Map([["2026-11-18", 240]]);
    const revision = new Map([["2026-11-18", 30]]);
    const [p] = placeRevisions([cand(1, "2026-11-18")], learning, revision, TARGETS, "2026-11-18");
    expect(p.date).toBe("2026-11-19");
    expect(revision.get("2026-11-19")).toBe(10);
  });
});

describe("interleave (spec §11)", () => {
  it("avoids consecutive items from the same topic while keeping priority order where possible", () => {
    const xs = ["a1", "a2", "a3", "b1", "c1"].map((id) => ({ id, topic: id[0] }));
    expect(interleave(xs, (x) => x.topic).map((x) => x.id)).toEqual(["a1", "b1", "a2", "c1", "a3"]);
  });
});
