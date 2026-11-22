/** The forecast on Progress (Blueprint relationship model, phase 1). */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Forecast } from "../api/types";
import { ForecastView } from "../components/ProgressView";

const f: Forecast = {
  remainingNewMinutes: 1800, projectedFinish: "2027-03-26", planEnd: "2027-03-05", daysVsPlan: 21, targetDate: "2027-02-28", meetsTarget: false,
  neededNewMinutesPerWeek: 720, week: { available: 720, newMaterial: 540, revision: 180 },
  revisionLoad: [{ weekStart: "2026-11-23", recalls: 4, minutes: 32 }, { weekStart: "2026-11-30", recalls: 2, minutes: 16 }, { weekStart: "2026-12-07", recalls: 1, minutes: 8 }, { weekStart: "2026-12-14", recalls: 0, minutes: 0 }],
};

describe("forecast", () => {
  it("shows the projected finish against the plan, the target check, the week's split and the revision ahead", () => {
    const { container } = render(<ForecastView f={f} />);
    expect(screen.getByRole("heading", { name: /^Forecast/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change your time" })).toBeTruthy();
    const text = container.textContent!;
    expect(text).toMatch(/Projected finish26 Mar 2027.*30 h of new material left · 3 weeks after the plan's end \(5 Mar 2027\)/);
    expect(text).toMatch(/Target date28 Feb 2027Not at this pace: it needs about 12 h of new material a week \(you plan 9 h\)/);
    expect(text).toMatch(/Your week12 h9 h new material · 3 h revision/);
    expect(text).toMatch(/Revision, next 4 weeks7recalls4 · 2 · 1 · 0 a week, from the week of 23 Nov/);
  });

  it("says when there is no target, and when the plan is on track", () => {
    const { container } = render(<ForecastView f={{ ...f, targetDate: null, meetsTarget: null, neededNewMinutesPerWeek: null, daysVsPlan: 0, projectedFinish: "2027-03-05" }} />);
    expect(container.textContent).toMatch(/on the plan's last day.*Target dateNoneNo finish date was set/);
  });
});
