/**
 * Recall tasks (docs/Recall-Plan.md, the planned workflow): every sub-topic in recall has one open task, due on its
 * next due date. The scheduler (docs/Scheduler-Phase2-Plan.md) decides its day: on or after the due date, in the day's
 * revision time, borrowing at most half of its new-material time, never on a rest day. A task is completed by its
 * recall being checked, never by ticking; when the due date changes the task is replaced.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { d2i, i2d } from "../../db.js";
import type { ISODate } from "../../domain/dates.js";
import { BULK_TX, replanIn } from "../schedule/replan.js";
import { RULES } from "./rules.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** Minutes a recall task plans into its day. */
export const RECALL_TASK_MINUTES = RULES.minutesPerReview;
/** After the learning tasks of the day. */
const POSITION = 1000;

/**
 * Brings the plan in line with the recall schedule (city-scoped client). Idempotent. Drops open tasks whose due date no
 * longer matches, adds one for each sub-topic now due without one, then re-plans from tomorrow (today's tasks stay), so
 * recalls and the new material they borrow time from fit together. Returns how many tasks it added. Works in the
 * caller's transaction, or its own.
 */
export async function syncRecallTasks(db: Db, today: ISODate): Promise<number> {
  if ("$transaction" in db) return db.$transaction((tx) => syncRecallTasks(tx, today), BULK_TX);
  const tx = db;
  const settings = await tx.settings.findFirst({ select: { cityId: true } });
  if (!settings) return 0;
  const states = await tx.recallState.findMany({
    include: { subtopic: { select: { id: true, name: true, topicId: true } }, tasks: { where: { status: "TODO" }, select: { id: true, originalDate: true } } },
    orderBy: [{ nextDueDate: "asc" }, { subtopicId: "asc" }],
  });
  let added = 0;
  for (const s of states) {
    const due = s.nextDueDate ? d2i(s.nextDueDate) : null;
    const keep = s.tasks.find((t) => due !== null && d2i(t.originalDate) === due);
    const stale = s.tasks.filter((t) => t !== keep).map((t) => t.id);
    if (stale.length) await tx.task.deleteMany({ where: { id: { in: stale } } });
    if (due === null || keep) continue;
    await tx.task.create({
      data: {
        title: `Recall: ${s.subtopic.name}`, kind: "REVISION", source: "REVISION", estimatedMinutes: RECALL_TASK_MINUTES,
        topicId: s.subtopic.topicId, subtopicId: s.subtopic.id, recallStateId: s.id,
        // On its due date for now (today when overdue); the scheduler below gives it its day.
        originalDate: i2d(due), scheduledDate: i2d(due < today ? today : due), position: POSITION,
      },
    });
    added++;
  }
  await replanIn(tx, settings.cityId, today, "RECALL");
  return added;
}

/**
 * The sub-topic's open recall task is done: its recall was checked today (an early recall moves it to today).
 * Returns the completed task's id (the earliest open one), or null when none was open.
 */
export async function completeRecallTask(db: Db, recallStateId: number, today: ISODate, at: Date): Promise<number | null> {
  const open = await db.task.findMany({ where: { recallStateId, status: "TODO" }, select: { id: true }, orderBy: [{ originalDate: "asc" }, { id: "asc" }] });
  if (!open.length) return null;
  await db.task.updateMany({
    where: { id: { in: open.map((t) => t.id) } },
    data: { status: "DONE", completedAt: at, scheduledDate: i2d(today) },
  });
  return open[0].id;
}
