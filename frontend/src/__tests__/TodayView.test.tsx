import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlanChange, Task, Today } from "../api/types";

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
  recall: { dueCount: 0, overdueCount: 0, tomorrowCount: 0, plannedMinutes: 0 },
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
};
let current = today;
let changes: PlanChange[] = [];
const patchTask = vi.fn(async () => ({}));

vi.mock("../api/client", () => ({
  api: { today: vi.fn(async () => current), planChanges: vi.fn(async () => changes), patchTask: (...a: unknown[]) => patchTask(...(a as [])) },
  getCurrentCity: () => "city-1",
  ApiError: class extends Error {},
}));
vi.mock("../state/AppData", () => ({
  useAppData: () => ({
    version: 0,
    mutate: (fn: () => Promise<unknown>) => fn(),
    toggleSubtopic: vi.fn(),
    progress: null,
    topicById: new Map([["fe.ts", { id: "fe.ts", name: "TypeScript", districtId: "fe" }]]),
    districtById: new Map([["fe", { id: "fe", name: "Frontend Engineering", color: "#7f98a8" }]]),
  }),
}));

import { TodayView } from "../components/TodayView";
import { pres, WEAK } from "./fixtures";

describe("TodayView", () => {
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

  it("has one next action: the next study task, with its topic one click away", async () => {
    const onOpenTopic = vi.fn();
    const { container } = render(<TodayView date={null} onDate={() => {}} onOpenTopic={onOpenTopic} />);
    const hero = await screen.findByRole("region", { name: "Utility types" });
    expect(container.querySelectorAll(".btn.primary")).toHaveLength(1);
    fireEvent.click(within(hero).getByRole("button", { name: "Open topic" }));
    expect(onOpenTopic).toHaveBeenCalledWith("fe.ts");
    // Each number once: no assigned time, no done count, no total in the time log heading.
    expect(screen.getByText("1 task left")).toBeInTheDocument();
    expect(screen.queryByText(/assigned|of 2 done/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Time log" })).toBeInTheDocument();
  });

  it("shows a recall task without a tick box; the row opens the task's own page", async () => {
    current = {
      ...today,
      tasks: [...today.tasks, task({
        id: 9, title: "Recall: Generics", kind: "REVISION", source: "REVISION", estimatedMinutes: 8, stageId: null, subtopic: { id: 19, name: "Generics", completed: true },
        recall: { stateId: 3, stage: 1, lastReviewDate: "2026-11-15", dueDate: "2026-11-15", overdueDays: 2, presentation: pres("revision.overdue", "danger", "2 days overdue") },
      })],
    };
    render(<TodayView date={null} onDate={() => {}} onOpenTopic={() => {}} />);
    expect(await screen.findByText("2 days overdue")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Recall: Generics.*done/ })).not.toBeInTheDocument();
    // No Revise on the row: the day has one primary action.
    expect(screen.queryByRole("button", { name: /^Revise/ })).toBeNull();
    fireEvent.click(screen.getByText("Recall: Generics"));
    expect(location.hash).toBe("#/task/2026-11-17/9");
    history.replaceState(null, "", "#/today");
    current = today;
  });

  it("says a rest day once, in place of the next action", async () => {
    current = { ...today, isRestDay: true, targetMinutes: 0, plannedMinutes: 0, tasks: [], sessions: [] };
    render(<TodayView date={null} onDate={() => {}} onOpenTopic={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Rest day" })).toBeInTheDocument();
    expect(screen.getAllByText(/no target/i)).toHaveLength(1);
    expect(screen.queryByText(/Nothing assigned/)).toBeNull();
    current = today;
  });

  it("has no time log on a day still to come", async () => {
    current = { ...today, date: "2026-11-19", tasks: [], sessions: [] };
    render(<TodayView date="2026-11-19" onDate={() => {}} onOpenTopic={() => {}} />);
    expect(await screen.findByText("Upcoming day")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Time log" })).toBeNull();
    current = today;
  });

  it("shows an earlier revision task as history only: no Revise, no tick box, no revision section", async () => {
    current = withRevision;
    render(<TodayView date={null} onDate={() => {}} onOpenTopic={() => {}} />);
    await waitFor(() => expect(screen.getByText("Async programming with promises")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Start revision/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Async programming.*done/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Start revision session|All revisions|competing with new learning/)).not.toBeInTheDocument();
    // Study and revision are still told apart by a kind tag.
    expect(screen.getAllByText("Revision").length).toBeGreaterThanOrEqual(1);
    current = today;
  });

  it("says once what a re-plan moved and what it did to the finish, until dismissed", async () => {
    localStorage.clear();
    changes = [{ at: "2026-11-17T06:00:00.000Z", reason: "DAILY", moved: 6, finishBefore: "2027-03-09", finishAfter: "2027-03-12" }];
    const first = render(<TodayView date={null} onDate={() => {}} onOpenTopic={() => {}} />);
    // A plain note, not a live region: it is there when the page opens.
    const note = await screen.findByRole("region", { name: "Plan change" });
    expect(screen.queryByRole("status")).toBeNull();
    expect(note.textContent).toMatch(/^The plan moved 6 tasks to fit work left from earlier days\. Projected finish 12 Mar \(3 days later\)\./);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText(/The plan moved/)).toBeNull();
    first.unmount();
    // Seen: not shown again for the same change.
    render(<TodayView date={null} onDate={() => {}} onOpenTopic={() => {}} />);
    await waitFor(() => expect(screen.getByText(/17 November 2026/)).toBeInTheDocument());
    expect(screen.queryByText(/The plan moved/)).toBeNull();
    changes = [];
  });

  it("says you are ahead on a study day with nothing planned, and has no bulk move for what stays carried over", async () => {
    current = { ...today, tasks: [], carriedOver: [task({ id: 9, title: "Pinned earlier", scheduledDate: "2026-11-16", overdueDays: 1, pinned: true })] };
    render(<TodayView date={null} onDate={() => {}} onOpenTopic={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Nothing planned today: you're ahead" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move all forward" })).toBeNull();
    expect(screen.getByText(/Unfinished work moves forward on its own/)).toBeInTheDocument();
    // A pinned task says so; unpinning is on its own page.
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    current = today;
  });
});
