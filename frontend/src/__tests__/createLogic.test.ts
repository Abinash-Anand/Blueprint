/** City creation without UI: the time promise, files, resuming. */
import { describe, expect, it } from "vitest";
import { addMonthsIso, fileSummary, fileType, onlyUnderstanding, provisionalName, resumeStep, timePlan } from "../components/cities/create/logic";

describe("time plan (matches the backend generator)", () => {
  const base = { hoursPerDay: 1, weekdays: [1, 2, 3, 4, 5], pace: "STEADY" as const, startDate: "2026-11-23" };

  it("finishes the estimated hours at the pace's share of the weekly time", () => {
    const p = timePlan({ ...base, estimatedHours: 150 });
    expect(p.weeklyHours).toBe(5);
    expect(p.newHoursPerWeek).toBe(3.75);
    expect(p.finish).toBe("2027-08-30"); // 150 / 3.75 = 40 weeks
    expect(p.short).toBe(false);
  });

  it("a faster pace finishes sooner, a slower one later", () => {
    const at = (pace: "LIGHT" | "STEADY" | "INTENSIVE") => timePlan({ ...base, pace, estimatedHours: 150 }).finish!;
    expect(at("INTENSIVE") < at("STEADY")).toBe(true);
    expect(at("STEADY") < at("LIGHT")).toBe(true);
  });

  it("with a finish-by date: says how many hours fit, and when the goal needs more", () => {
    const p = timePlan({ ...base, targetDate: "2027-11-23", estimatedHours: 800 });
    expect(p.finish).toBeNull();
    expect(p.fitHours).toBe(196); // 52.1 weeks × 3.75 h
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

  it("names a city from the learner's words until the AI suggests a name", () => {
    expect(provisionalName("  I want to reach German C1 so I can work  ")).toBe("I want to reach");
    expect(provisionalName("")).toBe("New city");
    expect(addMonthsIso("2026-11-23", 12)).toBe("2027-11-23");
  });
});

describe("the summary sent back with the draft", () => {
  it("keeps the summary's own fields and drops the reply's bookkeeping, which the draft's save refuses", () => {
    const reply = { name: "German B2", goal: "Work in Germany", subjects: ["Grammar"], plan: null, estimatedHours: 400, promptVersion: "understand-v3", model: "m", provider: "gwdg" };
    expect(onlyUnderstanding(reply)).toEqual({ name: "German B2", goal: "Work in Germany", subjects: ["Grammar"], plan: null, estimatedHours: 400 });
  });
});
