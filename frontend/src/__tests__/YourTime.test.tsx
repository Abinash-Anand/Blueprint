/** "Your time" (docs/Availability-Phase3-Plan.md): load the current choice, preview each change, save what was previewed. */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeChoice, TimePreview, YourTime } from "../api/types";

const now: YourTime = {
  minutesPerDay: 240, studyDays: [1, 2, 3, 4, 5, 6], pace: "CURRENT", share: 1, uniform: true,
  targetDate: null, timezone: "Europe/Berlin", paces: { LIGHT: 0.6, STEADY: 0.75, INTENSIVE: 0.9 },
};
const unchanged: TimePreview = {
  split: { available: 1440, newMaterial: 1440, revision: 0 }, finish: { before: "2027-08-12", after: "2027-08-12" },
  target: { date: null, meets: null, neededNewMinutesPerWeek: null },
  revisionLoad: [0, 1, 2, 3].map((i) => ({ weekStart: `2026-11-${23 + 7 * i > 30 ? 30 : 23 + 7 * i}`, recalls: i, minutes: 8 * i })),
  moved: 0, splitTasks: 0, movedToday: 0, unchanged: true,
};
const more: TimePreview = {
  ...unchanged, split: { available: 1800, newMaterial: 1350, revision: 450 }, finish: { before: "2027-08-12", after: "2027-07-03" },
  target: { date: "2027-06-01", meets: false, neededNewMinutesPerWeek: 1600 }, moved: 483, splitTasks: 24, unchanged: false,
};

const yourTime = vi.fn(async () => now);
const previewTime = vi.fn(async (c: TimeChoice): Promise<TimePreview> => (c.minutesPerDay === 240 && c.pace === "CURRENT" && !c.targetDate ? unchanged : more));
const saveTime = vi.fn(async (_c: TimeChoice) => now);
vi.mock("../api/client", () => ({
  api: { yourTime: () => yourTime(), previewTime: (c: TimeChoice) => previewTime(c), saveTime: (c: TimeChoice) => saveTime(c) },
  ApiError: class extends Error { constructor(public status: number, public code: string, message: string) { super(message); } },
}));
vi.mock("../state/AppData", () => ({ useAppData: () => ({ mutate: (fn: () => Promise<unknown>) => fn() }) }));

import { YourTimePage, shiftText } from "../components/time/YourTime";

describe("Your time", () => {
  beforeEach(() => {
    for (const f of [yourTime, previewTime, saveTime]) f.mockClear();
  });

  it("opens on your plan as it is: your hours, days and current split, nothing to save", async () => {
    render(<YourTimePage backLabel="Progress" onClose={() => {}} />);
    expect(await screen.findByText("Your plan as it is.")).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Hours on a study day" }).getAttribute("aria-valuetext")).toBe("4 h on a study day");
    expect(screen.getByRole("button", { name: "Saturday" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Sunday" }).getAttribute("aria-pressed")).toBe("false");
    // No preset matches all new material: it shows as Current.
    expect(screen.getByText(/All new material, no revision time/)).toBeTruthy();
    expect(previewTime).toHaveBeenCalledWith({ minutesPerDay: 240, studyDays: [1, 2, 3, 4, 5, 6], pace: "CURRENT", targetDate: null, timezone: "Europe/Berlin" });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("previews a change before saving it, and saves exactly that choice", async () => {
    const onClose = vi.fn();
    render(<YourTimePage backLabel="Progress" onClose={onClose} />);
    await screen.findByText("Your plan as it is.");
    fireEvent.click(screen.getByRole("button", { name: "More (hours on a study day)" }));
    fireEvent.click(screen.getByRole("radio", { name: /Steady/ }));
    fireEvent.change(screen.getByLabelText("Finish by"), { target: { value: "2027-06-01" } });
    const finish = await screen.findByText("3 Jul 2027");
    const box = finish.closest(".yt-preview") as HTMLElement;
    expect(within(box).getByText("6 weeks earlier than now (12 Aug 2027)")).toBeTruthy();
    expect(within(box).getByText(/Not by 1 Jun 2027 at this pace: it needs about 26.7 h of new material a week \(this plans 22.5 h\)/)).toBeTruthy();
    expect(within(box).getByText(/483 tasks would move, 24 tasks split to fill your days/)).toBeTruthy();
    // Only the last choice is previewed (one call after load, one after the changes settle).
    expect(previewTime).toHaveBeenLastCalledWith({ minutesPerDay: 255, studyDays: [1, 2, 3, 4, 5, 6], pace: "STEADY", targetDate: "2027-06-01", timezone: "Europe/Berlin" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saveTime).toHaveBeenCalledWith({ minutesPerDay: 255, studyDays: [1, 2, 3, 4, 5, 6], pace: "STEADY", targetDate: "2027-06-01", timezone: "Europe/Berlin" });
  });

  it("says what is wrong with a choice and does not let it be saved", async () => {
    previewTime.mockImplementationOnce(async () => unchanged).mockImplementationOnce(async () => { const { ApiError } = await import("../api/client"); throw new ApiError(400, "VALIDATION_ERROR", "Unknown time zone."); });
    render(<YourTimePage backLabel="Today" onClose={() => {}} />);
    await screen.findByText("Your plan as it is.");
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "Mars/Olympus" } });
    // The server's own reason is shown.
    expect((await screen.findByRole("alert")).textContent).toBe("Unknown time zone.");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("goes back without saving", async () => {
    const onClose = vi.fn();
    render(<YourTimePage backLabel="Today" onClose={onClose} />);
    await screen.findByText("Your plan as it is.");
    fireEvent.click(screen.getByRole("button", { name: "Back to Today" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(saveTime).not.toHaveBeenCalled();
  });

  it("says how far the finish moves in days, then weeks", () => {
    expect(shiftText("2027-08-12", "2027-08-12")).toBe("the same day");
    expect(shiftText("2027-08-12", "2027-08-15")).toBe("3 days later");
    expect(shiftText("2027-08-12", "2027-07-03")).toBe("6 weeks earlier");
    expect(shiftText(null, "2027-07-03")).toBeNull();
  });
});
