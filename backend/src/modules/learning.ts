/**
 * Loads learner state per topic once and adapts it to the pure progress domain.
 * Shared by the curriculum, today and progress endpoints.
 */
import type { PrismaClient } from "@prisma/client";
import type { DistrictLearning, TopicLearning } from "../domain/progress.js";
import { d2i } from "../db.js";

export interface TopicAggregates {
  plannedMinutes: number;
  doneTasks: number;
  loggedMinutes: number;
  firstDate: string | null;
  lastDate: string | null;
}

export async function topicAggregates(prisma: PrismaClient): Promise<Map<string, TopicAggregates>> {
  const [planned, done, logged] = await Promise.all([
    prisma.task.groupBy({
      by: ["topicId"],
      where: { status: { not: "SKIPPED" }, topicId: { not: null } },
      _sum: { estimatedMinutes: true },
      _min: { scheduledDate: true },
      _max: { scheduledDate: true },
    }),
    prisma.task.groupBy({ by: ["topicId"], where: { status: "DONE", topicId: { not: null } }, _count: { _all: true } }),
    prisma.studySession.groupBy({ by: ["topicId"], where: { topicId: { not: null } }, _sum: { minutes: true } }),
  ]);
  const m = new Map<string, TopicAggregates>();
  const get = (id: string) => {
    let a = m.get(id);
    if (!a) m.set(id, (a = { plannedMinutes: 0, doneTasks: 0, loggedMinutes: 0, firstDate: null, lastDate: null }));
    return a;
  };
  for (const p of planned) {
    const a = get(p.topicId!);
    a.plannedMinutes = p._sum.estimatedMinutes ?? 0;
    a.firstDate = p._min.scheduledDate ? d2i(p._min.scheduledDate) : null;
    a.lastDate = p._max.scheduledDate ? d2i(p._max.scheduledDate) : null;
  }
  for (const d of done) get(d.topicId!).doneTasks = d._count._all;
  for (const l of logged) get(l.topicId!).loggedMinutes = l._sum.minutes ?? 0;
  return m;
}

export async function loadLearning(prisma: PrismaClient): Promise<{
  districts: DistrictLearning[];
  topicNames: Map<string, { name: string; districtId: string }>;
  subtopics: Map<string, { name: string; completedAt: Date | null }[]>;
}> {
  const [rows, agg] = await Promise.all([
    prisma.district.findMany({
      orderBy: { position: "asc" },
      include: {
        topics: {
          orderBy: { position: "asc" },
          include: { subtopics: { orderBy: { position: "asc" }, select: { name: true, completedAt: true } } },
        },
      },
    }),
    topicAggregates(prisma),
  ]);
  const topicNames = new Map<string, { name: string; districtId: string }>();
  const subtopics = new Map<string, { name: string; completedAt: Date | null }[]>();
  const districts = rows.map((d) => ({
    id: d.id,
    topics: d.topics.map((t): TopicLearning => {
      topicNames.set(t.id, { name: t.name, districtId: d.id });
      subtopics.set(t.id, t.subtopics);
      const a = agg.get(t.id);
      return {
        id: t.id,
        priority: t.priority,
        estimatedHours: t.estimatedHours,
        subtopicsTotal: t.subtopics.length,
        subtopicsLearned: t.subtopics.filter((s) => s.completedAt).length,
        demonstrated: t.demonstratedAt !== null,
        doneTasks: a?.doneTasks ?? 0,
        loggedMinutes: a?.loggedMinutes ?? 0,
      };
    }),
  }));
  return { districts, topicNames, subtopics };
}
