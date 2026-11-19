/** Semantic presentation (LLD §4.4): one mapping for every domain state, semantic tokens only, nothing else changed. */
import { CheckpointResult, EvaluationStatus, TaskStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  ICONS, PRESENTATION_VERSION, STATES, TONES, VARIANTS, attentionPresentation, checkpointPresentation, dayMonth, districtPresentation,
  evaluationPresentation, milestonePresentation, outcomePresentation, presentationCatalog, revisionPresentation, stagePresentation,
  subtopicPresentation, suggestionPresentation, taskPresentation, topicPresentation, verdictPresentation,
} from "../../src/domain/presentation.js";
import { Verdict } from "../../src/modules/ai/evaluation/schema.js";

const TODAY = "2026-11-18";

describe("presentation catalogue", () => {
  it("uses only known tones, variants and icons, and never a colour value", () => {
    for (const [key, st] of Object.entries(STATES)) {
      expect(TONES, key).toContain(st.tone);
      expect(VARIANTS, key).toContain(st.variant);
      expect(ICONS, key).toContain(st.icon);
    }
    expect(JSON.stringify(presentationCatalog())).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    expect(presentationCatalog().version).toBe(PRESENTATION_VERSION);
  });

  it("covers every semantic category the interface needs", () => {
    const used = new Set(Object.values(STATES).map((s) => s.tone));
    expect([...used].sort()).toEqual([...TONES].sort());
  });

  it("reserves the AI tone for AI output", () => {
    const ai = Object.entries(STATES).filter(([, s]) => s.tone === "ai").map(([k]) => k);
    expect(ai.every((k) => k.startsWith("ai."))).toBe(true);
  });
});

describe("tasks", () => {
  it("maps every task status, with overdue as danger", () => {
    for (const status of Object.values(TaskStatus)) expect(taskPresentation({ status, overdueDays: 0 }).state).toMatch(/^task\./);
    expect(taskPresentation({ status: "DONE", overdueDays: 0 })).toMatchObject({ tone: "success", label: "Done" });
    expect(taskPresentation({ status: "SKIPPED", overdueDays: 0 })).toMatchObject({ tone: "neutral", label: "Skipped" });
    expect(taskPresentation({ status: "TODO", overdueDays: 0 })).toMatchObject({ tone: "info", variant: "plain" });
    expect(taskPresentation({ status: "TODO", overdueDays: 1 })).toMatchObject({ tone: "danger", label: "1 day overdue" });
    expect(taskPresentation({ status: "TODO", overdueDays: 3 }).label).toBe("3 days overdue");
  });
});

describe("learning", () => {
  it("maps every topic status and the review flag", () => {
    expect(topicPresentation("NOT_STARTED", false)).toMatchObject({ tone: "neutral", label: "Not started" });
    expect(topicPresentation("IN_PROGRESS", false)).toMatchObject({ tone: "info", label: "In progress" });
    expect(topicPresentation("LEARNED", false)).toMatchObject({ tone: "info", label: "Learned" });
    expect(topicPresentation("DEMONSTRATED", false)).toMatchObject({ tone: "success", variant: "solid", label: "Demonstrated" });
    expect(topicPresentation("LEARNED", false).flags).toBeUndefined();
    expect(topicPresentation("LEARNED", true).flags).toEqual([expect.objectContaining({ state: "topic.needs-review", tone: "warning", label: "Needs review" })]);
  });

  it("maps sub-topics", () => {
    expect(subtopicPresentation(true)).toMatchObject({ tone: "success", label: "Learned" });
    expect(subtopicPresentation(false)).toMatchObject({ tone: "neutral", label: "Not learned" });
  });

  it("maps district progression without inventing locks", () => {
    expect(districtPresentation(true, false)).toMatchObject({ tone: "success", label: "Passed" });
    expect(districtPresentation(true, true).state).toBe("district.passed");
    expect(districtPresentation(false, true)).toMatchObject({ tone: "info", label: "Current" });
    expect(districtPresentation(false, false)).toMatchObject({ tone: "neutral", label: "Not reached" });
  });

  it("maps every stage status", () => {
    expect(stagePresentation("COMPLETE", 0).tone).toBe("success");
    expect(stagePresentation("ON_TRACK", 0).tone).toBe("info");
    expect(stagePresentation("BEHIND", 0).tone).toBe("warning");
    expect(stagePresentation("DELAYED", 4)).toMatchObject({ tone: "danger", label: "Delayed by 4 days" });
    expect(stagePresentation("UPCOMING", 0).tone).toBe("neutral");
  });

  it("maps milestones: a practice can be overdue, a stage end just ends", () => {
    expect(milestonePresentation({ type: "PRACTICE", date: TODAY, done: true }, TODAY).tone).toBe("success");
    expect(milestonePresentation({ type: "PRACTICE", date: "2026-11-17", done: false }, TODAY).tone).toBe("danger");
    expect(milestonePresentation({ type: "STAGE_END", date: "2026-11-17", done: false }, TODAY)).toMatchObject({ tone: "neutral", label: "Ended" });
    expect(milestonePresentation({ type: "PRACTICE", date: "2026-11-20", done: false }, TODAY).tone).toBe("info");
  });
});

