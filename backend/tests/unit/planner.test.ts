import { describe, expect, it } from "vitest";
import { buildPlan, stageCapacity, topicChunks, MAX_TASK_MINUTES } from "../../src/domain/planner.js";
import { isoWeekday } from "../../src/domain/dates.js";
import { DEFAULT_TARGETS, queues, stages, allTopics, BEDB_SEQUENCE } from "../../src/curriculum/index.js";

const planStages = stages.map((s) => ({ ...s, start: s.start, end: s.end }));
const planQueues = Object.fromEntries(
  Object.entries(queues()).map(([k, v]) => [k, v.map((t) => ({ slug: t.slug, name: t.name, hours: t.hours, subtopics: t.subtopics, exercise: t.exercise }))]),
);
const plan = buildPlan(planStages, planQueues, DEFAULT_TARGETS);

describe("topic chunks", () => {
  it("keeps the topic's hours and gives ~30% to practice", () => {
    const c = topicChunks({ slug: "x", name: "X", hours: 10, subtopics: ["a", "b", "c", "d", "e"], exercise: "do it" });
    expect(c.reduce((a, x) => a + x.minutes, 0)).toBe(600);
    expect(c.at(-1)!.kind).toBe("PRACTICE");
    expect(c.at(-1)!.minutes).toBe(180);
    expect(c.filter((x) => x.kind === "STUDY").every((x) => x.minutes >= 30)).toBe(true);
  });
  it("rejects topics too short for their sub-topics", () => {
    expect(() => topicChunks({ slug: "x", name: "X", hours: 1, subtopics: ["a", "b", "c"], exercise: "" })).toThrow();
  });
});

describe("generated plan (FR-CAL-03/04, AC-09)", () => {
  it("never schedules Sundays", () => {
    expect(plan.some((t) => isoWeekday(t.date) === 7)).toBe(false);
  });

  it("never exceeds 240 minutes per day or 120 per task", () => {
    const perDay = new Map<string, number>();
    for (const t of plan) perDay.set(t.date, (perDay.get(t.date) ?? 0) + t.minutes);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(240);
    expect(Math.max(...plan.map((t) => t.minutes))).toBeLessThanOrEqual(MAX_TASK_MINUTES);
  });

  it("schedules every core and important topic exactly to its estimate, and no optional topic", () => {
    const minutes = new Map<string, number>();
    for (const t of plan) minutes.set(t.topicSlug, (minutes.get(t.topicSlug) ?? 0) + t.minutes);
    for (const topic of allTopics()) {
      if (topic.priority === "OPTIONAL") expect(minutes.has(topic.slug)).toBe(false);
      else expect(minutes.get(topic.slug)).toBe(topic.hours * 60);
    }
  });

  it("keeps every task inside its stage window and the journey", () => {
    for (const t of plan) {
      const s = stages.find((x) => x.slug === t.stageSlug)!;
      expect(t.date >= s.start && t.date <= s.end).toBe(true);
    }
    expect(plan[0].date).toBe("2026-11-17");
    expect(plan.at(-1)!.date <= "2027-08-17").toBe(true);
  });

  it("reserves Saturdays Dec–Mar for the parallel architecture track", () => {
    const sats = plan.filter((t) => isoWeekday(t.date) === 6 && t.date >= "2026-12-01" && t.date <= "2027-03-31");
    expect(sats.length).toBeGreaterThan(0);
    expect(sats.every((t) => t.stageSlug === "ar-parallel" && t.topicSlug.startsWith("ar."))).toBe(true);
  });

  it("follows the interleaved backend/database sequence", () => {
    const firstSeen: string[] = [];
    for (const t of plan) if (t.stageSlug === "bedb" && !firstSeen.includes(t.topicSlug)) firstSeen.push(t.topicSlug);
    expect(firstSeen).toEqual(BEDB_SEQUENCE);
  });

  it("leaves buffer capacity in every stage (realistic load)", () => {
    const cap = stageCapacity(planStages, DEFAULT_TARGETS);
    for (const c of cap) {
      const used = plan.filter((t) => t.stageSlug === c.slug).reduce((a, t) => a + t.minutes, 0);
      expect(used).toBeLessThanOrEqual(c.minutes);
    }
  });

  it("is deterministic", () => {
    expect(buildPlan(planStages, planQueues, DEFAULT_TARGETS)).toEqual(plan);
  });
});
