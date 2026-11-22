/**
 * Re-planning a city (docs/Scheduler-Phase2-Plan.md, step 3): loads its tasks and time, runs the pure scheduler
 * (domain/scheduler.ts), and writes only the dates that change. Every run holds a per-city Postgres advisory lock for its
 * transaction, so two requests (or two server instances) never re-plan one city at once.
 *
 * What may move: open plan tasks (study and practice) and open recall tasks. What never moves: finished or skipped
 * tasks, the learner's own tasks, tasks moved by hand (pinned), and the old revision system's tasks.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { RequestHandler } from "express";
import { d2i, i2d } from "../../db.js";
import type { ISODate } from "../../domain/dates.js";
import { type SchedStage, type SchedTask, replan } from "../../domain/scheduler.js";
import type { Clock } from "../../lib/clock.js";
import { loadWeek } from "./service.js";

type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

/** Why a re-plan ran (PlanChange.reason). RECALL runs (a recall's due date changed) are not recorded: too frequent to notice. */
export type ReplanReason = "DAILY" | "AVAILABILITY" | "STAGES" | "OVERDUE" | "RECALL" | "CURRICULUM";

/** Bulk moves can touch hundreds of rows; allow more than Prisma's 5 s default. */
export const BULK_TX = { maxWait: 10_000, timeout: 60_000 };
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

/** Holds the city's plan lock until the transaction ends. */
export async function lockPlan(tx: Tx, cityId: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`plan:${cityId}`}))`;
}

/** The scheduler's view of a city: its week, stages and tasks. */
async function loadInput(db: Db, today: ISODate) {
  const [week, stageRows, rows] = await Promise.all([
    loadWeek(db),
    db.stage.findMany({ select: { id: true, kind: true, startDate: true, endDate: true, weekdays: true, queue: true } }),
    db.task.findMany({
      select: {
        id: true, kind: true, source: true, status: true, estimatedMinutes: true, scheduledDate: true, originalDate: true, position: true,
        stageId: true, recallStateId: true, pinnedAt: true,
      },
    }),
  ]);
  // A stage whose weekdays are not recorded yet (filled from the curriculum on start-up) studies on any day with time,
  // and never claims days from the others as a parallel stage would.
  const stages: SchedStage[] = stageRows.map((s) => ({
    id: s.id, kind: s.weekdays.length ? s.kind : "MAIN", start: d2i(s.startDate), end: d2i(s.endDate),
    weekdays: s.weekdays.length ? s.weekdays : EVERY_DAY, queue: s.queue || s.id,
  }));
  const tasks: SchedTask[] = rows.map((t) => {
    const recall = t.kind === "REVISION";
    const fixed = t.status === "DONE" || t.source === "MANUAL" || t.pinnedAt !== null || (recall && t.recallStateId === null);
    return {
      id: t.id, kind: recall ? "RECALL" : "NEW", state: t.status === "SKIPPED" ? "SKIPPED" : fixed ? "FIXED" : "OPEN",
      minutes: t.estimatedMinutes, date: d2i(t.scheduledDate), originalDate: d2i(t.originalDate), position: t.position, stageId: t.stageId,
    };
  });
  return { today, week, stages, tasks };
}

/** The last day with open new material: the plan's projected finish. Null when none is left. */
export async function plannedFinish(db: Db): Promise<ISODate | null> {
  const last = await db.task.findFirst({
    where: { status: "TODO", kind: { not: "REVISION" } }, orderBy: { scheduledDate: "desc" }, select: { scheduledDate: true },
  });
  return last ? d2i(last.scheduledDate) : null;
}

/**
 * Re-plans inside an open transaction (the caller's): takes the lock, moves what the scheduler moves, and records the
 * change when anything moved. Today's open tasks never move, so no re-plan reshuffles the day the learner is in.
 */
export async function replanIn(tx: Tx, cityId: string, today: ISODate, reason: ReplanReason) {
  await lockPlan(tx, cityId);
  const finishBefore = await plannedFinish(tx);
  const { moves, unplaced } = replan(await loadInput(tx, today));
  const byDay = new Map<ISODate, number[]>();
  for (const m of moves) byDay.set(m.to, [...(byDay.get(m.to) ?? []), m.id]);
  for (const [day, ids] of byDay) {
    await tx.task.updateMany({ where: { id: { in: ids } }, data: { scheduledDate: i2d(day), rescheduleCount: { increment: 1 } } });
  }
  const finishAfter = moves.length ? await plannedFinish(tx) : finishBefore;
  if (moves.length && reason !== "RECALL") {
    await tx.planChange.create({
      data: { cityId, reason, moved: moves.length, finishBefore: finishBefore ? i2d(finishBefore) : null, finishAfter: finishAfter ? i2d(finishAfter) : null },
    });
  }
  return { moved: moves.length, moves, unplaced: unplaced.length, finishBefore, finishAfter };
}

/** Re-plans a city in a transaction of its own. */
export function replanCity(db: PrismaClient, cityId: string, today: ISODate, reason: ReplanReason) {
  return db.$transaction((tx) => replanIn(tx, cityId, today, reason), BULK_TX);
}

/**
 * Once a day per city: missed work and overdue recalls are placed again from the new day. The first request of the
 * day does it; the date is checked again under the lock, so a second request at the same moment does nothing twice.
 */
export async function replanForNewDay(db: PrismaClient, cityId: string, today: ISODate) {
  const s = await db.settings.findFirst({ select: { replannedFor: true } });
  if (!s || (s.replannedFor && d2i(s.replannedFor) >= today)) return null;
  return db.$transaction(async (tx) => {
    await lockPlan(tx, cityId);
    const again = await tx.settings.findFirst({ select: { replannedFor: true } });
    if (again?.replannedFor && d2i(again.replannedFor) >= today) return null;
    const r = await replanIn(tx, cityId, today, "DAILY");
    await tx.settings.updateMany({ data: { replannedFor: i2d(today) } });
    return r;
  }, BULK_TX);
}

/** Middleware after requireCity: the day's re-plan before the request reads the plan. Never fails the request. */
export const dailyReplan = (clock: Clock): RequestHandler => async (req, _res, next) => {
  if (req.city && req.city.status !== "ARCHIVED") {
    try {
      const r = await replanForNewDay(req.db, req.city.id, clock.today());
      if (r?.moved) console.log(JSON.stringify({ level: "info", msg: "Plan re-planned for a new day", moved: r.moved }));
    } catch (e) {
      console.warn(JSON.stringify({ level: "warn", msg: "Daily re-plan failed", error: String((e as Error)?.message ?? e).slice(0, 200) }));
    }
  }
  next();
};
