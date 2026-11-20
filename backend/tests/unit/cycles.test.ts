/** Revision v2, phase 2: the learning model in code (plan §4.2, §4.3, §6). */
import { describe, expect, it } from "vitest";
import {
  type PlanConcept, type PlanItem, GAP_AFTER, RESULT, TOPIC_CAP, adaptiveGap, advanceTrack, conceptLevels, conceptPace, firstDue, itemMinutes, pickItem, planSession,
  planTopic, reviewFactor, rollUp, storyLine, suggestResult,
} from "../../src/modules/revision/cycles.js";

/** A concept with an open and a multiple-choice question at every level 1–6; ids are conceptId * 100 + level * 2 (+1 for MC). */
const items = (cid: number, top = 6): PlanItem[] =>
  Array.from({ length: top }, (_, i) => i + 1).flatMap((level) => [
    { id: cid * 100 + level * 2, level, kind: level === 1 ? "RECALL" : level === 2 ? "EXPLAIN" : level === 4 ? "DEBUG" : "APPLY", format: "OPEN" },
    { id: cid * 100 + level * 2 + 1, level, kind: "TRICKY_CHOICE", format: "CHOICE" },
  ]);
const concept = (id: number, over: Partial<PlanConcept> = {}): PlanConcept => ({ id, position: id, items: items(id), previous: null, current: null, ...over });

describe("levels and questions", () => {
  it("asks the cycle's levels, lower for struggling concepts and higher for strong ones, within the pack", () => {
    expect(conceptLevels(1, null, 6)).toEqual([1, 2]);
    expect(conceptLevels(3, RESULT.RECALLED, 6)).toEqual([3]);
    expect(conceptLevels(3, RESULT.STRUGGLED, 6)).toEqual([2]);
    expect(conceptLevels(3, RESULT.STRONG, 6)).toEqual([4]);
    expect(conceptLevels(6, RESULT.STRONG, 4)).toEqual([4]); // outline-only packs stop at level 4
    expect(conceptLevels(1, RESULT.FORGOT, 6)).toEqual([1]);
  });

  it("picks an unused question at the level and format, else the nearest level, else the least used", () => {
    const xs = items(1);
    expect(pickItem(xs, 3, "OPEN", new Map(), new Set())!.id).toBe(106);
    expect(pickItem(xs, 3, "CHOICE", new Map(), new Set())!.id).toBe(107);
    expect(pickItem(xs, 3, "OPEN", new Map([[106, 1]]), new Set())!.level).toBe(2); // nearest level, lower first
    const allUsed = new Map(xs.map((x) => [x.id, x.id === 104 ? 1 : 3]));
    expect(pickItem(xs, 3, "OPEN", allUsed, new Set())!.id).toBe(104); // least asked
    expect(pickItem([], 1, "OPEN", new Map(), new Set())).toBeNull();
  });

  it("times questions like the plan: choice 1, recall 2, explain 4, debug 6, apply 8 minutes", () => {
    expect([itemMinutes("TRICKY_CHOICE", "CHOICE"), itemMinutes("RECALL", "OPEN"), itemMinutes("EXPLAIN", "OPEN"), itemMinutes("DEBUG", "OPEN"), itemMinutes("APPLY", "OPEN")]).toEqual([1, 2, 4, 6, 8]);
  });
});

