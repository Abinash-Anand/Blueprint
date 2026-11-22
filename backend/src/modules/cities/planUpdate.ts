/**
 * Brings an active city's plan in line with a newly approved curriculum version (docs/Scheduler-Phase2-Plan.md §2.5):
 * new topics get their tasks, topics with new hours are resized (domain/curriculumPlan.ts), and the scheduler then
 * places everything, recorded as a CURRICULUM change. One transaction, under the city's plan lock.
 */
import type { PrismaClient } from "@prisma/client";
import { d2i, i2d } from "../../db.js";
import { type ISODate, addDays } from "../../domain/dates.js";
import { curriculumPlan } from "../../domain/curriculumPlan.js";
import { BULK_TX, lockPlan, replanIn } from "../schedule/replan.js";
import type { CurriculumDocument } from "./contract.js";

export async function updatePlanForCurriculum(
  db: PrismaClient, cityId: string, prefix: string, prev: CurriculumDocument | null, doc: CurriculumDocument, today: ISODate,
) {
  const id = (k: string) => `${prefix}${k}`;
  const planned = new Set(Object.values(doc.queues).flat());
  const topics = new Map(doc.districts.flatMap((d) => d.topics).filter((t) => planned.has(t.key))
    .map((t) => [id(t.key), { slug: id(t.key), name: t.name, hours: t.hours, subtopics: t.subtopics, exercise: t.exercise }]));
  const queues = Object.fromEntries(Object.entries(doc.queues).map(([q, ks]) => [q, ks.map(id)]));
  const previousHours = new Map((prev?.districts ?? []).flatMap((d) => d.topics).map((t) => [id(t.key), t.hours]));

  return db.$transaction(async (tx) => {
    await lockPlan(tx, cityId);
    const [rows, stages] = await Promise.all([
      tx.task.findMany({
        where: { source: "PLAN", kind: { in: ["STUDY", "PRACTICE"] }, topicId: { not: null } },
        select: { id: true, topicId: true, kind: true, status: true, estimatedMinutes: true, originalDate: true, position: true, stageId: true },
      }),
      tx.stage.findMany({ select: { id: true, queue: true, startDate: true } }),
    ]);
    const plan = curriculumPlan({
      topics, queues, previousHours,
      tasks: rows.map((t) => ({
        id: t.id, topicId: t.topicId!, kind: t.kind as "STUDY" | "PRACTICE", status: t.status, minutes: t.estimatedMinutes,
        originalDate: d2i(t.originalDate), position: t.position, stageId: t.stageId,
      })),
      stages: stages.map((s) => ({ id: s.id, queue: s.queue || s.id, start: d2i(s.startDate) })),
    });

    if (plan.remove.length) await tx.task.deleteMany({ where: { id: { in: plan.remove }, status: "TODO" } });
    for (const r of plan.resize) await tx.task.updateMany({ where: { id: r.id, status: "TODO" }, data: { estimatedMinutes: r.minutes } });
    if (plan.create.length) {
      const subs = await tx.subtopic.findMany({ where: { topicId: { in: [...new Set(plan.create.map((t) => t.topicId))] } }, select: { id: true, topicId: true, position: true } });
      const subId = new Map(subs.map((s) => [`${s.topicId}#${s.position}`, s.id]));
      // In order, so ids rise in the order the tasks should follow each other.
      await tx.task.createMany({
        data: plan.create.map((t) => ({
          topicId: t.topicId, subtopicId: t.subtopicIndex === null ? null : (subId.get(`${t.topicId}#${t.subtopicIndex}`) ?? null),
          stageId: t.stageId, title: t.title, notes: t.notes, kind: t.kind, estimatedMinutes: t.minutes, source: "PLAN" as const,
          originalDate: i2d(t.originalDate), position: t.position,
          // Past or today: as carried-over work until the scheduler places it (it joins today only if today has time).
          scheduledDate: i2d(t.originalDate <= today ? addDays(today, -1) : t.originalDate),
        })),
      });
    }
    const r = await replanIn(tx, cityId, today, "CURRICULUM");
    return { created: plan.create.length, removed: plan.remove.length, resized: plan.resize.length, moved: r.moved };
  }, BULK_TX);
}
