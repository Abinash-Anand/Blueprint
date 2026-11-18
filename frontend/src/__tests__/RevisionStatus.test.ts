import { describe, expect, it } from "vitest";
import { revisionPrimary } from "../components/RevisionStatus";

const T = "2026-11-19";
const base = { correctionPending: false, nextDueDate: "2026-11-25", lastAttemptDate: null };

describe("revision status semantics (one primary state, Weak is a separate flag)", () => {
  it("orders overlapping states: paused > correction > done today > overdue > due > upcoming", () => {
    expect(revisionPrimary({ ...base, suspended: true, correctionPending: true }, T).state).toBe("PAUSED");
    expect(revisionPrimary({ ...base, correctionPending: true, nextDueDate: "2026-11-10" }, T).state).toBe("CORRECTION");
    expect(revisionPrimary({ ...base, nextDueDate: "2026-11-17" }, T)).toEqual({ state: "OVERDUE", text: "2 days overdue" });
    expect(revisionPrimary({ ...base, nextDueDate: T }, T).state).toBe("DUE");
    expect(revisionPrimary({ ...base, lastAttemptDate: T }, T)).toEqual({ state: "DONE_TODAY", text: "Done today · next 25 Nov" });
    expect(revisionPrimary({ ...base, nextDueDate: "2026-11-17", completed: true }, T).state).toBe("DONE_TODAY");
    expect(revisionPrimary(base, T)).toEqual({ state: "UPCOMING", text: "Next 25 Nov" });
  });
});
