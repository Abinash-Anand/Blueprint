/**
 * Initial plan generation (SRS §6, LLD §12.2). Pure and deterministic.
 */
import { type ISODate, eachDay, isoWeekday } from "./dates.js";

export const UNIT = 30; // minutes
export const MAX_TASK_MINUTES = 120;
export const PRACTICE_SHARE = 0.3;

export interface PlanTopic {
  slug: string;
  name: string;
  hours: number;
  subtopics: string[];
  exercise: string;
}

export interface PlanStage {
  slug: string;
  kind: "MAIN" | "PARALLEL";
  start: ISODate;
  end: ISODate;
  queue: string;
  weekdays: number[];
}

export interface PlannedTask {
  topicSlug: string;
  subtopicIndex: number | null;
  stageSlug: string;
  kind: "STUDY" | "PRACTICE";
  title: string;
  notes: string;
  minutes: number;
  date: ISODate;
  position: number;
}

export class PlanOverflowError extends Error {
  constructor(public queue: string, public remainingMinutes: number) {
    super(`Plan queue "${queue}" does not fit its stages: ${remainingMinutes} min left over`);
  }
}

interface Chunk {
  topic: PlanTopic;
  subtopicIndex: number | null;
  kind: "STUDY" | "PRACTICE";
  minutes: number;
}

/** Split a topic into study chunks per sub-topic plus one practice chunk (30-minute units). */
export function topicChunks(topic: PlanTopic): Chunk[] {
  const units = Math.round(topic.hours * 2);
  const practice = Math.max(1, Math.round(units * PRACTICE_SHARE));
  const study = units - practice;
  const n = topic.subtopics.length;
  if (n === 0 || study < n) {
    throw new Error(`Topic ${topic.slug}: ${topic.hours} h is too little for ${n} sub-topics`);
  }
  const base = Math.floor(study / n);
  const rem = study % n;
  const chunks: Chunk[] = topic.subtopics.map((_, i) => ({
    topic,
    subtopicIndex: i,
    kind: "STUDY",
    minutes: (base + (i < rem ? 1 : 0)) * UNIT,
  }));
  chunks.push({ topic, subtopicIndex: null, kind: "PRACTICE", minutes: practice * UNIT });
  return chunks;
}

/** Dates claimed by parallel stages (main stages skip them). */
export function reservedDates(stages: PlanStage[]): Set<ISODate> {
  const r = new Set<ISODate>();
  for (const s of stages.filter((x) => x.kind === "PARALLEL")) {
    for (const d of eachDay(s.start, s.end)) if (s.weekdays.includes(isoWeekday(d))) r.add(d);
  }
  return r;
}

export function eligibleDays(stage: PlanStage, reserved: Set<ISODate>, target: (d: ISODate) => number): ISODate[] {
  return eachDay(stage.start, stage.end).filter(
    (d) =>
      stage.weekdays.includes(isoWeekday(d)) &&
      target(d) > 0 &&
      (stage.kind === "PARALLEL" || !reserved.has(d)),
  );
}

export function buildPlan(
  stages: PlanStage[],
  queues: Record<string, PlanTopic[]>,
  targetByWeekday: Record<number, number>,
): PlannedTask[] {
  const target = (d: ISODate) => targetByWeekday[isoWeekday(d)] ?? 0;
  const reserved = reservedDates(stages);
  const used = new Map<ISODate, number>();
  const positions = new Map<ISODate, number>();
  const out: PlannedTask[] = [];

  const queueNames = [...new Set(stages.map((s) => s.queue))];
  for (const q of queueNames) {
    const chunks = (queues[q] ?? []).flatMap(topicChunks);
    const qStages = stages.filter((s) => s.queue === q).sort((a, b) => a.start.localeCompare(b.start));
    const days = qStages.flatMap((s) => eligibleDays(s, reserved, target).map((d) => ({ d, s })));
    const parts = new Map<Chunk, PlannedTask[]>();

    let ci = 0;
    let left = chunks[0]?.minutes ?? 0;
    for (const { d, s } of days) {
      if (ci >= chunks.length) break;
      let cap = target(d) - (used.get(d) ?? 0);
      while (cap > 0 && ci < chunks.length) {
        const c = chunks[ci];
        const take = Math.min(left, cap, MAX_TASK_MINUTES);
        const pos = positions.get(d) ?? 0;
        const task: PlannedTask = {
          topicSlug: c.topic.slug,
          subtopicIndex: c.subtopicIndex,
          stageSlug: s.slug,
          kind: c.kind,
          title: c.kind === "PRACTICE" ? `Practice: ${c.topic.name}` : c.topic.subtopics[c.subtopicIndex!],
          notes: c.kind === "PRACTICE" ? c.topic.exercise : "",
          minutes: take,
          date: d,
          position: pos,
        };
        out.push(task);
        parts.set(c, [...(parts.get(c) ?? []), task]);
        positions.set(d, pos + 1);
        used.set(d, (used.get(d) ?? 0) + take);
        cap -= take;
        left -= take;
        if (left === 0) {
          ci++;
          left = chunks[ci]?.minutes ?? 0;
        }
      }
    }
    if (ci < chunks.length) {
      const remaining = left + chunks.slice(ci + 1).reduce((a, c) => a + c.minutes, 0);
      throw new PlanOverflowError(q, remaining);
    }
    for (const list of parts.values()) {
      if (list.length > 1) list.forEach((t, i) => (t.title = `${t.title} (part ${i + 1} of ${list.length})`));
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position);
}

/** Capacity summary per stage, for documentation and tests. */
export function stageCapacity(stages: PlanStage[], targetByWeekday: Record<number, number>) {
  const target = (d: ISODate) => targetByWeekday[isoWeekday(d)] ?? 0;
  const reserved = reservedDates(stages);
  return stages.map((s) => {
    const days = eligibleDays(s, reserved, target);
    return { slug: s.slug, days: days.length, minutes: days.reduce((a, d) => a + target(d), 0) };
  });
}