describe("a topic's questions today", () => {
  it("cycle 1: a multiple-choice and an open question per concept, at most five, concepts kept whole", () => {
    const q = planTopic({ cycle: 0, weakOnly: false }, [1, 2, 3, 4].map((id) => concept(id)), 6, new Map());
    expect(q.length).toBeLessThanOrEqual(TOPIC_CAP);
    expect(q.map((x) => x.conceptId)).toEqual([1, 1, 2, 2]); // a third pair would pass five
    expect(q.slice(0, 2).map((x) => [x.level, x.itemId % 2 === 1 ? "MC" : "OPEN"])).toEqual([[1, "MC"], [2, "OPEN"]]);
  });

  it("continues the cycle with the concepts not reviewed yet, weak ones first", () => {
    const cs = [concept(1, { current: RESULT.RECALLED }), concept(2, { previous: RESULT.STRONG }), concept(3, { previous: RESULT.STRUGGLED })];
    const q = planTopic({ cycle: 2, weakOnly: false }, cs, 6, new Map());
    expect(q.map((x) => x.conceptId)).toEqual([3, 3, 2]); // struggling concept: a pair a level lower; strong: one open question a level up
    expect(q.map((x) => x.level)).toEqual([2, 2, 4]);
  });

  it("a weak retry asks only the concepts still weak in the cycle", () => {
    const cs = [concept(1, { current: RESULT.RECALLED }), concept(2, { current: RESULT.FORGOT }), concept(3, { current: RESULT.STRONG })];
    expect([...new Set(planTopic({ cycle: 1, weakOnly: true }, cs, 6, new Map()).map((x) => x.conceptId))]).toEqual([2]);
  });

  it("a maintenance check asks every concept once, one open question each", () => {
    const cs = [concept(1, { current: RESULT.STRONG }), concept(2, { current: RESULT.RECALLED })];
    const q = planTopic({ cycle: 6, weakOnly: false, maintenance: true }, cs, 6, new Map());
    expect(q.map((x) => [x.conceptId, x.level, x.itemId % 2 === 0 ? "OPEN" : "MC"])).toEqual([[1, 6, "OPEN"], [2, 6, "OPEN"]]);
  });

  it("flags a question asked again when everything near its level has been asked", () => {
    const uses = new Map(items(1).map((x) => [x.id, 1]));
    const q = planTopic({ cycle: 2, weakOnly: false }, [concept(1, { previous: RESULT.RECALLED }), concept(2, { previous: RESULT.RECALLED })], 6, uses);
    expect(q.map((x) => [x.conceptId, x.reused])).toEqual([[1, true], [2, false]]);
  });

  it("skips concepts without questions", () => {
    expect(planTopic({ cycle: 0, weakOnly: false }, [concept(1, { items: [] })], 6, new Map())).toEqual([]);
  });
});

describe("a session", () => {
  const q = (n: number, minutes: number) => Array.from({ length: n }, (_, i) => ({ itemId: i + 1, conceptId: 1, level: 1, minutes, reused: false }));
  it("takes overdue topics first and fills about 85 % of the budget, interleaving the topics", () => {
    const plan = planSession([
      { topicId: "b", due: "2026-11-20", weak: false, cycle: 1, questions: q(2, 4) },
      { topicId: "a", due: "2026-11-18", weak: false, cycle: 0, questions: q(3, 4) },
      { topicId: "c", due: "2026-11-20", weak: true, cycle: 2, questions: q(3, 6) },
    ], 30);
    expect(plan.topics).toEqual(["a", "b"]); // a is overdue; c (18 min) no longer fits into 25.5 minutes
    expect(plan.minutes).toBe(20);
    expect(plan.queue.map((x) => x.topicId)).toEqual(["a", "b", "a", "b", "a"]);
    expect(plan.queue[0].cycle).toBe(1);
    expect(plan.left).toBe(1);
  });

  it("always takes at least one topic, even past the budget", () => {
    expect(planSession([{ topicId: "a", due: "2026-11-20", weak: false, cycle: 0, questions: q(5, 8) }], 30).queue).toHaveLength(5);
  });
});

