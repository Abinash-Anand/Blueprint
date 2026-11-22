import type { Prisma, PrismaClient, TaskKind, TaskStatus } from "@prisma/client";
import { d2i, i2d } from "../../db.js";
import type { Clock } from "../../lib/clock.js";
import { HttpError, notFound } from "../../lib/http.js";
import { BULK_TX, replanIn } from "../schedule/replan.js";
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
  /** false: the scheduler may move it again. A move by hand pins it. */
  pinned?: boolean;
}


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
        // Moved by hand: the scheduler leaves it there until it is unpinned.
        data.pinnedAt = clock.now();
      } else if (p.pinned === false) data.pinnedAt = null;
      // A revision task's status follows its recall (checked → done): it cannot be ticked, skipped or reopened by hand.
      if (t.source === "REVISION" && p.status !== undefined && p.status !== t.status) {
        if (p.status === "DONE")
          throw new HttpError(409, "ATTEMPT_REQUIRED", "A revision is completed by checking your recall (Revise), not by ticking it.");
        if (p.status === "SKIPPED")
          throw new HttpError(409, "REVISION_NOT_SKIPPABLE", "A revision stays due until you recall it. Move it to another day instead.");
        throw new HttpError(409, "REVISION_RECORDED", "This revision is done and stays in the history.");
      }
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

    /**
     * FR-TODAY-10, now the scheduler: overdue work (and everything after it) is placed again from today, within the
     * learner's time. The same happens on its own at the start of each day.
     */
    async rescheduleOverdue() {
      const city = await prisma.settings.findFirst({ select: { cityId: true } });
      if (!city) return { moved: [] };
      const r = await prisma.$transaction((tx) => replanIn(tx, city.cityId, clock.today(), "OVERDUE"), BULK_TX);
      return { moved: r.moves };
    },
  };
}
