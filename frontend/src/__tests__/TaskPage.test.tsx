/** A task's own page, and adding a task or logging time on a day: pages opened from Today, each with one primary action. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task, Today } from "../api/types";
import { pres } from "./fixtures";

const task = (over: Partial<Task>): Task => ({
  id: 1, title: "Generics", notes: "", kind: "STUDY", status: "TODO", source: "PLAN", estimatedMinutes: 60, loggedMinutes: 0,
  originalDate: "2026-11-17", scheduledDate: "2026-11-17", rescheduleCount: 0, completedAt: null, overdueDays: 0,
  topic: { id: "fe.ts", name: "TypeScript", districtId: "fe" }, subtopic: null, stageId: "fe", revision: null, ...over,
});
const recall = task({
  id: 9, title: "Recall: Generics", kind: "REVISION", source: "REVISION", estimatedMinutes: 8, stageId: null, subtopic: { id: 19, name: "Generics", completed: true },
  recall: { stateId: 3, stage: 1, lastReviewDate: "2026-11-15", dueDate: "2026-11-15", overdueDays: 2, presentation: pres("revision.overdue", "danger", "2 days overdue") },
});
const pinned = task({ id: 5, title: "Pinned earlier", scheduledDate: "2026-11-16", pinned: true });
const day: Today = {
  date: "2026-11-17", today: "2026-11-17", weekday: 2, isRestDay: false, isBufferDay: false,
  journey: { start: "2026-11-17", end: "2027-08-17", day: 1, totalDays: 274, status: "ACTIVE" },
  targetMinutes: 240, plannedMinutes: 240, doneMinutes: 0, actualMinutes: 0,
  tasks: [task({ id: 1 }), task({ id: 2, title: "Utility types", status: "DONE" }), recall], carriedOver: [pinned], sessions: [], stages: [],
  current: { districtId: "fe", topicId: "fe.ts" }, next: null, reviewTopics: [],
  recall: { dueCount: 1, overdueCount: 1, tomorrowCount: 0, plannedMinutes: 8 },
};

const patchTask = vi.fn(async () => ({}));
const createTask = vi.fn(async () => ({}));
const logTime = vi.fn(async () => ({}));
vi.mock("../api/client", () => ({
  api: {
    today: vi.fn(async () => day),
    patchTask: (...a: unknown[]) => patchTask(...(a as [])),
    createTask: (...a: unknown[]) => createTask(...(a as [])),
    logTime: (...a: unknown[]) => logTime(...(a as [])),
    deleteTask: vi.fn(async () => undefined),
  },
  ApiError: class extends Error {},
}));
vi.mock("../state/AppData", () => ({
  useAppData: () => ({
    version: 0,
    notice: null,
    mutate: (fn: () => Promise<unknown>) => fn(),
    toggleSubtopic: vi.fn(),
    topicById: new Map([["fe.ts", { id: "fe.ts", name: "TypeScript", districtId: "fe" }]]),
    districtById: new Map([["fe", { id: "fe", name: "Frontend Engineering", color: "#7f98a8" }]]),
  }),
}));

import { AddTaskPage, LogTimePage } from "../components/today/DayForms";
import { TaskPage } from "../components/today/TaskPage";

const props = { date: "2026-11-17", backLabel: "Today", onClose: vi.fn(), onOpenTopic: vi.fn() };
beforeEach(() => vi.clearAllMocks());

describe("a task's own page", () => {
  it("marks a study task done as its one primary action, and has the rest below", async () => {
    const { container } = render(<TaskPage {...props} id={1} />);
    expect(await screen.findByRole("heading", { name: "Generics" })).toBeInTheDocument();
    expect(container.querySelectorAll(".btn.primary")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(patchTask).toHaveBeenCalledWith(1, { status: "DONE" });
    for (const h of ["Log time", "Move to another day", "Edit"]) expect(screen.getByRole("heading", { name: h })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
  });

  it("revises a recall task: no tick, no edit, done only by its recall", async () => {
    render(<TaskPage {...props} id={9} />);
    expect(await screen.findByRole("button", { name: "Revise: Generics" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Edit" })).toBeNull();
    expect(screen.getByText("2 days overdue")).toBeInTheDocument();
  });

  it("finds a carried-over task and unpins it", async () => {
    render(<TaskPage {...props} id={5} />);
    fireEvent.click(await screen.findByRole("button", { name: /Unpin "Pinned earlier"/ }));
    expect(patchTask).toHaveBeenCalledWith(5, { pinned: false });
  });

  it("says so when the task is no longer on that day", async () => {
    render(<TaskPage {...props} id={77} />);
    expect(await screen.findByText(/isn't on .*17 November 2026 any more/)).toBeInTheDocument();
  });
});

describe("adding a task and logging time", () => {
  it("adds a study task to the day, then goes back", async () => {
    render(<AddTaskPage {...props} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Title" }), { target: { value: " Read the handbook " } });
    fireEvent.submit(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(createTask).toHaveBeenCalledWith({ title: "Read the handbook", scheduledDate: "2026-11-17", estimatedMinutes: 60, topicId: undefined, kind: "STUDY" });
  });

  it("logs time on the day's first open task by default, or on other study", async () => {
    render(<LogTimePage {...props} />);
    const what = await screen.findByRole("combobox", { name: "What you studied" });
    expect((what as HTMLSelectElement).value).toBe("1");
    fireEvent.submit(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(logTime).toHaveBeenCalledWith({ date: "2026-11-17", minutes: 30, taskId: 1 }));
    fireEvent.change(what, { target: { value: "" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(logTime).toHaveBeenLastCalledWith({ date: "2026-11-17", minutes: 30, topicId: "fe.ts" }));
  });
});
