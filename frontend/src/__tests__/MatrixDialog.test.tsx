/** The concept grid (docs/Recall-Plan.md §3.5, phase 2): points × recalls, recalled when asked, and the progress note. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RecallMatrix } from "../api/types";

const matrix: RecallMatrix = {
  subtopicId: 4, subtopic: "Subjects", topic: "RxJS", version: 1,
  points: [{ id: 1, code: "c1", label: "Definition", tier: 1, leftOut: false }, { id: 2, code: "c2", label: "Late subscribers", tier: 3, leftOut: false }],
  attempts: [
    { reviewId: 10, attempt: 1, date: "2026-11-21", score: 0.4, depth: "FOUNDATIONAL", outcome: "LAPSE", cells: { 1: { status: "ACCURATE", recalledWhenAsked: false }, 2: { status: "MISSED", recalledWhenAsked: true } } },
    { reviewId: 11, attempt: 2, date: "2026-11-23", score: 1, depth: "MASTERY", outcome: "PASS", cells: { 1: { status: "ACCURATE", recalledWhenAsked: false }, 2: { status: "ACCURATE", recalledWhenAsked: false } } },
  ],
  analyses: [{
    attempt: 2, narrative: "You now remember late subscribers.",
    diff: { attempt: 2, previousAttempt: 1, scoreDelta: 0.6, newlyMastered: [{ pointId: 2, label: "Late subscribers" }], retained: [{ pointId: 1, label: "Definition" }], regressed: [], persistentBlindSpots: [], scoreTrajectory: [] },
  }],
};
vi.mock("../api/client", () => ({ api: { recallMatrix: vi.fn(async () => matrix) }, ApiError: class extends Error {} }));

import { MatrixDialog } from "../components/recall/MatrixDialog";

describe("recall over time", () => {
  it("shows each point across the recalls, marks what came only when asked, and the progress note", async () => {
    render(<MatrixDialog subtopicId={4} onClose={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Subjects" })).toBeTruthy();
    expect(screen.getByText("You now remember late subscribers.")).toBeTruthy();
    expect(screen.getByText(/Newly remembered: Late subscribers/)).toBeTruthy();
    expect(screen.getByLabelText("Late subscribers, 21 Nov: missed, recalled when asked").textContent).toBe("✗ ↑");
    expect(screen.getByLabelText("Late subscribers, 23 Nov: remembered").textContent).toBe("✓");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Point", "21 Nov40 %", "23 Nov100 %"]);
  });
});
