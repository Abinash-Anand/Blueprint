import { Prisma, type PrismaClient } from "@prisma/client";
import { subtopicPresentation, topicPresentation } from "../../domain/presentation.js";
import { topicStatus } from "../../domain/progress.js";
import type { Clock } from "../../lib/clock.js";
import { notFound } from "../../lib/http.js";
import { type TopicAggregates, topicAggregates } from "../learning.js";
import { planOpenRevisions, syncTopic } from "../revision/service.js";
import { stageDTO, stageInclude } from "../schedule/service.js";

const topicInclude = {
  subtopics: { orderBy: { position: "asc" as const } },
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
      // Learned status is the learner's explicit action; revision eligibility follows it (REV-02).
      const u = await prisma.$transaction(async (tx) => {
        const row = await tx.subtopic.update({ where: { id }, data: { completedAt } });
        await syncTopic(tx, row.topicId, clock.now());
        await planOpenRevisions(tx, clock.today());
        return row;
      });
      return { id: u.id, topicId: u.topicId, completedAt: u.completedAt?.toISOString() ?? null };
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
      await prisma.$transaction(async (tx) => {
        await tx.topic.update({ where: { id }, data });
        if (body.demonstrated !== undefined) {
          await syncTopic(tx, id, clock.now());
          await planOpenRevisions(tx, clock.today());
        }
      });
      return this.getTopic(id);
    },
  };
}

