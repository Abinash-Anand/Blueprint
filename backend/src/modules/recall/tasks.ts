/**
 * Recall tasks (docs/Recall-Plan.md, the planned workflow): every sub-topic in recall has one open task in the plan,
 * on its due date, up to the daily limit (the rest move to the next day; rest days are skipped), like the earlier
 * revision tasks. A task is completed by its recall being checked, never by ticking; when the date changes the task
 * is planned again. Overdue tasks stay open and are carried over on Today until recalled.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { d2i, i2d } from "../../db.js";
import { type ISODate, addDays, isoWeekday } from "../../domain/dates.js";
import { loadTargets } from "../schedule/service.js";
import { RULES, dailyLimit } from "./rules.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** Minutes a recall task plans into its day. */
export const RECALL_TASK_MINUTES = RULES.minutesPerReview;
/** After the learning tasks of the day. */
const POSITION = 1000;

/** Brings the plan in line with the recall schedule (city-scoped client). Idempotent. */
export async function syncRecallTasks(db: Db, today: ISODate) {
  const [states, settings, targets] = await Promise.all([
    db.recallState.findMany({
      include: { subtopic: { select: { id: true, name: true, topicId: true } }, tasks: { where: { status: "TODO" }, select: { id: true, originalDate: true } } },
      orderBy: [{ nextDueDate: "asc" }, { subtopicId: "asc" }],
    }),
    db.settings.findFirst({ select: { revisionDailyMinutes: true } }),
    loadTargets(db),
  ]);
  // Rest days (no study target, e.g. Sunday) get no recall: it moves to the next study day. With no study day at all, any day.
  const studyDay = (day: ISODate) => (targets[isoWeekday(day)] ?? 0) > 0 || Object.values(targets).every((m) => !m);
  const limit = dailyLimit(settings?.revisionDailyMinutes ?? 30);

  // Drop open tasks that no longer match their sub-topic's date (unticked, recalled early, postponed).
  const place: typeof states = [];
  for (const s of states) {
    const due = s.nextDueDate ? d2i(s.nextDueDate) : null;
    const keep = s.tasks.find((t) => due !== null && d2i(t.originalDate) === due);
    const stale = s.tasks.filter((t) => t !== keep).map((t) => t.id);
    if (stale.length) await db.task.deleteMany({ where: { id: { in: stale } } });
    if (due !== null && !keep) place.push(s);
  }
  if (!place.length) return 0;

  // Recall tasks already in each day from today on (done ones count: the limit is per day).
  const planned = await db.task.groupBy({
    by: ["scheduledDate"],
    where: { recallStateId: { not: null }, status: { not: "SKIPPED" }, scheduledDate: { gte: i2d(today) } },
    _count: { _all: true },
  });
  const load = new Map(planned.map((p) => [d2i(p.scheduledDate), p._count._all]));
  for (const s of place) {
    const due = d2i(s.nextDueDate!);
    let day = due < today ? today : due;
    while (!studyDay(day) || (load.get(day) ?? 0) >= limit) day = addDays(day, 1);
    load.set(day, (load.get(day) ?? 0) + 1);
    await db.task.create({
      data: {
        title: `Recall: ${s.subtopic.name}`, kind: "REVISION", source: "REVISION", estimatedMinutes: RECALL_TASK_MINUTES,
        topicId: s.subtopic.topicId, subtopicId: s.subtopic.id, recallStateId: s.id,
        originalDate: i2d(due), scheduledDate: i2d(day), position: POSITION,
      },
    });
  }
  return place.length;
}

/** The sub-topic's open recall task is done: its recall was checked today (an early recall moves it to today). */
export async function completeRecallTask(db: Db, recallStateId: number, today: ISODate, at: Date) {
  await db.task.updateMany({
    where: { recallStateId, status: "TODO" },
    data: { status: "DONE", completedAt: at, scheduledDate: i2d(today) },
  });
}