describe("revision", () => {
  const r = (x: Parameters<typeof revisionPresentation>[0]) => revisionPresentation(x, TODAY);

  it("chooses one primary state in the documented order", () => {
    expect(r({ suspended: true, correctionPending: true, nextDueDate: "2026-11-01" })).toMatchObject({ state: "revision.paused", tone: "neutral" });
    expect(r({ correctionPending: true, nextDueDate: null })).toMatchObject({ state: "revision.correction", tone: "warning", label: "Correct the gap first" });
    expect(r({ correctionPending: false, nextDueDate: "2026-11-15" })).toMatchObject({ state: "revision.overdue", tone: "danger", label: "3 days overdue" });
    expect(r({ correctionPending: false, nextDueDate: TODAY })).toMatchObject({ state: "revision.due", tone: "info", label: "Due today" });
    expect(r({ correctionPending: false, nextDueDate: "2026-11-21" })).toMatchObject({ state: "revision.upcoming", tone: "neutral", label: "Next 21 Nov" });
    expect(r({ correctionPending: false, nextDueDate: "2026-11-21", lastAttemptDate: TODAY })).toMatchObject({ state: "revision.done-today", tone: "success", label: "Done today · next 21 Nov" });
    expect(r({ correctionPending: false, nextDueDate: "2026-11-10", completed: true })).toMatchObject({ state: "revision.done", label: "Revision recorded" });
  });

  it("shows Weak as a flag next to any state, never instead of it", () => {
    const p = r({ correctionPending: false, nextDueDate: "2026-11-15", weak: true });
    expect(p.state).toBe("revision.overdue");
    expect(p.flags).toEqual([expect.objectContaining({ state: "revision.weak", tone: "warning", label: "Weak" })]);
  });

  it("maps recall outcomes: failed, partial and successful are distinct", () => {
    expect([0, 1, 2, 3].map((s) => outcomePresentation(s).tone)).toEqual(["danger", "warning", "success", "success"]);
    expect(outcomePresentation(3)).toMatchObject({ variant: "solid", label: "Mastered this attempt" });
    expect(outcomePresentation(2).label).toBe("Recalled");
    for (const c of Object.values(CheckpointResult)) expect(checkpointPresentation(c).state).toMatch(/^checkpoint\./);
    expect(checkpointPresentation("PARTIAL").tone).toBe("warning");
  });

  it("ranks attention: overdue over due over nothing", () => {
    expect(attentionPresentation(3, 1)).toMatchObject({ tone: "danger", label: "1 overdue" });
    expect(attentionPresentation(3, 0)).toMatchObject({ tone: "info", label: "3 due" });
    expect(attentionPresentation(0, 0).tone).toBe("neutral");
  });
});

describe("cities", () => {
  it("maps every city status", async () => {
    const { cityPresentation } = await import("../../src/domain/presentation.js");
    const { CityStatus } = await import("@prisma/client");
    for (const st of Object.values(CityStatus)) expect(cityPresentation(st).state).toBe(`city.${st.toLowerCase()}`);
    expect(cityPresentation("PAUSED").tone).toBe("warning");
    expect(cityPresentation("COMPLETED")).toMatchObject({ tone: "success", variant: "solid" });
  });
});

describe("AI", () => {
  it("maps evaluation states, suggestions and every verdict", () => {
    for (const s of Object.values(EvaluationStatus)) expect(evaluationPresentation(s).state).toMatch(/^ai\./);
    expect(evaluationPresentation("FAILED").tone).toBe("danger");
    expect(evaluationPresentation("SUCCEEDED").tone).toBe("ai");
    expect(suggestionPresentation(2)).toMatchObject({ tone: "ai", label: "Suggests 2 · Recalled" });
    expect(suggestionPresentation(null)).toBeNull();
    for (const v of Verdict.options) expect(verdictPresentation(v).state).toMatch(/^verdict\./);
    expect(verdictPresentation("INCORRECT").tone).toBe("danger");
    expect(verdictPresentation("MISSING").tone).toBe("neutral");
  });
});

it("formats calendar dates without time zones", () => {
  expect(dayMonth("2027-01-05")).toBe("5 Jan");
  expect(dayMonth("2026-12-31")).toBe("31 Dec");
});
