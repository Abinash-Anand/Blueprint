/** Recall coaching on the Progress tab (Recall-Plan §3.5, §7): blind spots across sub-topics and each sub-topic's progress. */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RecallCoaching } from "../api/types";

vi.mock("../api/client", () => ({ api: { recallMatrix: vi.fn(() => new Promise(() => {})) }, ApiError: class extends Error {} }));
vi.mock("../state/AppData", () => ({ useAppData: () => ({}) }));

import { RecallCoachingView } from "../components/ProgressView";

const c: RecallCoaching = {
  subtopics: [
    {
      subtopicId: 4, subtopic: "Subjects", topic: "RxJS", reviews: 3, lastDate: "2026-11-23", lastScore: 0.62, scoreDelta: 0.14,
      narrative: "Late subscribers are now solid; unsubscribing keeps slipping.", newlyMastered: ["Late subscribers"], slipped: ["Multicasting"],
      blindSpots: [{ label: "Unsubscribing", missedInARow: 3 }], recurringMisconceptions: [{ claim: "a Subject replays old values", correction: "Only a ReplaySubject does." }],
    },
    { subtopicId: 5, subtopic: "Guards", topic: "Routing", reviews: 1, lastDate: "2026-11-21", lastScore: 0.4, scoreDelta: null, narrative: "", newlyMastered: [], slipped: [], blindSpots: [], recurringMisconceptions: [] },
  ],
  blindSpots: [{ subtopicId: 4, subtopic: "Subjects", label: "Unsubscribing", missedInARow: 3 }],
};

describe("recall coaching", () => {
  it("lists blind spots across sub-topics, then each sub-topic's progress, and opens its history", () => {
    render(<RecallCoachingView c={c} />);
    expect(within(screen.getByRole("list", { name: "Blind spots" })).getByRole("listitem").textContent).toMatch(/Unsubscribing \(Subjects\).*missed 3×/);
    const rows = within(screen.getByRole("list", { name: "Recall by sub-topic" })).getAllByRole("listitem");
    expect(rows[0].textContent).toMatch(/Subjects.*3 recalls · last 23 Nov/);
    expect(rows[0].textContent).toMatch(/Late subscribers are now solid/);
    expect(rows[0].textContent).toMatch(/Newly remembered: Late subscribers.*Slipped: Multicasting.*Keeps missing: Unsubscribing.*A corrected mistake came back/);
    expect(rows[0].textContent).toMatch(/62%.*\+14 points since last time/);
    expect(rows[1].textContent).toMatch(/Guards.*40%.*first recall/);
    // Recall over time is a page of its own inside Progress, with an address.
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Recall over time: Guards" }));
    expect(location.hash).toBe(`#/progress/history/${c.subtopics[1].subtopicId}`);
  });

  it("shows nothing before the first checked recall", () => {
    const { container } = render(<RecallCoachingView c={{ subtopics: [], blindSpots: [] }} />);
    expect(container.textContent).toBe("");
  });
});
