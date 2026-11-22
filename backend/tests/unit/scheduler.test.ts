/** The scheduler (docs/Scheduler-Phase2-Plan.md): the day rules, re-planning, and its guarantees on generated plans. */
import { describe, expect, it } from "vitest";
import { type ISODate, addDays, isoWeekday } from "../../src/domain/dates.js";
import { forecast } from "../../src/domain/forecast.js";
import {
  type DayTime, type ReplanInput, type SchedStage, type SchedTask, dayBudget, emptyUse, replan, takeRecall, useRevision,
} from "../../src/domain/scheduler.js";
import { gapFor } from "../../src/modules/recall/rules.js";

const MON = "2026-11-23"; // a Monday
const weekdays = (available: number, newTarget: number): Record<number, DayTime> =>
  Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, d <= 5 ? { available, newTarget } : { available: 0, newTarget: 0 }]));
const day = (n: number) => addDays(MON, n);

let nextId = 1;
const task = (over: Partial<SchedTask> = {}): SchedTask => {
  const id = over.id ?? nextId++;
  return { id, kind: "NEW", state: "OPEN", minutes: 30, date: day(0), originalDate: day(0), position: id, stageId: null, ...over };
};
const recall = (due: ISODate, over: Partial<SchedTask> = {}) => task({ kind: "RECALL", minutes: 8, date: due, originalDate: due, ...over });
/** The tasks after a re-plan, as the database writes them: moved, and split tasks shortened with their parts added. */
function applied(tasks: SchedTask[], r: { moves: { id: number; to: ISODate }[]; splits: { id: number; minutes: number; parts: { minutes: number; date: ISODate }[] }[] }) {
  const to = new Map(r.moves.map((m) => [m.id, m.to]));
  const split = new Map(r.splits.map((x) => [x.id, x]));
  let id = Math.max(0, ...tasks.map((t) => t.id));
  const out = tasks.map((t) => ({ ...t, date: to.get(t.id) ?? t.date, minutes: split.get(t.id)?.minutes ?? t.minutes }));
  for (const x of r.splits) {
    const t = tasks.find((y) => y.id === x.id)!;
    for (const p of x.parts) out.push({ ...t, id: ++id, minutes: p.minutes, date: p.date });
  }
  return out;
}

/** Where each task ends up: its move, or where it was. */
const where = (input: ReplanInput) => {
  const r = replan(input);
  const to = new Map(r.moves.map((m) => [m.id, m.to]));
  return { ...r, at: (t: SchedTask) => to.get(t.id) ?? t.date };
};

describe("the day rules", () => {
  it("splits a day into revision and new-material time, and lets revision borrow up to half the new material", () => {
    expect(dayBudget({ available: 120, newTarget: 90 })).toEqual({ available: 120, revision: 30, newMaterial: 90, borrow: 45 });
    // A city that planned its full hours as new material: revision only borrows.
    expect(dayBudget({ available: 90, newTarget: 90 })).toEqual({ available: 90, revision: 0, newMaterial: 90, borrow: 45 });
  });

  it("fits recalls in revision time first, then borrows within the cap, then refuses", () => {
    const b = dayBudget({ available: 60, newTarget: 40 }); // 20 revision, borrow 20
    const u = emptyUse();
    expect([1, 2, 3, 4, 5].map(() => takeRecall(b, u, 8))).toEqual([true, true, true, true, true]); // 40 = 20 + 20 borrowed
    expect(takeRecall(b, u, 8)).toBe(false);
    expect(u).toEqual({ revision: 20, newMaterial: 20, borrowed: 20 });
    // Revision already on the day uses revision time, and its overflow counts as borrowed.
    const v = emptyUse();
    useRevision(b, v, 30);
    expect(v).toEqual({ revision: 20, newMaterial: 10, borrowed: 10 });
  });
});

