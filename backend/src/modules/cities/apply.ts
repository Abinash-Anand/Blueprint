/**
 * Turns a validated curriculum document into a city's records (docs/Sprint-Multi-User.md §6). The same routine seeds
 * the original Engineering City on every start (refreshing its text, as the seed always did) and creates new cities.
 *
 * Learning history is never lost: learner-owned fields (ticked floors, demonstrations, review flags, prompt on/off) are
 * never overwritten, ticked sub-topics are never removed, and the plan is generated only once per city.
 */
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_TARGETS, JOURNEY, districts as builtinDistricts, queues as builtinQueues, stages as builtinStages } from "../../curriculum/index.js";
import { curriculumPrompts } from "../../curriculum/prompts.js";
import { type ISODate, toDate } from "../../domain/dates.js";
import { buildPlan } from "../../domain/planner.js";
import { CURRICULUM_CONTRACT_VERSION, type CurriculumDocument } from "./contract.js";

/** The built-in Engineering City curriculum as a contract document (keys = the original slugs). */
export function engineeringTemplate(): CurriculumDocument {
  const prompts = new Map<string, typeof curriculumPrompts>();
  for (const p of curriculumPrompts) prompts.set(p.topic, [...(prompts.get(p.topic) ?? []), p]);
  return {
    contractVersion: CURRICULUM_CONTRACT_VERSION,
    title: "Engineering City",
    journey: { start: JOURNEY.start, end: JOURNEY.end, timezone: JOURNEY.timezone },
    weeklyTargets: Object.fromEntries(Object.entries(DEFAULT_TARGETS).map(([k, v]) => [k, v])) as CurriculumDocument["weeklyTargets"],
    districts: builtinDistricts.map((d) => ({
      key: d.slug, name: d.name, subtitle: d.subtitle, layer: d.layer, color: d.color, cols: d.cols, goal: d.goal, note: d.note,
      topics: d.topics.map((t) => ({
        key: t.slug, name: t.name, description: t.description, priority: t.priority, hours: t.hours, subtopics: t.subtopics,
        exercise: t.exercise, resources: t.resources, dependsOn: t.dependsOn ?? [],
        prompts: (prompts.get(t.slug) ?? []).map((p) => ({ title: p.title, content: p.content, method: p.method, expected: p.expected })),
      })),
    })),
    stages: builtinStages.map((s) => ({ key: s.slug, name: s.name, kind: s.kind, start: s.start, end: s.end, districts: s.districts, queue: s.queue, weekdays: s.weekdays })),
    queues: Object.fromEntries(Object.entries(builtinQueues()).map(([q, ts]) => [q, ts.map((t) => t.slug)])),
  };
}

export const TEMPLATES = {
  engineering: {
    id: "engineering",
    name: "Engineering City",
    description: "Nine months from frontend to applied AI: 7 districts, 83 topics, practical milestones and spaced revision.",
    build: engineeringTemplate,
  },
} as const;
export type TemplateId = keyof typeof TEMPLATES;

/**
 * Writes `doc` into the city behind `db` (a city-scoped client). `prefix` is the city's id prefix ("" for the original
 * Engineering City, so its ids never change). Idempotent: safe to run again with the same or an updated document.
 */
