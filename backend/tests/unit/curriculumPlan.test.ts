/** What a new curriculum version does to an existing plan (docs/Scheduler-Phase2-Plan.md §2.5). */
import { describe, expect, it } from "vitest";
import { type CurriculumPlanInput, type PlanTaskRow, curriculumPlan } from "../../src/domain/curriculumPlan.js";
import { replan } from "../../src/domain/scheduler.js";

const topic = (slug: string, hours: number, subtopics = ["a", "b"]) => ({ slug, name: slug.toUpperCase(), hours, subtopics, exercise: `do ${slug}` });
let nextId = 100;
const row = (topicId: string, minutes: number, originalDate: string, position: number, over: Partial<PlanTaskRow> = {}): PlanTaskRow =>
  ({ id: nextId++, topicId, kind: "STUDY", status: "TODO", minutes, originalDate, position, stageId: "s1", ...over });

// Topic A (2 h) on 23–24 Nov, topic C (1 h) on 25 Nov; a new topic B goes between them.
const base = (): CurriculumPlanInput => {
  const tasks = [row("a", 60, "2026-11-23", 0), row("a", 60, "2026-11-24", 0), row("c", 60, "2026-11-25", 0)];
  return {
    topics: new Map([["a", topic("a", 2)], ["b", topic("b", 3)], ["c", topic("c", 1)]]),
    queues: { q: ["a", "b", "c"] },
    previousHours: new Map([["a", 2], ["c", 1]]),
    tasks,
    stages: [{ id: "s1", queue: "q", start: "2026-11-23" }],
  };
};

describe("a new curriculum version and the plan", () => {
  it("gives a new topic the planner's study and practice tasks, right after the topic before it", () => {
    const i = base();
    const p = curriculumPlan(i);
    expect(p.remove).toEqual([]);
    expect(p.resize).toEqual([]);
    // 3 h = 6 units: 2 practice (30 %), 4 study over 2 sub-topics.
    expect(p.create.map((t) => [t.kind, t.title, t.minutes, t.subtopicIndex])).toEqual([
      ["STUDY", "a", 60, 0], ["STUDY", "b", 60, 1], ["PRACTICE", "Practice: B", 60, null],
    ]);
    // Anchored on A's last task: same original date and position, created after it.
    expect(p.create.every((t) => t.originalDate === "2026-11-24" && t.position === 0 && t.stageId === "s1")).toBe(true);
  });

  it("puts them in order between their neighbours, so the scheduler keeps the curriculum's order", () => {
    const i = base();
    const p = curriculumPlan(i);
    let id = 1000;
    const created = p.create.map((t) => ({ id: id++, kind: "NEW" as const, state: "OPEN" as const, minutes: t.minutes, date: "2026-11-22", originalDate: t.originalDate, position: t.position, stageId: "s1" }));
    const existing = i.tasks.map((t) => ({ id: t.id, kind: "NEW" as const, state: "OPEN" as const, minutes: t.minutes, date: t.originalDate, originalDate: t.originalDate, position: t.position, stageId: "s1" }));
    const week = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { available: 60, newTarget: 60 }]));
    const r = replan({ today: "2026-11-23", week, stages: [{ id: "s1", kind: "MAIN", start: "2026-11-23", end: "2026-12-31", weekdays: [1, 2, 3, 4, 5, 6, 7], queue: "q" }], tasks: [...existing, ...created] });
    const at = new Map(r.moves.map((m) => [m.id, m.to]));
    const day = (t: { id: number; date: string }) => at.get(t.id) ?? t.date;
    // A on 23 and 24, then B's three hours, then C.
    expect([...existing.slice(0, 2), ...created, existing[2]].map(day)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28"]);
  });

  it("starts a queue's first topic at its stage's start when nothing comes before it", () => {
    const i = base();
    i.queues = { q: ["b", "a", "c"] };
    const p = curriculumPlan(i);
    expect(p.create[0]).toMatchObject({ originalDate: "2026-11-23", position: -1, stageId: "s1" });
  });

  it("adds practice right after a topic given more hours, counting what is done", () => {
    const i = base();
    i.topics.set("a", topic("a", 3)); // 2 h → 3 h
    i.tasks[0].status = "DONE";
    const p = curriculumPlan(i);
    const added = p.create.filter((t) => t.topicId === "a");
    // 180 min, 60 done, 60 open: 60 more, after A's last task.
    expect(added.map((t) => [t.kind, t.title, t.minutes, t.originalDate, t.position])).toEqual([["PRACTICE", "Practice: A (added time)", 60, "2026-11-24", 0]]);
  });

  it("takes time off the end of a topic given fewer hours, never from finished work", () => {
    const i = base();
    i.topics.set("a", topic("a", 1.5)); // 2 h → 1.5 h
    i.tasks[0].status = "DONE"; // 60 done; 30 left of 60 open
    const p = curriculumPlan(i);
    expect(p.resize).toEqual([{ id: i.tasks[1].id, minutes: 30 }]);
    expect(p.remove).toEqual([]);
    i.topics.set("a", topic("a", 1)); // 60 done: nothing left
    expect(curriculumPlan(i)).toMatchObject({ remove: [i.tasks[1].id], resize: [] });
  });

  it("leaves topics whose hours did not change, and topics no queue plans, alone", () => {
    const i = base();
    i.topics.delete("b");
    expect(curriculumPlan(i)).toEqual({ create: [], remove: [], resize: [] });
    i.queues = { q: ["a", "c"] };
    i.topics.set("b", topic("b", 3)); // optional: in no queue
    expect(curriculumPlan(i)).toEqual({ create: [], remove: [], resize: [] });
  });

  it("splits long chunks into parts of at most two hours", () => {
    const i = base();
    i.topics.set("b", topic("b", 10, ["only"]));
    const titles = curriculumPlan(i).create.map((t) => [t.title, t.minutes]);
    // 20 units: 6 practice (180 min), 14 study (420 min) in one sub-topic.
    expect(titles).toEqual([
      ["only (part 1 of 4)", 120], ["only (part 2 of 4)", 120], ["only (part 3 of 4)", 120], ["only (part 4 of 4)", 60],
      ["Practice: B (part 1 of 2)", 120], ["Practice: B (part 2 of 2)", 60],
    ]);
  });
});
