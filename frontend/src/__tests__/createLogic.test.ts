/** City creation without UI: the time promise, files, resuming. */
import { describe, expect, it } from "vitest";
import { UNTITLED, fileSummary, fileType, newMinutesPerDay, onlyUnderstanding, resumeStep, studyDaysFor, timePlan } from "../components/cities/create/logic";

describe("time plan (matches the backend generator)", () => {
  const base = { hoursPerDay: 1, weekdays: [1, 2, 3, 4, 5], pace: "STEADY" as const, startDate: "2026-11-23" };

  it("finishes the estimated hours as the generator's calendar does: new material a day, plus the 15 % stage buffer", () => {
    const p = timePlan({ ...base, estimatedHours: 150 });
    expect(p.weeklyHours).toBe(5);
    expect(p.newHoursPerWeek).toBe(3.75);
    // 1 h at 75 % = 45 min, in 30-minute steps = 60 min a day; 150 days + 23 buffer + 1 = 174 study days.
    expect(newMinutesPerDay(1, 0.75)).toBe(60);
    expect(studyDaysFor(150, 60)).toBe(174);
    expect(p.finish).toBe("2027-07-22");
    expect(p.short).toBe(false);
  });

  it("gives every district its own stage buffer, as the generator does", () => {
    // 24 h at 3.5 h of new material a day: one stage of 7 days + 2 + 1, or seven stages of 1 + 1 + 1.
    expect(newMinutesPerDay(4, 0.9)).toBe(210);
    expect(studyDaysFor(24, 210, 1)).toBe(10);
    expect(studyDaysFor(24, 210, 7)).toBe(21);
    const week = { hoursPerDay: 4, weekdays: [1, 2, 3, 4, 5, 6], pace: "INTENSIVE" as const, startDate: "2026-11-23", estimatedHours: 24, districts: 7 };
    expect(timePlan(week).finish).toBe("2026-12-16");
    // A week to 30 Nov can't hold seven stages: the screen says so before the city is built.
    expect(timePlan({ ...week, targetDate: "2026-11-30" }).short).toBe(true);
    expect(timePlan({ ...week, targetDate: "2026-12-16" }).short).toBe(false);
  });

  it("a faster pace finishes sooner, a slower one later", () => {
    const at = (pace: "LIGHT" | "STEADY" | "INTENSIVE") => timePlan({ ...base, hoursPerDay: 2, pace, estimatedHours: 150 }).finish!;
    expect(at("INTENSIVE") < at("STEADY")).toBe(true);
    expect(at("STEADY") < at("LIGHT")).toBe(true);
  });

  it("with a finish-by date: says how many hours fit, and when the goal needs more", () => {
    const p = timePlan({ ...base, targetDate: "2027-11-23", estimatedHours: 800 });
    expect(p.finish).toBeNull();
    expect(p.fitHours).toBe(226); // (262 study days − 1 stage day) ÷ 1.15 × 1 h
    expect(p.short).toBe(true);
    expect(timePlan({ ...base, targetDate: "2027-11-23", estimatedHours: 150 }).short).toBe(false);
  });

  it("never promises more than three years", () => {
    const p = timePlan({ ...base, estimatedHours: 800 });
    expect(p.tooLong).toBe(true);
    expect(p.finish! <= "2029-11-26").toBe(true);
  });

  it("uses the server's shares when it sends them", () => {
    expect(timePlan({ ...base, estimatedHours: 100 }, { LIGHT: 0.5, STEADY: 0.5, INTENSIVE: 1 }).newHoursPerWeek).toBe(2.5);
  });
});

describe("plan files", () => {
  it("accepts PDF and text by type, or by extension when the browser gives none", () => {
    expect(fileType({ name: "plan.pdf", type: "application/pdf" })).toBe("application/pdf");
    expect(fileType({ name: "notes.md", type: "" })).toBe("text/markdown");
    expect(fileType({ name: "notes.TXT", type: "" })).toBe("text/plain");
    expect(fileType({ name: "photo.png", type: "image/png" })).toBeNull();
    expect(fileType({ name: "doc.docx", type: "" })).toBeNull();
  });

  it("says what was read, or that nothing was", () => {
    const f = { id: 1, name: "p.pdf", mimeType: "application/pdf", size: 1, pages: 4, chars: 9800, hasText: true, preview: "" };
    expect(fileSummary(f)).toBe("4 pages · 9,800 characters read");
    expect(fileSummary({ ...f, hasText: false })).toBe("No text found: it looks scanned");
    expect(fileSummary({ ...f, mimeType: "text/plain", pages: null, chars: 120 })).toBe("120 characters read");
  });
});

describe("resuming a draft", () => {
  it("continues where the learner left off", () => {
    expect(resumeStep(null, null, [])).toBe("goal");
    expect(resumeStep({ understood: { subjects: ["Grammar"] } }, null, [])).toBe("understood");
    expect(resumeStep({ understood: { subjects: ["Grammar"] } }, { startDate: "2026-11-23", weekdays: [1] }, [])).toBe("time");
    expect(resumeStep(null, null, [{ status: "GENERATING" }])).toBe("build");
    expect(resumeStep(null, null, [{ status: "PROPOSED" }])).toBe("build");
    expect(resumeStep(null, null, [{ status: "FAILED" }])).toBe("goal");
  });

  it("calls a new draft Untitled until step 2 names it, never words cut from the goal", () => {
    expect(UNTITLED).toBe("Untitled draft");
  });
});

describe("the summary sent back with the draft", () => {
  it("keeps the summary's own fields and drops the reply's bookkeeping, which the draft's save refuses", () => {
    const reply = { name: "German B2", goal: "Work in Germany", subjects: ["Grammar"], plan: null, estimatedHours: 400, promptVersion: "understand-v3", model: "m", provider: "gwdg" };
    expect(onlyUnderstanding(reply)).toEqual({ name: "German B2", goal: "Work in Germany", subjects: ["Grammar"], plan: null, estimatedHours: 400 });
  });
});
