/**
 * Phase 2, step 2 (docs/Scheduler-Phase2-Plan.md): re-plans every city with the new scheduler and reports what would
 * change. Saves nothing: no task, date or setting changes.
 *
 *   node dist/src/scripts/replan-dry-run.js            # every city
 *   node dist/src/scripts/replan-dry-run.js --moves 8  # and up to 8 example moves per city
 *
 * Per city: open work; tasks that would move (new material and recalls, later or earlier, the largest shift); days
 * over their time from tomorrow, before and after; the last day of open new material before and after, next to the
 * forecast's projected finish; and tasks that would find no day. Stage weekdays and queues come from the city's
 * applied curriculum (the built-in template for Engineering City); stage dates from the database, as the learner may
 * have changed them.
 */
import type { Prisma } from "@prisma/client";
import { d2i } from "../db.js";
import { createPrisma } from "../db.js";
import { stages as builtinStages } from "../curriculum/index.js";
import { type ISODate, addDays, dateIn, diffDays, isoWeekday } from "../domain/dates.js";
import { forecast } from "../domain/forecast.js";
import { type SchedStage, type SchedTask, dayBudget, replan } from "../domain/scheduler.js";
import { cityScoped } from "../lib/cityScope.js";
import { RULES, gapFor } from "../modules/recall/rules.js";
import { loadWeek } from "../modules/schedule/service.js";

const at = process.argv.indexOf("--moves");
const exampleMoves = at >= 0 ? Number(process.argv[at + 1]) : 0;
const prisma = createPrisma();
const now = new Date();

type DocStage = { key: string; queue: string; weekdays: number[] };

/** Each stage's queue and weekdays, by stage id. */
async function stagePlan(city: { id: string; idPrefix: string; template: string | null }): Promise<Map<string, DocStage>> {
  if (city.template === "engineering") return new Map(builtinStages.map((s) => [s.slug, { key: s.slug, queue: s.queue, weekdays: s.weekdays }]));
  const v = await prisma.curriculumVersion.findFirst({ where: { cityId: city.id, status: "APPLIED" }, orderBy: { version: "desc" }, select: { content: true } });
  const stages = ((v?.content as Prisma.JsonObject | null)?.stages ?? []) as unknown as DocStage[];
  return new Map(stages.map((s) => [`${city.idPrefix}${s.key}`, s]));
}

