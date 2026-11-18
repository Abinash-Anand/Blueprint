/**
 * Idempotent seed (LLD §3.2):
 *  - upserts the curriculum by slug, never overwriting learner-owned fields;
 *  - creates stages, settings and weekly targets only if missing (dates stay editable);
 *  - generates the plan once, only when no PLAN tasks exist.
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_TARGETS, JOURNEY, districts, queues, stages } from "../src/curriculum/index.js";
import { buildPlan } from "../src/domain/planner.js";
import { toDate } from "../src/domain/dates.js";

export async function seed(prisma: PrismaClient, log = console.log) {
  // 1. Curriculum
  for (const [di, d] of districts.entries()) {
    const district = { position: di, name: d.name, subtitle: d.subtitle, layer: d.layer, color: d.color, cols: d.cols, goal: d.goal, note: d.note };
    await prisma.district.upsert({ where: { id: d.slug }, update: district, create: { id: d.slug, ...district } });

    for (const [ti, t] of d.topics.entries()) {
      const topic = { districtId: d.slug, position: ti, name: t.name, description: t.description, priority: t.priority, estimatedHours: t.hours, exercise: t.exercise };
      await prisma.topic.upsert({ where: { id: t.slug }, update: topic, create: { id: t.slug, ...topic } });

      for (const [si, name] of t.subtopics.entries()) {
        await prisma.subtopic.upsert({
          where: { topicId_position: { topicId: t.slug, position: si } },
          update: { name },
          create: { topicId: t.slug, position: si, name },
        });
      }
      // Remove sub-topics that no longer exist, but never ones the learner has ticked.
      await prisma.subtopic.deleteMany({ where: { topicId: t.slug, position: { gte: t.subtopics.length }, completedAt: null } });

      await prisma.resource.deleteMany({ where: { topicId: t.slug } });
      await prisma.resource.createMany({ data: t.resources.map((r, i) => ({ topicId: t.slug, position: i, ...r })) });
    }
  }
  for (const t of districts.flatMap((d) => d.topics)) {
    await prisma.topicDependency.deleteMany({ where: { topicId: t.slug } });
    if (t.dependsOn?.length) {
      await prisma.topicDependency.createMany({ data: t.dependsOn.map((dep) => ({ topicId: t.slug, dependsOnId: dep })) });
    }
  }

  // 2. Calendar configuration (created once; learner may edit dates afterwards)
  for (const [i, s] of stages.entries()) {
    await prisma.stage.upsert({
      where: { id: s.slug },
      update: { name: s.name, kind: s.kind, position: i, districts: { set: s.districts.map((id) => ({ id })) } },
      create: {
        id: s.slug, position: i, name: s.name, kind: s.kind,
        startDate: toDate(s.start), endDate: toDate(s.end),
        districts: { connect: s.districts.map((id) => ({ id })) },
      },
    });
  }
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, journeyStart: toDate(JOURNEY.start), journeyEnd: toDate(JOURNEY.end), timezone: JOURNEY.timezone },
  });
  for (const [weekday, targetMinutes] of Object.entries(DEFAULT_TARGETS)) {
    await prisma.weeklyTarget.upsert({ where: { weekday: Number(weekday) }, update: {}, create: { weekday: Number(weekday), targetMinutes } });
  }

  // 3. Plan (generated once — never regenerated over existing tasks)
  const existing = await prisma.task.count({ where: { source: "PLAN" } });
  if (existing > 0) {
    log(`Seed: curriculum updated; plan already exists (${existing} planned tasks), left untouched.`);
    return;
  }
  const q = Object.fromEntries(
    Object.entries(queues()).map(([k, v]) => [k, v.map((t) => ({ slug: t.slug, name: t.name, hours: t.hours, subtopics: t.subtopics, exercise: t.exercise }))]),
  );
  const plan = buildPlan(stages, q, DEFAULT_TARGETS);
  const subs = await prisma.subtopic.findMany({ select: { id: true, topicId: true, position: true } });
  const subId = new Map(subs.map((s) => [`${s.topicId}#${s.position}`, s.id]));
  await prisma.task.createMany({
    data: plan.map((t) => ({
      topicId: t.topicSlug,
      subtopicId: t.subtopicIndex === null ? null : (subId.get(`${t.topicSlug}#${t.subtopicIndex}`) ?? null),
      stageId: t.stageSlug,
      title: t.title,
      notes: t.notes,
      kind: t.kind,
      estimatedMinutes: t.minutes,
      originalDate: toDate(t.date),
      scheduledDate: toDate(t.date),
      position: t.position,
      source: "PLAN" as const,
    })),
  });
  log(`Seed: curriculum loaded; generated ${plan.length} planned tasks (${plan.reduce((a, t) => a + t.minutes, 0) / 60} h).`);
}

// Run directly: `tsx prisma/seed.ts` or `node dist/prisma/seed.js`
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()!);
if (isMain) {
  const prisma = new PrismaClient();
  seed(prisma)
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