describe("re-planning", () => {
  it("fills each study day's new-material time in order and skips rest days", () => {
    const ts = [0, 1, 2, 3, 4].map((i) => task({ minutes: 30, originalDate: day(0), position: i, date: day(-3) }));
    const r = where({ today: MON, week: weekdays(90, 60), stages: [], tasks: ts });
    // Overdue work: two fit today, two Tuesday, one Wednesday.
    expect(ts.map(r.at)).toEqual([day(0), day(0), day(1), day(1), day(2)]);
    const late = [0, 1, 2].map((i) => task({ minutes: 60, originalDate: day(3), position: i, date: day(3) }));
    // Thursday's tasks, re-planned on Friday: one on Friday, then the weekend is skipped.
    expect(late.map(where({ today: day(4), week: weekdays(90, 60), stages: [], tasks: late }).at)).toEqual([day(4), day(7), day(8)]);
  });

  it("splits a task that does not fit the room left, so no time goes unused, and keeps the order", () => {
    const ts = [task({ minutes: 30, position: 1, date: day(-1) }), task({ minutes: 60, position: 2, date: day(-1) }), task({ minutes: 30, position: 3, date: day(-1) })];
    const r = where({ today: MON, week: weekdays(60, 60), stages: [], tasks: ts });
    // Monday: 30, then half of the hour-long task; Tuesday: its other half, then the last task.
    expect(ts.map(r.at)).toEqual([day(0), day(0), day(1)]);
    expect(r.splits).toEqual([{ id: ts[1].id, minutes: 30, parts: [{ minutes: 30, date: day(1) }] }]);
    // No part shorter than 30 minutes: 45 minutes of room takes 30 of a 60-minute task, never 45 + 15.
    const t60 = task({ minutes: 60, date: day(-1) });
    expect(replan({ today: MON, week: weekdays(45, 45), stages: [], tasks: [t60] }).splits).toEqual([{ id: t60.id, minutes: 30, parts: [{ minutes: 30, date: day(1) }] }]);
  });

  it("does revision first: in revision time, then up to half the new material, then the next day", () => {
    const rs = Array.from({ length: 10 }, () => recall(day(-1)));
    const fresh = task({ minutes: 30, date: day(-1) });
    const r = where({ today: MON, week: weekdays(90, 60), stages: [], tasks: [...rs, fresh] });
    // 30 min revision + 30 borrowed = 7 recalls of 8 min on Monday; 3 on Tuesday.
    expect(rs.map(r.at).filter((d) => d === day(0))).toHaveLength(7);
    expect(rs.map(r.at).filter((d) => d === day(1))).toHaveLength(3);
    // Monday's new material shrank by what revision borrowed (26 of 60), so the 30-min task fits there.
    expect(r.at(fresh)).toBe(day(0));
  });

  it("never puts a recall before its due date", () => {
    const early = recall(day(2), { date: day(1) });
    expect(where({ today: MON, week: weekdays(90, 60), stages: [], tasks: [early] }).at(early)).toBe(day(2));
  });

  it("never moves finished, skipped or the learner's own tasks, and plans around them", () => {
    const fixed = task({ state: "FIXED", minutes: 60, date: day(1) });
    const skipped = task({ state: "SKIPPED", minutes: 60, date: day(-2) });
    const open = [task({ minutes: 60, date: day(-1), position: 1 }), task({ minutes: 60, date: day(-1), position: 2 })];
    const r = where({ today: MON, week: weekdays(60, 60), stages: [], tasks: [fixed, skipped, ...open] });
    expect(r.moves.map((m) => m.id)).not.toContain(fixed.id);
    expect(r.moves.map((m) => m.id)).not.toContain(skipped.id);
    expect(open.map(r.at)).toEqual([day(0), day(2)]); // Tuesday is full with the fixed task
  });

  it("keeps today's open tasks on today, and only carried-over work joins them", () => {
    const todays = task({ minutes: 30, date: day(0), position: 5 });
    const tomorrow = task({ minutes: 30, date: day(1), position: 6 });
    const overdue = task({ minutes: 30, date: day(-3), position: 1 });
    const r = where({ today: MON, week: weekdays(120, 120), stages: [], tasks: [todays, tomorrow, overdue] });
    expect([r.at(todays), r.at(overdue), r.at(tomorrow)]).toEqual([day(0), day(0), day(1)]); // tomorrow's is not pulled in
  });

  it("follows stages: their weekdays, the days a parallel stage claims, and a start brought forward once earlier work is placed", () => {
    const week = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { available: 60, newTarget: 60 }]));
    const stages: SchedStage[] = [
      { id: "main", kind: "MAIN", start: day(0), end: day(30), weekdays: [1, 2, 3, 4, 5, 6, 7], queue: "main" },
      { id: "side", kind: "PARALLEL", start: day(0), end: day(30), weekdays: [3], queue: "side" },
      { id: "later", kind: "MAIN", start: day(10), end: day(30), weekdays: [1, 2, 3, 4, 5], queue: "later" },
    ];
    const main = [1, 2, 3, 4].map((i) => task({ minutes: 60, stageId: "main", position: i, date: day(-1) }));
    const side = [1, 2].map((i) => task({ minutes: 60, stageId: "side", position: i, date: day(-1) }));
    const later = [task({ minutes: 60, stageId: "later", position: 1, date: day(-1) })];
    const r = where({ today: MON, week, stages, tasks: [...main, ...side, ...later] });
    // Main skips Wednesdays (the parallel stage's); the parallel stage only uses Wednesdays.
    expect(main.map(r.at)).toEqual([day(0), day(1), day(3), day(4)]);
    expect(side.map(r.at)).toEqual([day(2), day(9)]);
    expect(side.map(r.at).every((d) => isoWeekday(d) === 3)).toBe(true);
    // A later stage (10 Dec) starts as soon as the earlier main stage's work is placed (Fri 27 Nov), on its first
    // weekday with room: Monday 30 Nov, not its own start date.
    expect(r.at(later[0])).toBe(day(7));
    // While earlier work is still open, it waits for its own start date.
    const busy = [...Array(20)].map((_, i) => task({ minutes: 60, stageId: "main", position: 100 + i, date: day(-1) }));
    const r2 = where({ today: MON, week, stages, tasks: [...busy, ...later] });
    expect(r2.at(later[0]) >= day(10)).toBe(true);
  });

  it("splits a task bigger than a day across days, and puts one whole on a day too short for any part", () => {
    const big = task({ minutes: 120, position: 1, date: day(-1) });
    const next = task({ minutes: 30, position: 2, date: day(-1) });
    const r = where({ today: MON, week: weekdays(60, 60), stages: [], tasks: [big, next] });
    expect([r.at(big), r.at(next)]).toEqual([day(0), day(2)]);
    expect(r.splits).toEqual([{ id: big.id, minutes: 60, parts: [{ minutes: 60, date: day(1) }] }]);
    // 20 minutes a day can take no 30-minute part: the task goes whole, alone, rather than waiting for ever.
    const r2 = where({ today: MON, week: weekdays(20, 20), stages: [], tasks: [big] });
    expect([r2.at(big), r2.splits]).toEqual([day(0), []]);
  });

  it("puts a recall too big for any day alone on its own study day, as revision must not wait forever", () => {
    const rs = [recall(day(0), { minutes: 50, date: day(-1) }), recall(day(0), { minutes: 50, date: day(-1) })];
    const r = where({ today: MON, week: weekdays(20, 20), stages: [], tasks: rs }); // 0 revision, borrow 10
    expect(rs.map(r.at)).toEqual([day(0), day(1)]);
  });

  it("leaves work it cannot place where it is", () => {
    const t = task({ date: day(-1) });
    expect(replan({ today: MON, week: weekdays(0, 0), stages: [], tasks: [t], horizonDays: 30 })).toEqual({ moves: [], splits: [], unplaced: [t.id] });
  });
});