describe("results", () => {
  it("suggests Recalled for a right choice and Forgot for a wrong one; hints lower it", () => {
    expect(suggestResult({ format: "CHOICE", correct: true, aiScore: null, hintsUsed: 0 })).toBe(RESULT.RECALLED);
    expect(suggestResult({ format: "MULTI", correct: false, aiScore: null, hintsUsed: 0 })).toBe(RESULT.FORGOT);
    expect(suggestResult({ format: "OPEN", correct: null, aiScore: 3, hintsUsed: 1 })).toBe(RESULT.RECALLED);
    expect(suggestResult({ format: "OPEN", correct: null, aiScore: 3, hintsUsed: 3 })).toBe(RESULT.STRUGGLED);
    expect(suggestResult({ format: "OPEN", correct: null, aiScore: null, hintsUsed: 0 })).toBeNull(); // no AI check: the learner judges
  });

  it("rolls answers up per concept: the weakest, Strong only with an own-words answer, relearning lifts to Recalled", () => {
    const r = rollUp([
      { conceptId: 1, format: "CHOICE", final: 3, relearn: false },
      { conceptId: 2, format: "CHOICE", final: 2, relearn: false },
      { conceptId: 2, format: "OPEN", final: 3, relearn: false },
      { conceptId: 3, format: "OPEN", final: 1, relearn: false },
      { conceptId: 3, format: "CHOICE", final: 2, relearn: true },
      { conceptId: 4, format: "OPEN", final: 0, relearn: false },
      { conceptId: 4, format: "CHOICE", final: 0, relearn: true },
      { conceptId: 5, format: "CHOICE", final: 2, relearn: true },
      { conceptId: 6, format: "CHOICE", final: 1, relearn: false },
      { conceptId: 6, format: "OPEN", final: 3, relearn: false },
    ]);
    expect(Object.fromEntries(r)).toEqual({
      1: { result: 2, firstResult: 2 }, // multiple choice alone: at most Recalled
      2: { result: 3, firstResult: 3 }, // a right choice does not hide a strong own-words answer
      6: { result: 1, firstResult: 1 }, // but a miss decides
      3: { result: 2, firstResult: 1 },
      4: { result: 0, firstResult: 0 },
    });
  });
});

describe("cycles and dates", () => {
  const t = { cycle: 0, state: "ACTIVE" as const, nextDueDate: "2026-11-20", weakOnly: false };
  it("finishes a cycle when every concept is Recalled or better, then waits 3, 7, 14, 30, 60 days", () => {
    expect(advanceTrack(t, [2, 3], "2026-11-20", "2026-11-20")).toEqual({ cycle: 1, state: "ACTIVE", nextDueDate: "2026-11-23", weakOnly: false });
    expect(Object.values(GAP_AFTER)).toEqual([3, 7, 14, 30, 60]);
    expect(advanceTrack({ ...t, cycle: 3 }, [2], "2026-11-20", "2026-11-20").nextDueDate).toBe("2026-12-20"); // cycle 4 done: 30 days
    expect(advanceTrack({ ...t, cycle: 4 }, [2], "2026-11-20", "2026-11-20").nextDueDate).toBe("2027-01-19"); // cycle 5 done: 60 days
  });

  it("retains the topic after cycle 6", () => {
    expect(advanceTrack({ ...t, cycle: 5 }, [3, 2], "2026-11-20", "2026-11-20")).toEqual({ cycle: 6, state: "RETAINED", nextDueDate: null, weakOnly: false });
  });

  it("asks weak concepts again sooner, without counting a cycle", () => {
    expect(advanceTrack(t, [2, 1], "2026-11-20", "2026-11-20")).toEqual({ ...t, nextDueDate: "2026-11-22", weakOnly: true });
    expect(advanceTrack(t, [0, 3], "2026-11-20", "2026-11-20")).toEqual({ ...t, nextDueDate: "2026-11-21", weakOnly: true });
  });

  it("continues tomorrow while concepts are left in the cycle", () => {
    expect(advanceTrack(t, [2, null], "2026-11-20", "2026-11-20")).toEqual({ ...t, nextDueDate: "2026-11-21", weakOnly: false });
  });

  it("grows the interval less after an early review", () => {
    expect(advanceTrack({ ...t, cycle: 1 }, [2], "2026-11-20", "2026-11-21").nextDueDate).toBe("2026-11-26"); // 7 - 1 day early
  });

  it("starts the first cycle the day after the first sub-topic was learned, never in the past", () => {
    expect(firstDue("2026-11-20", "2026-11-20")).toBe("2026-11-21");
    expect(firstDue("2026-11-01", "2026-11-20")).toBe("2026-11-20");
    expect(firstDue(null, "2026-11-20")).toBeNull();
  });

  it("tells each concept's story across cycles", () => {
    expect(storyLine("Cold vs hot", [{ cycle: 1, result: 1 }, { cycle: 2, result: 1 }, { cycle: 3, result: 2 }])).toBe("Cold vs hot: struggled in cycles 1–2, recalled in 3.");
    expect(storyLine("Subjects", [{ cycle: 1, result: 3 }])).toBe("Subjects: strong in cycle 1.");
    expect(storyLine("x", [])).toBe("x: not revised yet.");
  });
});

