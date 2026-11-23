import { Prisma, type PrismaClient } from "@prisma/client";
import { d2i, i2d } from "../../db.js";
import { subtopicPresentation, topicPresentation } from "../../domain/presentation.js";
import { topicStatus } from "../../domain/progress.js";
import type { Clock } from "../../lib/clock.js";
import { notFound } from "../../lib/http.js";
import { type TopicAggregates, topicAggregates } from "../learning.js";
import { syncRecallState } from "../recall/service.js";
import { syncRecallTasks } from "../recall/tasks.js";
import { BULK_TX } from "../schedule/replan.js";
import { stageDTO, stageInclude } from "../schedule/service.js";

const topicInclude = {
  subtopics: {
    orderBy: { position: "asc" as const },
    // Recall (docs/Recall-Plan.md): when it is next due, and how the last check went.
    include: {
      recallState: { select: { nextDueDate: true, stage: true } },
      recallReviews: { where: { status: { in: ["CHECKED" as const, "COMPLETE" as const] } }, orderBy: [{ date: "desc" as const }, { id: "desc" as const }], take: 1, select: { date: true, score: true, depth: true, outcome: true } },
    },
  },
  resources: { orderBy: { position: "asc" as const } },
  dependsOn: { select: { dependsOnId: true } },
} satisfies Prisma.TopicInclude;

type TopicRow = Prisma.TopicGetPayload<{ include: typeof topicInclude }>;

export function topicDTO(t: TopicRow, agg?: TopicAggregates) {
  const learned = t.subtopics.filter((s) => s.completedAt).length;
  const status = topicStatus({
    id: t.id, priority: t.priority, estimatedHours: t.estimatedHours,
    subtopicsTotal: t.subtopics.length, subtopicsLearned: learned, demonstrated: !!t.demonstratedAt,
    doneTasks: agg?.doneTasks ?? 0, loggedMinutes: agg?.loggedMinutes ?? 0,
  });
  return {
    id: t.id,
    districtId: t.districtId,
    position: t.position,
    name: t.name,
    description: t.description,
    priority: t.priority,
    estimatedHours: t.estimatedHours,
    exercise: t.exercise,
    status,
    presentation: topicPresentation(status, t.needsReview),
    demonstratedAt: t.demonstratedAt?.toISOString() ?? null,
    demonstrationNote: t.demonstrationNote,
    needsReview: t.needsReview,
    subtopics: t.subtopics.map((s) => ({
      id: s.id, position: s.position, name: s.name, completedAt: s.completedAt?.toISOString() ?? null, presentation: subtopicPresentation(!!s.completedAt),
      recall: s.recallState?.nextDueDate || s.recallReviews[0]
        ? {
            nextDueDate: s.recallState?.nextDueDate ? d2i(s.recallState.nextDueDate) : null,
            stage: s.recallState?.stage ?? 0,
            last: s.recallReviews[0] ? { date: d2i(s.recallReviews[0].date), score: s.recallReviews[0].score!, depth: s.recallReviews[0].depth!, outcome: s.recallReviews[0].outcome ?? null } : null,
          }
        : null,
    })),
    resources: t.resources.map((r) => ({ label: r.label, url: r.url, kind: r.kind })),
    dependsOn: t.dependsOn.map((d) => d.dependsOnId),
    plannedMinutes: agg?.plannedMinutes ?? 0,
    loggedMinutes: agg?.loggedMinutes ?? 0,
    firstDate: agg?.firstDate ?? null,
    lastDate: agg?.lastDate ?? null,
  };
}

export function curriculumService(prisma: PrismaClient, clock: Clock) {
  return {
    async getCurriculum() {
      const [districts, stages, agg] = await Promise.all([
        prisma.district.findMany({
          orderBy: { position: "asc" },
          include: { topics: { orderBy: { position: "asc" }, include: topicInclude } },
        }),
        prisma.stage.findMany({ orderBy: { position: "asc" }, include: stageInclude }),
        topicAggregates(prisma),
      ]);
      return {
        districts: districts.map(({ topics, ...d }) => ({
          ...d,
          topics: topics.map((t) => topicDTO(t, agg.get(t.id))),
        })),
        stages: stages.map(stageDTO),
      };
    },

    async getTopic(id: string) {
      const t = await prisma.topic.findUnique({ where: { id }, include: topicInclude });
      if (!t) throw notFound("Topic");
      const agg = await topicAggregates(prisma);
      return topicDTO(t, agg.get(id));
    },

    async setSubtopic(id: number, completed: boolean) {
      const s = await prisma.subtopic.findUnique({ where: { id } });
      if (!s) throw notFound("Subtopic");
      // Keep the original timestamp when ticking an already-ticked sub-topic.
      const completedAt = completed ? (s.completedAt ?? clock.now()) : null;
      // Learned status is the learner's explicit action; recall follows it (docs/Recall-Plan.md §3.1).
      const u = await prisma.$transaction(async (tx) => {
        const row = await tx.subtopic.update({ where: { id }, data: { completedAt } });
        // Learned means there is nothing left to study: its open study tasks are done (today, if they were planned
        // later). Practice tasks stay open: they ask for the exercise. Unticking reopens nothing.
        let studyDone = 0;
        if (completed && !s.completedAt) {
          const today = clock.today(), now = clock.now();
          const open = { subtopicId: id, kind: "STUDY" as const, status: "TODO" as const };
          studyDone += (await tx.task.updateMany({ where: { ...open, scheduledDate: { gt: i2d(today) } }, data: { status: "DONE", completedAt: now, scheduledDate: i2d(today) } })).count;
          studyDone += (await tx.task.updateMany({ where: open, data: { status: "DONE", completedAt: now } })).count;
        }
        await syncRecallState(tx, id, completedAt !== null, clock.today());
        await syncRecallTasks(tx, clock.today());
        const recall = await tx.recallState.findUnique({ where: { subtopicId: id }, select: { nextDueDate: true } });
        return { row, studyDone, recallDue: recall?.nextDueDate ? d2i(recall.nextDueDate) : null };
      }, BULK_TX); // adding the recall task re-plans the city: longer than the 5 s default on a slow server
      // When the sub-topic is next due for recall, so the learner sees it was scheduled; and how many study tasks it closed.
      return { id: u.row.id, topicId: u.row.topicId, completedAt: u.row.completedAt?.toISOString() ?? null, recallDue: u.recallDue, studyTasksDone: u.studyDone };
    },

    async patchTopic(id: string, body: { demonstrated?: boolean; demonstrationNote?: string; needsReview?: boolean }) {
      const t = await prisma.topic.findUnique({ where: { id } });
      if (!t) throw notFound("Topic");
      const data: { demonstratedAt?: Date | null; demonstrationNote?: string | null; needsReview?: boolean } = {};
      if (body.demonstrated !== undefined) {
        data.demonstratedAt = body.demonstrated ? (t.demonstratedAt ?? clock.now()) : null;
        if (!body.demonstrated) data.demonstrationNote = null;
      }
      if (body.demonstrationNote !== undefined) data.demonstrationNote = body.demonstrationNote.trim() || null;
      if (body.needsReview !== undefined) data.needsReview = body.needsReview;
      await prisma.topic.update({ where: { id }, data });
      return this.getTopic(id);
    },
  };
}

