/**
 * Curriculum contract (docs/Sprint-Multi-User.md §6). The one structured format a city's curriculum is created from:
 * the built-in Engineering template today, an imported file, and later an AI generator. A generator returns this JSON
 * (never HTML or code); the backend validates it here before anything is written.
 */
import { z } from "zod/v4";
import { addDays, diffDays, isValidISODate } from "../../domain/dates.js";

export const CURRICULUM_CONTRACT_VERSION = 1;
/** The map has room for seven districts (frontend map/geometry.ts ORIGINS). */
export const MAX_DISTRICTS = 7;

const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}$/, "lower-case letters, digits and dashes, at most 24 characters");
const topicKey = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,47}$/, "lower-case letters, digits, dots and dashes");
const isoDate = z.string().refine(isValidISODate, "a calendar date YYYY-MM-DD");
const text = (max: number) => z.string().trim().min(1).max(max);

const resource = z.object({ label: text(200), url: z.string().url().max(500).refine((u) => /^https?:\/\//.test(u), "http(s) URL"), kind: z.enum(["ROADMAP", "DOCS", "COURSE", "ARTICLE"]) }).strict();
const prompt = z.object({
  title: text(120),
  content: text(2000),
  method: z.enum(["CONCEPTUAL", "QUESTION_ANSWER", "WRITTEN", "VISUAL", "PRACTICAL", "SCENARIO"]),
  /** Evaluation criteria, separated by "·" or new lines (what a full answer covers). */
  expected: text(2000),
}).strict();
const topic = z.object({
  key: topicKey,
  name: text(120),
  description: text(1000),
  priority: z.enum(["CORE", "IMPORTANT", "OPTIONAL"]),
  hours: z.number().int().min(1).max(200),
  subtopics: z.array(text(160)).min(1).max(20),
  /** The practical exercise that demonstrates the skill. */
  exercise: text(1000),
  resources: z.array(resource).max(10).default([]),
  dependsOn: z.array(topicKey).max(10).default([]),
  prompts: z.array(prompt).max(5).default([]),
}).strict();
const district = z.object({
  key,
  name: text(60),
  subtitle: z.string().trim().max(120).default(""),
  layer: z.number().int().min(1).max(5).default(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "#rrggbb"),
  cols: z.number().int().min(1).max(6).optional(),
  goal: z.string().trim().max(500).default(""),
  note: z.string().trim().max(1000).default(""),
  topics: z.array(topic).min(1).max(20),
}).strict();
const stage = z.object({
  key,
  name: text(80),
  kind: z.enum(["MAIN", "PARALLEL"]),
  start: isoDate,
  end: isoDate,
  districts: z.array(key).min(1),
  /** The planner queue this stage consumes (topic keys in learning order). */
  queue: key,
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
}).strict();

export const CurriculumDocument = z.object({
  contractVersion: z.literal(CURRICULUM_CONTRACT_VERSION),
  title: text(80),
  journey: z.object({ start: isoDate, end: isoDate, timezone: z.string().min(1).max(64) }).strict(),
  /** ISO weekday (1 = Monday … 7 = Sunday) → planned minutes. */
  weeklyTargets: z.record(z.enum(["1", "2", "3", "4", "5", "6", "7"]), z.number().int().min(0).max(720)),
  districts: z.array(district).min(1).max(MAX_DISTRICTS),
  stages: z.array(stage).min(1).max(20),
  queues: z.record(key, z.array(topicKey).min(1)),
}).strict();
export type CurriculumDocument = z.infer<typeof CurriculumDocument>;

/** The contract as JSON Schema, for a future generator's structured output and for documentation. */
export const curriculumJsonSchema = () => z.toJSONSchema(CurriculumDocument, { io: "input" });

export interface ContractIssue { path: string; message: string }
export type Validation = { ok: true; document: CurriculumDocument; summary: CurriculumSummary } | { ok: false; issues: ContractIssue[] };
export interface CurriculumSummary { districts: number; topics: number; subtopics: number; hours: number; stages: number; start: string; end: string }

/** Structure first (Zod), then the cross-references a schema cannot express. */
export function validateCurriculum(input: unknown): Validation {
  const parsed = CurriculumDocument.safeParse(input);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.slice(0, 50).map((i) => ({ path: i.path.join("."), message: i.message })) };
  const doc = parsed.data;
  const issues: ContractIssue[] = [];
  const add = (path: string, message: string) => issues.length < 50 && issues.push({ path, message });

  const districtKeys = new Set<string>();
  const topics = new Map<string, { priority: string; deps: string[] }>();
  doc.districts.forEach((d, i) => {
    if (districtKeys.has(d.key)) add(`districts.${i}.key`, `duplicate district key "${d.key}"`);
    districtKeys.add(d.key);
    d.topics.forEach((t, j) => {
      if (topics.has(t.key)) add(`districts.${i}.topics.${j}.key`, `duplicate topic key "${t.key}"`);
      topics.set(t.key, { priority: t.priority, deps: t.dependsOn });
    });
  });
  for (const [k, t] of topics) for (const dep of t.deps) {
    if (!topics.has(dep)) add(`topics.${k}.dependsOn`, `unknown topic "${dep}"`);
    if (dep === k) add(`topics.${k}.dependsOn`, "a topic cannot depend on itself");
  }
  // No dependency cycles.
  const state = new Map<string, 1 | 2>();
  const visit = (k: string, trail: string[]): void => {
    if (state.get(k) === 2) return;
    if (state.get(k) === 1) return void add(`topics.${k}.dependsOn`, `dependency cycle: ${[...trail, k].join(" → ")}`);
    state.set(k, 1);
    for (const d of topics.get(k)?.deps ?? []) if (topics.has(d)) visit(d, [...trail, k]);
    state.set(k, 2);
  };
  for (const k of topics.keys()) visit(k, []);

  if (doc.journey.start > doc.journey.end) add("journey", "the journey ends before it starts");
  if (diffDays(doc.journey.start, doc.journey.end) > 3 * 366) add("journey", "at most three years");
  const stageKeys = new Set<string>();
  const usedQueues = new Set<string>();
  doc.stages.forEach((s, i) => {
    if (stageKeys.has(s.key)) add(`stages.${i}.key`, `duplicate stage key "${s.key}"`);
    stageKeys.add(s.key);
    if (s.start > s.end) add(`stages.${i}`, "the stage ends before it starts");
    if (s.start < doc.journey.start || s.end > doc.journey.end) add(`stages.${i}`, "the stage lies outside the journey");
    for (const d of s.districts) if (!districtKeys.has(d)) add(`stages.${i}.districts`, `unknown district "${d}"`);
    if (!doc.queues[s.queue]) add(`stages.${i}.queue`, `unknown queue "${s.queue}"`);
    usedQueues.add(s.queue);
  });
  for (const [q, ks] of Object.entries(doc.queues)) {
    if (!usedQueues.has(q)) add(`queues.${q}`, "no stage uses this queue");
    const seen = new Set<string>();
    for (const k of ks) {
      if (!topics.has(k)) add(`queues.${q}`, `unknown topic "${k}"`);
      else if (topics.get(k)!.priority === "OPTIONAL") add(`queues.${q}`, `optional topic "${k}" is not planned`);
      if (seen.has(k)) add(`queues.${q}`, `"${k}" appears twice`);
      seen.add(k);
    }
  }
  if (Object.values(doc.weeklyTargets).every((m) => m === 0)) add("weeklyTargets", "at least one day needs study time");
  if (issues.length) return { ok: false, issues };

  const all = doc.districts.flatMap((d) => d.topics);
  return {
    ok: true,
    document: doc,
    summary: {
      districts: doc.districts.length, topics: all.length, subtopics: all.reduce((a, t) => a + t.subtopics.length, 0),
      hours: all.reduce((a, t) => a + t.hours, 0), stages: doc.stages.length, start: doc.journey.start, end: doc.journey.end,
    },
  };
}

/** Moves every date of a document by the same number of days (a template started on another day). */
export function shiftDocument(doc: CurriculumDocument, start: string): CurriculumDocument {
  const delta = diffDays(doc.journey.start, start);
  if (delta === 0) return doc;
  const move = (d: string) => addDays(d, delta);
  return {
    ...doc,
    journey: { ...doc.journey, start: move(doc.journey.start), end: move(doc.journey.end) },
    stages: doc.stages.map((s) => ({ ...s, start: move(s.start), end: move(s.end) })),
  };
}

export interface CurriculumChanges {
  added: { districts: string[]; topics: string[] };
  modified: { districts: string[]; topics: string[] };
  removed: { districts: string[]; topics: string[] };
}

/** What a new version changes compared with the applied one, by key (names, text, sub-topics, hours, order). */
export function diffCurriculum(prev: CurriculumDocument | null, next: CurriculumDocument): CurriculumChanges {
  const flat = (d: CurriculumDocument | null) => ({
    districts: new Map((d?.districts ?? []).map((x) => [x.key, JSON.stringify({ ...x, topics: x.topics.map((t) => t.key) })])),
    topics: new Map((d?.districts ?? []).flatMap((x) => x.topics.map((t) => [t.key, JSON.stringify({ ...t, district: x.key })] as const))),
  });
  const a = flat(prev), b = flat(next);
  const cmp = (x: Map<string, string>, y: Map<string, string>) => ({
    added: [...y.keys()].filter((k) => !x.has(k)),
    modified: [...y.keys()].filter((k) => x.has(k) && x.get(k) !== y.get(k)),
    removed: [...x.keys()].filter((k) => !y.has(k)),
  });
  const d = cmp(a.districts, b.districts), t = cmp(a.topics, b.topics);
  return {
    added: { districts: d.added, topics: t.added },
    modified: { districts: d.modified, topics: t.modified },
    removed: { districts: d.removed, topics: t.removed },
  };
}
