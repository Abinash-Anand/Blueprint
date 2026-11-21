/** Recall on Today (docs/Recall-Plan.md §3.1): due today, else what comes next, so a new schedule is visible at once. */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RecallHome } from "../api/types";

const item = (subtopicId: number, subtopic: string, nextDueDate: string) => ({ subtopicId, subtopic, topicId: "fe.ng", topic: "Components", district: "Frontend", stage: 0, nextDueDate, lastReviewDate: null, taskId: subtopicId, scheduledDate: nextDueDate, overdueDays: 0 });
let home: RecallHome;
const base = (over: Partial<RecallHome>): RecallHome => ({
  today: "2026-11-20", limit: 3, doneToday: 0, due: [], later: [], upcoming: [], open: [],
  ai: { available: true, reason: null, consented: true, provider: "gwdg", model: "m" }, ...over,
});
vi.mock("../api/client", () => ({ api: { recallHome: vi.fn(async () => home) }, ApiError: class extends Error {} }));
vi.mock("../state/AppData", () => ({ useAppData: () => ({ version: 0 }) }));

import { RecallToday } from "../components/recall/RecallToday";

describe("recall on Today", () => {
  it("shows what is due today with a way in", async () => {
    home = base({ due: [item(1, "Lifecycle hooks", "2026-11-20")] });
    const onOpen = vi.fn();
    render(<RecallToday onOpen={onOpen} />);
    expect(await screen.findByText("1 sub-topic to recall")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recall now" }));
    expect(onOpen).toHaveBeenCalled();
  });

  it("when nothing is due, says what comes tomorrow, so a sub-topic just learned is visible", async () => {
    home = base({ upcoming: [item(1, "Lifecycle hooks", "2026-11-21"), item(2, "Decorator metadata", "2026-11-21"), item(3, "Inputs", "2026-11-24")] });
    render(<RecallToday onOpen={() => {}} />);
    expect(await screen.findByText("Tomorrow: 2 sub-topics to recall")).toBeTruthy();
    expect(screen.getByText(/Lifecycle hooks, Decorator metadata/)).toBeTruthy();
  });

  it("names the date when the next recall is later than tomorrow, and hides when nothing is scheduled", async () => {
    home = base({ upcoming: [item(3, "Inputs", "2026-11-24")] });
    const { unmount } = render(<RecallToday />);
    expect(await screen.findByText("24 Nov: 1 sub-topic to recall")).toBeTruthy();
    unmount();
    home = base({});
    const { container } = render(<RecallToday />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });
});
