/** A stage's dates: a page of its own opened from Progress, with one Save that moves the deadline only. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const patchStage = vi.fn(async () => ({}));
vi.mock("../api/client", () => ({ api: { patchStage: (...a: unknown[]) => patchStage(...(a as [])) }, ApiError: class extends Error {} }));
const stage = {
  id: "fe", position: 0, name: "Frontend Engineering", kind: "MAIN", startDate: "2026-11-17", endDate: "2026-12-31", districtIds: ["fe"],
  status: "ON_TRACK", delayDays: 0, tasksTotal: 144, tasksDone: 4, minutesTotal: 6120, minutesDone: 210, overdueTasks: 0, bufferDays: 9,
};
vi.mock("../state/AppData", () => ({ useAppData: () => ({ progress: { stages: [stage] }, mutate: (fn: () => Promise<unknown>) => fn(), notice: null }) }));

import { StagePage } from "../components/StagePage";

describe("stage dates", () => {
  it("saves only a real change, then goes back", async () => {
    const onClose = vi.fn();
    render(<StagePage id="fe" backLabel="Progress" onClose={onClose} />);
    expect(screen.getByRole("heading", { name: "Frontend Engineering" })).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save dates" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2027-01-07" } });
    expect(save).toBeEnabled();
    fireEvent.submit(save);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patchStage).toHaveBeenCalledWith("fe", { startDate: "2026-11-17", endDate: "2027-01-07" });
  });

  it("won't save an end before the start", () => {
    render(<StagePage id="fe" backLabel="Progress" onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2027-02-01" } });
    expect(screen.getByText(/The end can't come before the start/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save dates" })).toBeDisabled();
  });
});
