import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Task, Today } from "../api/types";

const task = (over: Partial<Task>): Task => ({
  id: 1, title: "t", notes: "", kind: "STUDY", status: "TODO", source: "PLAN", estimatedMinutes: 60, loggedMinutes: 0,
  originalDate: "2026-11-17", scheduledDate: "2026-11-17", rescheduleCount: 0, completedAt: null, overdueDays: 0,
  topic: { id: "fe.ts", name: "TypeScript", districtId: "fe" }, subtopic: null, stageId: "fe", revision: null, ...over,
});

const revisionTask = (id: number, title: string, over: Partial<Task> = {}) =>
  task({
    id, title, kind: "REVISION", source: "REVISION", estimatedMinutes: 10, stageId: null,
    subtopic: { id: 10 + id, name: title, completed: true },
    revision: { scheduleId: id, scope: "SUBTOPIC", weak: false, correctionPending: false, lastScore: null, dueDate: "2026-11-17", overdueDays: 0, presentation: pres("revision.due", "info", "Due today") },
    ...over,
  });

const today: Today = {
  date: "2026-11-17", today: "2026-11-17", weekday: 2, isRestDay: false, isBufferDay: false,
  journey: { start: "2026-11-17", end: "2027-08-17", day: 1, totalDays: 274, status: "ACTIVE" },
  targetMinutes: 240, plannedMinutes: 240, doneMinutes: 90, actualMinutes: 95,
  tasks: [
    task({ id: 1, title: "Generics", status: "DONE", estimatedMinutes: 90, loggedMinutes: 95, completedAt: "x", subtopic: { id: 1, name: "Generics", completed: false } }),
    task({ id: 2, title: "Utility types", estimatedMinutes: 150, originalDate: "2026-11-16", rescheduleCount: 1 }),
  ],
  carriedOver: [],
  sessions: [{ id: 1, date: "2026-11-17", minutes: 95, taskId: 1, topicId: "fe.ts", note: "" }],
  stages: [{ id: "fe", position: 0, name: "Frontend Engineering", kind: "MAIN", startDate: "2026-11-17", endDate: "2026-12-31", districtIds: ["fe"] }],
  current: { districtId: "fe", topicId: "fe.ts" },
  next: { topicId: "fe.ts", subtopic: "Utility types" },
  reviewTopics: [],
  revision: {
    plannedMinutes: 0, learningMinutes: 240, dailyAllowanceMinutes: 30, weeklyOvertimeMinutes: 120, overTargetMinutes: 0, weekOverTargetMinutes: 0, competing: false, dueCount: 0, overdueCount: 0,
    weakCount: 0, awaitingCorrection: 0, backlog: { count: 0, oldestDue: null }, optional: [], sessionTaskIds: [],
  },
};

const withRevision: Today = {
  ...today,
  plannedMinutes: 260,
  tasks: [
    ...today.tasks,
    revisionTask(3, "Generics", {
      revision: {
        scheduleId: 3, scope: "SUBTOPIC", weak: true, correctionPending: false, lastScore: 1, dueDate: "2026-11-15", overdueDays: 2,
        presentation: pres("revision.overdue", "danger", "2 days overdue", [WEAK]),
      },
    }),
    revisionTask(4, "Async programming with promises"),
  ],
  revision: { ...today.revision, plannedMinutes: 20, overTargetMinutes: 20, weekOverTargetMinutes: 20, competing: true, dueCount: 2, overdueCount: 1, weakCount: 1, sessionTaskIds: [3, 4] },
};
let current = today;

vi.mock("../api/client", () => ({ api: { today: vi.fn(async () => current) }, ApiError: class extends Error {} }));
vi.mock("../state/AppData", () => ({
  useAppData: () => ({
    version: 0,
    mutate: vi.fn(),
    toggleSubtopic: vi.fn(),
    progress: null,
    topicById: new Map([["fe.ts", { id: "fe.ts", name: "TypeScript", districtId: "fe" }]]),
    districtById: new Map([["fe", { id: "fe", name: "Frontend Engineering", color: "#7f98a8" }]]),
  }),
}));

import { TodayView } from "../components/TodayView";
import { pres, WEAK } from "./fixtures";

describe("TodayView (Mission Control)", () => {
  it("shows the date, current topic, target, actual time and tasks", async () => {
    render(<TodayView date={null} onDate={() => {}} onOpenTopic={() => {}} />);
    await waitFor(() => expect(screen.getByText(/17 November 2026/)).toBeInTheDocument());
    expect(screen.getByText(/Day 1 of 274/)).toBeInTheDocument();
    expect(screen.getAllByText("TypeScript").length).toBeGreaterThan(0);
    expect(screen.getByText("of 4 h")).toBeInTheDocument();
    expect(screen.getAllByText("1 h 35").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Utility types").length).toBeGreaterThan(0);
    expect(screen.getByText("planned 16 Nov")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Generics.*not done/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Utility types.*as done/ })).not.toBeChecked();
  });

  it("shows revision tasks without a tick box, flags weak and overdue units, and offers an interleaved session", async () => {
    current = withRevision;
    render(<TodayView date={null} onDate={() => {}} onOpenTopic={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Start revision session \(2\)/)).toBeInTheDocument());
    // Completed only by an attempt: a "Revise" action instead of a checkbox.
    expect(screen.getByRole("button", { name: "Start revision: Generics" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Generics.*as done/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /complete it by recording an attempt/ })).toHaveLength(2);
    expect(screen.getByText("Weak")).toBeInTheDocument();
    expect(screen.getByText("2 days overdue")).toBeInTheDocument();
    expect(screen.getByText(/due 15 Nov/)).toBeInTheDocument();
    // Study, practice and revision are told apart by a kind tag.
    expect(screen.getAllByText("Revision").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Study").length).toBeGreaterThan(0);
    expect(screen.getByText(/Revision is competing with new learning today/)).toBeInTheDocument();
    current = today;
  });
});
