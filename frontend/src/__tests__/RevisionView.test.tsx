import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RevisionOverview, RevisionUnitRow } from "../api/types";

const unit = (over: Partial<RevisionUnitRow>): RevisionUnitRow => ({
  scheduleId: 1, topicId: "fe.ts", topicName: "TypeScript", districtId: "fe", subtopicId: 11, scope: "SUBTOPIC", label: "Generics",
  status: "DUE", nextDueDate: "2026-11-19", overdueDays: 0, lastAttemptDate: null, lastScore: null, consecutiveSuccesses: 0,
  weak: false, correctionPending: false, pendingAttemptId: null, openTask: null, ...over,
});

const overview: RevisionOverview = {
  today: "2026-11-19",
  upcomingDays: 14,
  dailyAllowanceMinutes: 30,
  counts: { due: 1, overdue: 1, upcoming: 1, later: 0, weak: 1, awaitingCorrection: 1, active: 4, paused: 0 },
  overdue: [unit({ scheduleId: 2, label: "Utility types", subtopicId: 12, status: "OVERDUE", nextDueDate: "2026-11-17", overdueDays: 2, weak: true, lastAttemptDate: "2026-11-16", lastScore: 1 })],
  due: [unit({})],
  upcoming: [unit({ scheduleId: 3, label: "TypeScript (whole topic)", scope: "TOPIC", subtopicId: null, status: "SCHEDULED", nextDueDate: "2026-11-21" })],
  weak: [unit({ scheduleId: 2, label: "Utility types", subtopicId: 12, status: "OVERDUE", weak: true })],
  awaitingCorrection: [unit({ scheduleId: 4, label: "Narrowing", subtopicId: 13, status: "SCHEDULED", correctionPending: true, pendingAttemptId: 99 })],
  session: [
    { topicId: "fe.ts", scope: "SUBTOPIC", subtopicId: 12 },
    { topicId: "fe.ts", scope: "SUBTOPIC", subtopicId: 11 },
  ],
  history: [],
  checkpoints: [{ id: 1, topicId: "fe.ts", topicName: "TypeScript", subtopicId: 11, label: "Generics", result: "PARTIAL", neededAssistance: false, gaps: "constraints", date: "2026-11-18" }],
};

const correctAttempt = vi.fn(async (_id: number) => ({}));
vi.mock("../api/client", () => ({
  api: {
    revisionOverview: vi.fn(async () => overview),
    topicRevision: vi.fn(() => new Promise(() => {})),
    correctAttempt: (id: number) => correctAttempt(id),
  },
  ApiError: class extends Error {},
}));
vi.mock("../state/AppData", () => ({
  useAppData: () => ({
    version: 0,
    mutate: async <T,>(fn: () => Promise<T>) => fn(),
    topicById: new Map(),
    progress: {
      revision: {
        attempts: 3, successful: 2, distribution: [0, 1, 1, 1], checkpoints: 1, activeUnits: 4, dueToday: 1, overdue: 1,
        awaitingCorrection: 1, dailyAllowanceMinutes: 30, monthly: [{ month: "2026-11", attempts: 3, successful: 2, averageScore: 2 }], weakUnits: [],
      },
    },
  }),
}));

import { RevisionView } from "../components/RevisionView";

describe("RevisionView (Revision section)", () => {
  it("lists overdue, due, upcoming, weak and correction units, history and analytics", async () => {
    render(<RevisionView onOpenTopic={() => {}} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "2 revisions due now" })).toBeInTheDocument());
    for (const h of ["Needs a correction · 1", "Overdue · 1", "Due today · 1", "Upcoming · next 14 days · 1", "History", "Recall analytics"]) {
      expect(screen.getByRole("heading", { name: new RegExp(h.replace(/[().]/g, "\\$&")) })).toBeInTheDocument();
    }
    expect(screen.getByText(/2 days overdue \(due 17 Nov\) · last 16 Nov: Struggled/)).toBeInTheDocument();
    expect(screen.getAllByText("Weak").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Revise: Generics" })).toBeInTheDocument();
    // Upcoming units can be revised early; a unit awaiting correction offers the correction instead.
    expect(screen.getByRole("button", { name: "Revise: TypeScript (whole topic)" })).toHaveTextContent("Revise early");
    fireEvent.click(screen.getByRole("button", { name: "Confirm correction: Narrowing" }));
    await waitFor(() => expect(correctAttempt).toHaveBeenCalledWith(99));
    expect(screen.getByText(/check: Partly/)).toBeInTheDocument();
  });

  it("starts an interleaved session with every unit that can be attempted now", async () => {
    render(<RevisionView onOpenTopic={() => {}} />);
    const start = await screen.findByRole("button", { name: "Start session (2)" });
    fireEvent.click(start);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Revision · 1 of 2/)).toBeInTheDocument();
  });
});