export async function applyCurriculum(db: PrismaClient, doc: CurriculumDocument, prefix: string, today: ISODate, log: (m: string) => void = () => {}) {
  const id = (k: string) => `${prefix}${k}`;
  // 1. Curriculum
  for (const [di, d] of doc.districts.entries()) {
    const district = {
      position: di, name: d.name, subtitle: d.subtitle, layer: d.layer, color: d.color.toLowerCase(),
      cols: d.cols ?? Math.min(6, Math.max(2, Math.ceil(Math.sqrt(d.topics.length)))), goal: d.goal, note: d.note,
    };
    await db.district.upsert({ where: { id: id(d.key) }, update: district, create: { id: id(d.key), ...district } });
    for (const [ti, t] of d.topics.entries()) {
      const topic = { districtId: id(d.key), position: ti, name: t.name, description: t.description, priority: t.priority, estimatedHours: t.hours, exercise: t.exercise };
      await db.topic.upsert({ where: { id: id(t.key) }, update: topic, create: { id: id(t.key), ...topic } });
      for (const [si, name] of t.subtopics.entries()) {
        await db.subtopic.upsert({
          where: { topicId_position: { topicId: id(t.key), position: si } },
          update: { name },
          create: { topicId: id(t.key), position: si, name },
        });
      }
      // Remove sub-topics that no longer exist, but never ones the learner has ticked.
      await db.subtopic.deleteMany({ where: { topicId: id(t.key), position: { gte: t.subtopics.length }, completedAt: null } });
      await db.resource.deleteMany({ where: { topicId: id(t.key) } });
      await db.resource.createMany({ data: t.resources.map((r, i) => ({ topicId: id(t.key), position: i, ...r })) });
    }
  }
  for (const t of doc.districts.flatMap((d) => d.topics)) {
    await db.topicDependency.deleteMany({ where: { topicId: id(t.key) } });
    if (t.dependsOn.length) await db.topicDependency.createMany({ data: t.dependsOn.map((dep) => ({ topicId: id(t.key), dependsOnId: id(dep) })) });
  }

  // 2. Calendar (created once; the learner may edit dates afterwards)
  for (const [i, s] of doc.stages.entries()) {
    await db.stage.upsert({
      where: { id: id(s.key) },
      update: { name: s.name, kind: s.kind, position: i, districts: { set: s.districts.map((d) => ({ id: id(d) })) } },
      create: { id: id(s.key), position: i, name: s.name, kind: s.kind, startDate: toDate(s.start), endDate: toDate(s.end), districts: { connect: s.districts.map((d) => ({ id: id(d) })) } },
    });
  }
  if (!(await db.settings.findFirst())) {
    await db.settings.create({ data: { journeyStart: toDate(doc.journey.start), journeyEnd: toDate(doc.journey.end), timezone: doc.journey.timezone } });
  }
  for (const [weekday, targetMinutes] of Object.entries(doc.weeklyTargets)) {
    if (!(await db.weeklyTarget.findFirst({ where: { weekday: Number(weekday) } }))) await db.weeklyTarget.create({ data: { weekday: Number(weekday), targetMinutes } });
  }

  // 3. Plan: generated once per city, never over existing tasks.
  const existing = await db.task.count({ where: { source: "PLAN" } });
  if (existing > 0) log(`Curriculum updated; plan already exists (${existing} planned tasks), left untouched.`);
  else {
    const topics = new Map(doc.districts.flatMap((d) => d.topics).map((t) => [t.key, t]));
    const queues = Object.fromEntries(Object.entries(doc.queues).map(([q, ks]) => [q, ks.map((k) => {
      const t = topics.get(k)!;
      return { slug: id(k), name: t.name, hours: t.hours, subtopics: t.subtopics, exercise: t.exercise };
    })]));
    const plan = buildPlan(doc.stages.map((s) => ({ slug: id(s.key), kind: s.kind, start: s.start, end: s.end, queue: s.queue, weekdays: s.weekdays })), queues, Object.fromEntries(Object.entries(doc.weeklyTargets).map(([k, v]) => [Number(k), v])));
    const subs = await db.subtopic.findMany({ select: { id: true, topicId: true, position: true } });
    const subId = new Map(subs.map((s) => [`${s.topicId}#${s.position}`, s.id]));
    await db.task.createMany({
      data: plan.map((t) => ({
        topicId: t.topicSlug,
        subtopicId: t.subtopicIndex === null ? null : (subId.get(`${t.topicSlug}#${t.subtopicIndex}`) ?? null),
        stageId: t.stageSlug, title: t.title, notes: t.notes, kind: t.kind, estimatedMinutes: t.minutes,
        originalDate: toDate(t.date), scheduledDate: toDate(t.date), position: t.position, source: "PLAN" as const,
      })),
    });
    log(`Curriculum loaded; generated ${plan.length} planned tasks (${plan.reduce((a, t) => a + t.minutes, 0) / 60} h).`);
  }
}
