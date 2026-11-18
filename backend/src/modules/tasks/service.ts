import type { Prisma, PrismaClient, TaskKind, TaskStatus } from "@prisma/client";
import { d2i, i2d } from "../../db.js";
import { placeOverdue } from "../../domain/reschedule.js";
import type { Clock } from "../../lib/clock.js";
import { HttpError, notFound } from "../../lib/http.js";
import { replaceOverdueRevisions } from "../revision/service.js";
import { loadTargets } from "../schedule/service.js";
import { taskDTO, taskInclude, taskOrder } from "./mapper.js";

export interface TaskFilter {
  from?: string;
  to?: string;
  status?: TaskStatus;
  topicId?: string;
}

export interface NewTask {
  title: string;
  scheduledDate: string;
  estimatedMinutes: number;
  kind?: TaskKind;
  topicId?: string;
  subtopicId?: number;
  notes?: string;
}

export interface TaskPatch {
  title?: string;
  notes?: string;
  estimatedMinutes?: number;
  scheduledDate?: string;
  status?: TaskStatus;
}

/** Bulk moves can touch hundreds of rows after a long break; allow more than Prisma's 5 s default. */
const BULK_TX = { maxWait: 10_000, timeout: 60_000 };

export function taskService(prisma: PrismaClient, clock: Clock) {
  const one = async (id: number) => {
    const t = await prisma.task.findUnique({ where: { id }, include: taskInclude });
    if (!t) throw notFound("Task");
    return taskDTO(t, clock.today());
  };

  return {
    get: one,

    async list(f: TaskFilter) {
      const where: Prisma.TaskWhereInput = {};
      if (f.from || f.to) where.scheduledDate = { ...(f.from && { gte: i2d(f.from) }), ...(f.to && { lte: i2d(f.to) }) };
      if (f.status) where.status = f.status;
      if (f.topicId) where.topicId = f.topicId;
      const rows = await prisma.task.findMany({ where, include: taskInclude, orderBy: taskOrder });
      return rows.map((t) => taskDTO(t, clock.today()));
    },

    async create(b: NewTask) {
      if (b.topicId && !(await prisma.topic.findUnique({ where: { id: b.topicId } }))) throw notFound("Topic");
      if (b.subtopicId) {
        const s = await prisma.subtopic.findUnique({ where: { id: b.subtopicId } });
        if (!s) throw notFound("Subtopic");
        if (b.topicId && s.topicId !== b.topicId) throw new HttpError(400, "VALIDATION_ERROR", "subtopicId does not belong to topicId");
        b.topicId ??= s.topicId;
      }
      const date = i2d(b.scheduledDate);
      const position = await prisma.task.count({ where: { scheduledDate: date } });
      const t = await prisma.task.create({
        data: {
          title: b.title,
          notes: b.notes ?? "",
          kind: b.kind ?? "STUDY",
          estimatedMinutes: b.estimatedMinutes,
          originalDate: date,
          scheduledDate: date,
          position,
          source: "MANUAL",
          topicId: b.topicId ?? null,
          subtopicId: b.subtopicId ?? null,
        },
        include: taskInclude,
      });
      return taskDTO(t, clock.today());
    },

    async patch(id: number, p: TaskPatch) {
      const t = await prisma.task.findUnique({ where: { id } });
      if (!t) throw notFound("Task");
      const data: Prisma.TaskUpdateInput = {};
      if (p.title !== undefined) data.title = p.title;
      if (p.notes !== undefined) data.notes = p.notes;
      if (p.estimatedMinutes !== undefined) data.estimatedMinutes = p.estimatedMinutes;
      if (p.scheduledDate !== undefined && p.scheduledDate !== d2i(t.scheduledDate)) {
        // FR-CAL-06: the original date is kept; only the scheduled date moves.
        data.scheduledDate = i2d(p.scheduledDate);
        data.rescheduleCount = { increment: 1 };
      }
      if (t.revisionScheduleId && p.status === "DONE" && t.status !== "DONE")
        throw new HttpError(409, "ATTEMPT_REQUIRED", "A revision is completed by recording a recall attempt, not by ticking it.");
      if (t.revisionScheduleId && p.status === "SKIPPED")
        throw new HttpError(409, "REVISION_NOT_SKIPPABLE", "A revision stays due until you attempt it. Move it to another day instead.");
      if (p.status !== undefined && p.status !== t.status) {
        data.status = p.status;
        data.completedAt = p.status === "DONE" ? clock.now() : null;
      }
      await prisma.task.update({ where: { id }, data });
      return one(id);
    },

    async remove(id: number) {
      const t = await prisma.task.findUnique({ where: { id } });
      if (!t) throw notFound("Task");
      if (t.source === "PLAN")
        throw new HttpError(409, "PLAN_TASK_NOT_DELETABLE", "Planned tasks cannot be deleted. Mark it as skipped instead.");
      if (t.source === "REVISION")
        throw new HttpError(409, "REVISION_TASK_NOT_DELETABLE", "Revision tasks follow the revision schedule. Move it to another day instead.");
      await prisma.task.delete({ where: { id } });
    },

    /** FR-TODAY-10: move every overdue task forward, in one transaction. */
    async rescheduleOverdue() {
      const today = clock.today();
      const targets = await loadTargets(prisma);
      return prisma.$transaction(async (tx) => {
        // Learning tasks first (oldest first, within the daily target); then revisions by priority within their allowance.
        const overdue = await tx.task.findMany({
          where: { status: "TODO", scheduledDate: { lt: i2d(today) }, revisionScheduleId: null },
          select: { id: true, estimatedMinutes: true, scheduledDate: true, originalDate: true, position: true },
        });
        if (overdue.length === 0) return { moved: await replaceOverdueRevisions(tx, today) };
        const future = await tx.task.groupBy({
          by: ["scheduledDate"],
          where: { status: { not: "SKIPPED" }, scheduledDate: { gte: i2d(today) } },
          _sum: { estimatedMinutes: true },
        });
        const load = new Map(future.map((f) => [d2i(f.scheduledDate), f._sum.estimatedMinutes ?? 0]));
        const moves = placeOverdue(
          overdue.map((o) => ({
            id: o.id, minutes: o.estimatedMinutes, scheduledDate: d2i(o.scheduledDate),
            originalDate: d2i(o.originalDate), position: o.position,
          })),
          load,
          targets,
          today,
        );
        for (const m of moves) {
          await tx.task.update({ where: { id: m.id }, data: { scheduledDate: i2d(m.to), rescheduleCount: { increment: 1 } } });
        }
        return { moved: [...moves, ...(await replaceOverdueRevisions(tx, today))] };
      }, BULK_TX);
    },
  };
}