describe("a fresh plan", () => {
  it("only brings work forward on the first re-plan of a fresh plan: same order, a finish no later, then stable", async () => {
    const { buildPlan } = await import("../../src/domain/planner.js");
    const { DEFAULT_TARGETS, queues, stages } = await import("../../src/curriculum/index.js");
    const planQueues = Object.fromEntries(Object.entries(queues()).map(([k, v]) => [k, v.map((t) => ({ slug: t.slug, name: t.name, hours: t.hours, subtopics: t.subtopics, exercise: t.exercise }))]));
    const plan = buildPlan(stages, planQueues, DEFAULT_TARGETS);
    const first = stages.map((s) => s.start).sort()[0];
    const input: ReplanInput = {
      today: addDays(first, -1),
      week: Object.fromEntries(Object.entries(DEFAULT_TARGETS).map(([wd, m]) => [Number(wd), { available: m, newTarget: m }])),
      stages: stages.map((s) => ({ id: s.slug, kind: s.kind, start: s.start, end: s.end, weekdays: s.weekdays, queue: s.queue })),
      tasks: plan.map((p, i) => ({ id: i + 1, kind: "NEW", state: "OPEN", minutes: p.minutes, date: p.date, originalDate: p.date, position: p.position, stageId: p.stageSlug })),
    };
    expect(plan.length).toBeGreaterThan(100);
    const once = replan(input);
    expect(once.unplaced).toEqual([]);
    // The planner left days empty between stages; stages now start once the work before them is placed.
    expect(once.moves.length).toBeGreaterThan(0);
    expect(once.moves.every((m) => m.to < m.from)).toBe(true);
    const after = applied(input.tasks, once);
    const last = (ts: SchedTask[]) => ts.map((t) => t.date).sort().at(-1)!;
    expect(last(after) <= last(input.tasks)).toBe(true);
    expect(after.reduce((a, t) => a + t.minutes, 0)).toBe(input.tasks.reduce((a, t) => a + t.minutes, 0));
    const again = replan({ ...input, tasks: after });
    expect([again.moves, again.splits]).toEqual([[], []]);
  });
});

