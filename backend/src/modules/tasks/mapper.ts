import type { Prisma } from "@prisma/client";
import { type ISODate, diffDays } from "../../domain/dates.js";
import { d2i } from "../../db.js";

export const taskInclude = {
  topic: { select: { id: true, name: true, districtId: true } },
  subtopic: { select: { id: true, name: true, completedAt: true } },
  sessions: { select: { minutes: true } },
} satisfies Prisma.TaskInclude;

export type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export const taskOrder: Prisma.TaskOrderByWithRelationInput[] = [
  { scheduledDate: "asc" },
  { originalDate: "asc" },
  { position: "asc" },
  { id: "asc" },
];

export function taskDTO(t: TaskRow, today: ISODate) {
  const scheduled = d2i(t.scheduledDate);
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    kind: t.kind,
    status: t.status,
    source: t.source,
    estimatedMinutes: t.estimatedMinutes,
    loggedMinutes: t.sessions.reduce((a, s) => a + s.minutes, 0),
    originalDate: d2i(t.originalDate),
    scheduledDate: scheduled,
    rescheduleCount: t.rescheduleCount,
    completedAt: t.completedAt?.toISOString() ?? null,
    overdueDays: t.status === "TODO" && scheduled < today ? diffDays(scheduled, today) : 0,
    topic: t.topic,
    subtopic: t.subtopic ? { id: t.subtopic.id, name: t.subtopic.name, completed: t.subtopic.completedAt !== null } : null,
    stageId: t.stageId,
  };
}
export type TaskDTO = ReturnType<typeof taskDTO>;
