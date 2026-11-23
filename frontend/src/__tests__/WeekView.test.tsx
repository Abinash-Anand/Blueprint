/** The week: study time once, what is coming up, and seven days that say when they are planned beyond their target. */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Week, WeekDay } from "../api/types";

const day = (date: string, over: Partial<WeekDay> = {}): WeekDay => ({
  date, weekday: 1, inJourney: true, isRestDay: false, targetMinutes: 225, plannedMinutes: 210, actualMinutes: 0,
  tasksTotal: 4, tasksDone: 0, revisionTasks: 0, recall: [], revisionPlannedMinutes: 0, revisionDoneMinutes: 0, overTargetMinutes: 0, ...over,
});
const week: Week = {
  weekStart: "2026-11-23", weekEnd: "2026-11-29", today: "2026-11-23",
  days: [
    day("2026-11-23", { plannedMinutes: 274, tasksTotal: 11, revisionTasks: 8, recall: ["Guards", "Resolvers"], overTargetMinutes: 49 }),
    ...["24", "25", "26", "27", "28"].map((d) => day(`2026-11-${d}`)),
    day("2026-11-29", { isRestDay: true, targetMinutes: 0, plannedMinutes: 0, tasksTotal: 0 }),
  ],
  totals: { targetMinutes: 1350, plannedMinutes: 1356, actualMinutes: 0, tasksDone: 0, tasksRemaining: 30, remainingMinutes: 1354 },
  milestones: [
    { date: "2026-11-25", type: "PRACTICE", title: "Practice: TypeScript", topicId: "fe.ts", stageId: null, done: false, presentation: { state: "milestone.planned", tone: "info", variant: "plain", icon: "flag", label: "Planned" } },
  ],
  tasks: [],
};

vi.mock("../api/client", () => ({ api: { week: vi.fn(async () => week) }, ApiError: class extends Error {} }));
vi.mock("../state/AppData", () => ({ useAppData: () => ({ version: 0 }) }));

import { WeekView } from "../components/WeekView";

describe("WeekView", () => {
  it("shows study time once, with no second planned total and no list of every task", async () => {
    render(<WeekView date={null} onDate={() => {}} onOpenDay={() => {}} onOpenTopic={() => {}} />);
    expect(await screen.findByText("6 study days of 3 h 45 · Sunday is a rest day")).toBeInTheDocument();
    expect(screen.getByText("of 22.5 h")).toBeInTheDocument();
    expect(screen.getByText("30 tasks left · 22 h 34")).toBeInTheDocument();
    expect(screen.queryByText(/Planned|Remaining this week/)).toBeNull();
  });

  it("says when a day is planned beyond its target, and each day is read in full and opens its day", async () => {
    const onOpenDay = vi.fn();
    render(<WeekView date={null} onDate={() => {}} onOpenDay={onOpenDay} onOpenTopic={() => {}} />);
    const monday = await screen.findByRole("button", { name: /Mon 23 Nov.*0 min of 3 h 45.*11 tasks · 4 h 34.*2 recalls.*49 min over/ });
    expect(monday).toHaveAttribute("aria-current", "date");
    expect(screen.getAllByText(/ over$/)).toHaveLength(1);
    fireEvent.click(monday);
    expect(onOpenDay).toHaveBeenCalledWith("2026-11-23");
  });

  it("lists what is coming up as rows that open the topic, without a badge for a plain planned milestone", async () => {
    const onOpenTopic = vi.fn();
    render(<WeekView date={null} onDate={() => {}} onOpenDay={() => {}} onOpenTopic={onOpenTopic} />);
    fireEvent.click(await screen.findByRole("button", { name: /Practice: TypeScript/ }));
    expect(onOpenTopic).toHaveBeenCalledWith("fe.ts");
    expect(screen.queryByText("Planned")).toBeNull();
  });
});