const report: unknown[] = [];
try {
  for (const city of await prisma.city.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, idPrefix: true, template: true } })) {
    const db = cityScoped(prisma, city.id);
    const settings = await db.settings.findFirst();
    if (!settings) { report.push({ city: city.name, skipped: "no settings" }); continue; }
    const today = dateIn(settings.timezone, now);
    const week = await loadWeek(db);
    const plan = await stagePlan(city);
    const stageRows = await db.stage.findMany({ orderBy: { position: "asc" } });
    const missing = stageRows.filter((s) => !plan.has(s.id)).map((s) => s.id);
    const stages: SchedStage[] = stageRows.filter((s) => plan.has(s.id)).map((s) => ({
      id: s.id, kind: s.kind, start: d2i(s.startDate), end: d2i(s.endDate), weekdays: plan.get(s.id)!.weekdays, queue: plan.get(s.id)!.queue,
    }));

    const rows = await db.task.findMany({
      select: { id: true, title: true, kind: true, source: true, status: true, estimatedMinutes: true, scheduledDate: true, originalDate: true, position: true, stageId: true, recallStateId: true },
    });
    const tasks: SchedTask[] = rows.map((t) => {
      const recall = t.kind === "REVISION";
      const state = t.status === "SKIPPED" ? "SKIPPED"
        : t.status === "DONE" || t.source === "MANUAL" || (recall && !t.recallStateId) ? "FIXED" // the old revision system's tasks stay
          : "OPEN";
      return {
        id: t.id, kind: recall ? "RECALL" : "NEW", state, minutes: t.estimatedMinutes, date: d2i(t.scheduledDate),
        originalDate: d2i(t.originalDate), position: t.position, stageId: t.stageId,
      };
    });
    const { moves, unplaced } = replan({ today, week, stages, tasks });
    const to = new Map(moves.map((m) => [m.id, m.to]));
    const after = (t: SchedTask) => to.get(t.id) ?? t.date;
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const title = new Map(rows.map((t) => [t.id, t.title]));

    // Days from tomorrow with more work than time, before and after.
    const over = (dateOf: (t: SchedTask) => ISODate) => {
      const load = new Map<ISODate, number>();
      for (const t of tasks) {
        if (t.state === "SKIPPED") continue;
        const d = dateOf(t);
        if (d > today) load.set(d, (load.get(d) ?? 0) + t.minutes);
      }
      return [...load].filter(([d, m]) => m > dayBudget(week[isoWeekday(d)] ?? { available: 0, newTarget: 0 }).available).length;
    };
    const open = tasks.filter((t) => t.state === "OPEN");
    const openNew = open.filter((t) => t.kind === "NEW");
    const last = (dateOf: (t: SchedTask) => ISODate) => openNew.map(dateOf).sort().at(-1) ?? null;
    const recallStates = await db.recallState.findMany({ where: { nextDueDate: { not: null } }, select: { stage: true, nextDueDate: true } });
    const outlook = forecast({
      today, planEnd: d2i(settings.journeyEnd), targetDate: settings.targetDate ? d2i(settings.targetDate) : null, week,
      remainingNewMinutes: openNew.reduce((a, t) => a + t.minutes, 0),
      recalls: recallStates.map((r) => ({ stage: r.stage, nextDueDate: d2i(r.nextDueDate!) })), recallMinutes: RULES.minutesPerReview, gapFor,
    });
    // Study days with new-material time but none planned, between tomorrow and the last open new material: time the
    // stage dates leave unused.
    const emptyDays = (dateOf: (t: SchedTask) => ISODate) => {
      const end = last(dateOf);
      if (!end) return 0;
      const busy = new Set(tasks.filter((t) => t.kind === "NEW" && t.state !== "SKIPPED").map(dateOf));
      let n = 0;
      for (let d = addDays(today, 1); d <= end; d = addDays(d, 1)) if ((week[isoWeekday(d)]?.newTarget ?? 0) > 0 && !busy.has(d)) n++;
      return n;
    };
    const shifts = moves.map((m) => diffDays(m.from, m.to));
    const overdue = open.filter((t) => t.date < today).length;

    report.push({
      city: city.name, today,
      week: Object.fromEntries(Object.entries(week).map(([d, w]) => [d, `${w.available}/${w.newTarget}`])),
      open: { newMaterial: openNew.length, recalls: open.length - openNew.length, overdue },
      moves: {
        total: moves.length,
        newMaterial: moves.filter((m) => byId.get(m.id)!.kind === "NEW").length,
        recalls: moves.filter((m) => byId.get(m.id)!.kind === "RECALL").length,
        later: shifts.filter((s) => s > 0).length,
        earlier: shifts.filter((s) => s < 0).length,
        largestShiftDays: shifts.length ? Math.max(...shifts.map(Math.abs)) : 0,
      },
      daysOverTime: { before: over((t) => t.date), after: over(after) },
      emptyStudyDays: { before: emptyDays((t) => t.date), after: emptyDays(after) },
      lastNewMaterialDay: { before: last((t) => t.date), after: last(after) },
      forecastFinish: outlook.projectedFinish,
      unplaced: unplaced.length,
      ...(missing.length ? { stagesWithoutPlan: missing } : {}),
      ...(exampleMoves ? { examples: moves.slice(0, exampleMoves).map((m) => ({ task: title.get(m.id), from: m.from, to: m.to })) } : {}),
    });
  }
} finally {
  await prisma.$disconnect();
}
console.log(JSON.stringify({ at: now.toISOString(), saved: false, cities: report }, null, 2));