describe("adaptive intervals (phase 4)", () => {
  const ev = (result: number, over: Partial<{ firstResult: number; hints: number; confidence: number | null }> = {}) => ({ result, firstResult: result, hints: 0, confidence: null, ...over });

  it("scores one review: the first attempt counts, hints and confident misses shrink the gap", () => {
    expect(reviewFactor(ev(3))).toBe(1.3);
    expect(reviewFactor(ev(2))).toBe(1);
    expect(reviewFactor(ev(2, { firstResult: 0 }))).toBe(0.5); // relearned today: the interval still follows the miss
    expect(reviewFactor(ev(2, { hints: 2 }))).toBeCloseTo(0.8);
    expect(reviewFactor(ev(2, { hints: 9 }))).toBeCloseTo(0.7); // at most three hints count
    expect(reviewFactor(ev(1, { confidence: 3 }))).toBeCloseTo(0.63);
  });

  it("moves a concept's pace only as far as its evidence goes, within ±50 %", () => {
    expect(conceptPace([])).toBe(1);
    expect(conceptPace([ev(3)])).toBeCloseTo(1.1); // one review: a third of the way to 1.3
    expect(conceptPace([ev(3), ev(3), ev(3)])).toBeCloseTo(1.3);
    expect(conceptPace([ev(0), ev(0), ev(0), ev(0)])).toBe(0.5); // only the last three, and never below half
    expect(conceptPace([ev(0), ev(3), ev(3), ev(3)])).toBeCloseTo(1.3);
  });

  it("lets the weakest concept decide the topic's gap, and says why", () => {
    expect(adaptiveGap(14, [{ title: "Generics", history: [ev(2), ev(2), ev(2)] }])).toEqual({ days: 14, fixed: 14, reason: null });
    expect(adaptiveGap(14, [{ title: "Generics", history: [ev(3), ev(3), ev(3)] }, { title: "Inference", history: [ev(3), ev(3), ev(3)] }]))
      .toEqual({ days: 18, fixed: 14, reason: "every concept recalled well" });
    expect(adaptiveGap(14, [{ title: "Generics", history: [ev(3), ev(3), ev(3)] }, { title: "Constraints", history: [ev(2), ev(1), ev(2, { hints: 2 })] }]))
      .toEqual({ days: 12, fixed: 14, reason: "Constraints needed hints" }); // 14 × (1 · 0.7 · 0.8)^(1/3)
    expect(adaptiveGap(3, [{ title: "x", history: [ev(1), ev(2, { firstResult: 0 })] }])).toEqual({ days: 2, fixed: 3, reason: "x was shaky" });
    expect(adaptiveGap(7, [])).toEqual({ days: 7, fixed: 7, reason: null });
  });

  it("uses the adapted gap when a cycle finishes, still less by the days a review was early", () => {
    const t = { cycle: 2, state: "ACTIVE" as const, nextDueDate: "2026-11-20", weakOnly: false };
    expect(advanceTrack(t, [2, 3], "2026-11-20", "2026-11-20", () => 10).nextDueDate).toBe("2026-11-30");
    expect(advanceTrack(t, [2, 3], "2026-11-20", "2026-11-22", () => 10).nextDueDate).toBe("2026-11-28");
    expect(advanceTrack(t, [2, 1], "2026-11-20", "2026-11-20", () => 10)).toMatchObject({ nextDueDate: "2026-11-22", weakOnly: true }); // a retry ignores it
  });
});