describe("the forecast uses the same day rules", () => {
  it("lets revision borrow only half the new material, so a recall burst waits rather than stopping new work", () => {
    const week = weekdays(16, 16); // no revision time; revision may borrow 8 min a day: one recall
    const f = forecast({
      today: MON, planEnd: day(30), targetDate: null, week, remainingNewMinutes: 8 * 3, gapFor, recallMinutes: 8,
      recalls: [0, 1, 2].map(() => ({ stage: 5, nextDueDate: MON })),
    });
    // Each day: one recall (8 borrowed) and 8 min of new material. Before the cap, Monday went to revision entirely.
    expect(f.projectedFinish).toBe(day(2));
    expect(f.revisionLoad[0]).toMatchObject({ recalls: 3, minutes: 24 });
  });
});

/* ---------------- generated plans ---------------- */

/** A small deterministic random source, so every run checks the same plans. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function generated(seed: number): ReplanInput {
  const rand = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const week: Record<number, DayTime> = {};
  for (let d = 1; d <= 7; d++) {
    const available = pick([0, 60, 90, 120, 180]);
    week[d] = { available, newTarget: available === 0 ? 0 : pick([0.5, 0.75, 1]) * available };
  }
  const parallelDay = pick([1, 2, 3, 4, 5, 6, 7]);
  const stages: SchedStage[] = [
    { id: "a", kind: "MAIN", start: day(-20), end: day(60), weekdays: [1, 2, 3, 4, 5, 6, 7], queue: "a" },
    { id: "b", kind: "MAIN", start: day(rand() < 0.5 ? 0 : 15), end: day(90), weekdays: [1, 2, 3, 4, 5], queue: "b" },
    ...(rand() < 0.6 ? [{ id: "p", kind: "PARALLEL" as const, start: day(-10), end: day(50), weekdays: [parallelDay], queue: "p" }] : []),
  ];
  const tasks: SchedTask[] = [];
  let id = 1;
  const n = 20 + Math.floor(rand() * 40);
  for (let i = 0; i < n; i++) {
    const original = day(Math.floor(rand() * 70) - 15);
    const state = pick(["OPEN", "OPEN", "OPEN", "OPEN", "FIXED", "SKIPPED"] as const);
    tasks.push({
      id: id++, kind: "NEW", state, minutes: pick([30, 30, 60, 90, 120, 150]),
      date: state === "FIXED" ? day(Math.floor(rand() * 20)) : addDays(original, Math.floor(rand() * 5)),
      originalDate: original, position: i, stageId: pick(stages).id,
    });
  }
  const r = Math.floor(rand() * 12);
  for (let i = 0; i < r; i++) {
    const due = day(Math.floor(rand() * 20) - 8);
    tasks.push({ id: id++, kind: "RECALL", state: rand() < 0.15 ? "FIXED" : "OPEN", minutes: 8, date: addDays(due, Math.floor(rand() * 3)), originalDate: due, position: 1000, stageId: null });
  }
  return { today: MON, week, stages, tasks, horizonDays: 400 };
}

describe("the scheduler's guarantees, on generated plans", () => {
  const seeds = Array.from({ length: 60 }, (_, i) => i + 1);

  it.each(seeds)("plan %i: order, time, due dates, fixed work, splits, and stability", (seed) => {
    const input = generated(seed);
    const r = replan(input);
    const { moves, splits, unplaced } = r;
    const stage = new Map(input.stages.map((s) => [s.id, s]));
    const after = applied(input.tasks, r);
    const original = new Map(input.tasks.map((t) => [t.id, t]));
    // Each task's pieces after the re-plan: itself, and its parts when split (parts have new ids, in order).
    const pieces = new Map<number, SchedTask[]>();
    let next = Math.max(0, ...input.tasks.map((t) => t.id));
    for (const t of input.tasks) pieces.set(t.id, [after.find((x) => x.id === t.id)!]);
    for (const x of splits) {
      for (let k = 0; k < x.parts.length; k++) {
        const partId = ++next;
        pieces.get(x.id)!.push(after.find((y) => y.id === partId)!);
      }
    }
    const first = (t: SchedTask) => pieces.get(t.id)![0].date;
    const lastOf = (t: SchedTask) => pieces.get(t.id)!.at(-1)!.date;

    // Fixed and skipped work never moves or splits; nothing moves before today; today only gains carried-over work.
    for (const m of moves) {
      const t = original.get(m.id)!;
      expect(t.state).toBe("OPEN");
      expect(m.to >= MON).toBe(true);
      if (m.to === MON) expect(t.date < MON).toBe(true);
    }
    for (const x of splits) {
      const t = original.get(x.id)!;
      expect([t.state, t.kind]).toEqual(["OPEN", "NEW"]);
      // Nothing is lost, no part is too short, and parts follow each other.
      expect(x.minutes + x.parts.reduce((a, p) => a + p.minutes, 0)).toBe(t.minutes);
      for (const m of [x.minutes, ...x.parts.map((p) => p.minutes)]) expect(m).toBeGreaterThanOrEqual(30);
      const days = [first(t), ...x.parts.map((p) => p.date)];
      for (let i = 1; i < days.length; i++) expect(days[i] > days[i - 1]).toBe(true);
    }
    // A recall never goes before its due date.
    for (const t of input.tasks.filter((x) => x.kind === "RECALL" && x.state === "OPEN" && !unplaced.includes(x.id))) expect(first(t) >= t.originalDate).toBe(true);

    // Within a queue, new material keeps its order (today's own open tasks stay where they are and are left out).
    const movable = input.tasks.filter((t) => t.kind === "NEW" && t.state === "OPEN" && t.date !== MON && !unplaced.includes(t.id));
    for (const q of new Set(input.stages.map((s) => s.queue))) {
      const line = movable.filter((t) => stage.get(t.stageId!)?.queue === q)
        .sort((a, b) => a.originalDate.localeCompare(b.originalDate) || a.position - b.position || a.id - b.id);
      for (let i = 1; i < line.length; i++) expect(first(line[i]) >= lastOf(line[i - 1])).toBe(true);
      // ...only on its stage's weekdays, and before its stage's start date only once every earlier stage of the same
      // kind has all its open work placed by then.
      for (const t of line) {
        const s = stage.get(t.stageId!)!;
        for (const p of pieces.get(t.id)!) expect(s.weekdays).toContain(isoWeekday(p.date));
        if (first(t) < s.start) {
          const earlierWork = movable.filter((x) => { const o = stage.get(x.stageId!); return o && o.kind === s.kind && o.start < s.start; });
          for (const x of earlierWork) expect(lastOf(x) <= first(t)).toBe(true);
        }
      }
    }

    // From tomorrow, no day gets more than its time, unless fixed work already overfills it, a day too short for any
    // part takes a task whole, or a recall too big for any day sits alone.
    const days = new Map<ISODate, SchedTask[]>();
    for (const t of after.filter((x) => x.state !== "SKIPPED" && !unplaced.includes(x.id))) {
      if (t.date > MON) days.set(t.date, [...(days.get(t.date) ?? []), t]);
    }
    for (const [d, ts] of days) {
      const b = dayBudget(input.week[isoWeekday(d)]);
      const fixed = ts.filter((t) => t.state === "FIXED").reduce((a, t) => a + t.minutes, 0);
      const placedNew = ts.filter((t) => t.state === "OPEN" && t.kind === "NEW");
      const total = ts.reduce((a, t) => a + t.minutes, 0);
      const tinyDay = placedNew.length === 1 && b.newMaterial < 30;
      const loneRecall = ts.filter((t) => t.state === "OPEN" && t.kind === "RECALL").length === 1 && placedNew.length === 0;
      if (!tinyDay && !loneRecall && fixed <= b.available) expect(total, `day ${d}`).toBeLessThanOrEqual(b.available);
      if (!tinyDay && fixed <= b.newMaterial) expect(placedNew.reduce((a, t) => a + t.minutes, 0) + ts.filter((t) => t.state === "FIXED" && t.kind === "NEW").reduce((a, t) => a + t.minutes, 0), `new on ${d}`).toBeLessThanOrEqual(b.newMaterial);
    }

    // Stable: re-planning its own result moves and splits nothing.
    const again = replan({ ...input, tasks: after });
    expect([again.moves, again.splits]).toEqual([[], []]);
  });
});
