import type { Prisma } from "@prisma/client";
import { type ISODate, diffDays } from "../../domain/dates.js";
import { d2i } from "../../db.js";
import { revisionPresentation, taskPresentation } from "../../domain/presentation.js";
import { REVISION_POLICY, isWeak } from "../../domain/revision.js";

export const taskInclude = {
  topic: { select: { id: true, name: true, districtId: true } },
  subtopic: { select: { id: true, name: true, completedAt: true } },
  sessions: { select: { minutes: true } },
  revisionSchedule: { select: { id: true, scope: true, consecutiveFailures: true, correctionPending: true, lastScore: true } },
  recallState: { select: { id: true, stage: true, lastReviewDate: true } },
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
  const overdueDays = t.status === "TODO" && scheduled < today ? diffDays(scheduled, today) : 0;
  const due = d2i(t.originalDate);
  const weak = t.revisionSchedule ? isWeak(t.revisionSchedule, REVISION_POLICY) : false;
  const correctionPending = t.revisionSchedule?.correctionPending ?? false;
  return {
    id: t.id,
    // Revision tasks are named after their unit as it is now, so a curriculum rename never leaves a stale title.
    title: t.revisionSchedule
      ? `Revise: ${t.revisionSchedule.scope === "TOPIC" ? `${t.topic?.name ?? ""} (whole topic)` : (t.subtopic?.name ?? t.title.replace(/^Revise: /, ""))}`
      : t.recallState
        ? `Recall: ${t.subtopic?.name ?? t.title.replace(/^Recall: /, "")}`
        : t.title,
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
    overdueDays,
    presentation: taskPresentation({ status: t.status, overdueDays }),
    topic: t.topic,
    subtopic: t.subtopic ? { id: t.subtopic.id, name: t.subtopic.name, completed: t.subtopic.completedAt !== null } : null,
    stageId: t.stageId,
    // Revision tasks: the original date is the due date, so lateness survives any move (REV-18).
    revision: t.revisionSchedule
      ? {
          scheduleId: t.revisionSchedule.id,
          scope: t.revisionSchedule.scope,
          weak,
          correctionPending,
          lastScore: t.revisionSchedule.lastScore,
          dueDate: due,
          overdueDays: t.status === "TODO" && due < today ? diffDays(due, today) : 0,
          presentation: revisionPresentation({ correctionPending: correctionPending && t.status !== "DONE", nextDueDate: due, completed: t.status === "DONE", weak }, today),
        }
      : null,
    // Recall tasks (docs/Recall-Plan.md): done by checking the recall; the original date is the due date.
    recall: t.recallState
      ? {
          stateId: t.recallState.id,
          stage: t.recallState.stage,
          lastReviewDate: t.recallState.lastReviewDate ? d2i(t.recallState.lastReviewDate) : null,
          dueDate: due,
          overdueDays: t.status === "TODO" && due < today ? diffDays(due, today) : 0,
          presentation: revisionPresentation({ correctionPending: false, nextDueDate: due, completed: t.status === "DONE", weak: false }, today),
        }
      : null,
  };
}
export type TaskDTO = ReturnType<typeof taskDTO>;
