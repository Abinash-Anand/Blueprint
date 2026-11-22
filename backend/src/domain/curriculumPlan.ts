/**
 * What a new curriculum version does to an existing plan (docs/Scheduler-Phase2-Plan.md §2.5). Pure. The scheduler
 * then gives every open task its day; this only decides which plan tasks exist and how long they are.
 *
 * - A planned topic without plan tasks (new, or newly put in a queue) gets the planner's study and practice chunks,
 *   placed right after the previous topic of its queue that has tasks.
 * - A topic whose hours changed has its open work resized to what is left: the new total less the minutes already
 *   done. Excess comes off the end of its open tasks; more time becomes added practice right after its last task.
 * - Finished and skipped tasks are never changed. Removed topics are handled before this (their open tasks go).
 *
 * Order without renumbering: the scheduler orders work by (original date, position, id). A task created with the
 * original date and position of the task it should follow, and a higher id, comes right after it and before
 * everything that came after it. No existing task's original date or position changes.
 */
import type { ISODate } from "./dates.js";
import { MAX_TASK_MINUTES, type PlanTopic, UNIT, topicChunks } from "./planner.js";

export interface PlanTaskRow {
  id: number;
  topicId: string;
  kind: "STUDY" | "PRACTICE";
  status: "TODO" | "DONE" | "SKIPPED";
  minutes: number;
  originalDate: ISODate;
  position: number;
  stageId: string | null;
}

export interface NewPlanTask {
  topicId: string;
  /** The sub-topic it studies (its index in the topic), null for practice. */
  subtopicIndex: number | null;
  stageId: string | null;
  kind: "STUDY" | "PRACTICE";
  title: string;
  notes: string;
  minutes: number;
  /** The original date and position of the task it follows: created in this order, each lands right after it. */
  originalDate: ISODate;
  position: number;
}

export interface CurriculumPlanInput {
  /** Planned topics of the new version, by id: their hours, sub-topics and exercise. */
  topics: Map<string, PlanTopic>;
  /** Each queue's topic ids, in order. */
  queues: Record<string, string[]>;
  /** Hours each topic had in the version applied before (absent: it was not there). */
  previousHours: Map<string, number>;
  /** The city's study and practice plan tasks, any status. */
  tasks: PlanTaskRow[];
  /** Stages by queue: where a queue's first topic goes when nothing comes before it. */
  stages: { id: string; queue: string; start: ISODate }[];
}

export interface CurriculumPlan {
  create: NewPlanTask[];
  remove: number[];
  resize: { id: number; minutes: number }[];
}

const order = (a: PlanTaskRow, b: PlanTaskRow) => a.originalDate.localeCompare(b.originalDate) || a.position - b.position || a.id - b.id;

/** `minutes` in tasks of at most MAX_TASK_MINUTES, titled "(part i of n)" when there is more than one. */
function parts(minutes: number, title: string) {
  const n = Math.ceil(minutes / MAX_TASK_MINUTES);
  return Array.from({ length: n }, (_, i) => ({
    title: n > 1 ? `${title} (part ${i + 1} of ${n})` : title,
    minutes: i < n - 1 ? MAX_TASK_MINUTES : minutes - MAX_TASK_MINUTES * (n - 1),
  }));
}

/** The planner's total for a topic: its hours in whole 30-minute units. */
export const topicMinutes = (t: PlanTopic) => Math.round(t.hours * 2) * UNIT;

export function curriculumPlan(i: CurriculumPlanInput): CurriculumPlan {
  const create: NewPlanTask[] = [];
  const remove: number[] = [];
  const resize: { id: number; minutes: number }[] = [];
  const byTopic = new Map<string, PlanTaskRow[]>();
  for (const t of i.tasks) byTopic.set(t.topicId, [...(byTopic.get(t.topicId) ?? []), t]);
  for (const ts of byTopic.values()) ts.sort(order);

  for (const [queue, ids] of Object.entries(i.queues)) {
    const first = i.stages.filter((s) => s.queue === queue).sort((a, b) => a.start.localeCompare(b.start))[0];
    // Where the next topic's new tasks go: after the last task of the latest topic so far that has any.
    let anchor: { originalDate: ISODate; position: number; stageId: string | null } | null = first
      ? { originalDate: first.start, position: -1, stageId: first.id }
      : null;
    for (const id of ids) {
      const topic = i.topics.get(id);
      if (!topic) continue;
      const tasks = byTopic.get(id) ?? [];
      if (!tasks.length) {
        if (!anchor) continue; // a queue no stage uses: the contract does not allow it
        for (const c of topicChunks(topic)) {
          const name = c.kind === "PRACTICE" ? `Practice: ${topic.name}` : topic.subtopics[c.subtopicIndex!];
          for (const p of parts(c.minutes, name)) {
            create.push({
              topicId: id, subtopicIndex: c.subtopicIndex, stageId: anchor.stageId, kind: c.kind, title: p.title,
              notes: c.kind === "PRACTICE" ? topic.exercise : "", minutes: p.minutes, originalDate: anchor.originalDate, position: anchor.position,
            });
          }
        }
        continue; // the anchor stays: the next topic's tasks follow these (created later, higher ids)
      }

      const last = tasks[tasks.length - 1];
      const before = i.previousHours.get(id);
      if (before !== undefined && before !== topic.hours) {
        const done = tasks.filter((t) => t.status === "DONE").reduce((a, t) => a + t.minutes, 0);
        const open = tasks.filter((t) => t.status === "TODO");
        const openTotal = open.reduce((a, t) => a + t.minutes, 0);
        const left = Math.max(0, topicMinutes(topic) - done);
        if (left < openTotal) {
          // Less time: the excess comes off the end of the open work.
          let excess = openTotal - left;
          for (const t of [...open].reverse()) {
            if (excess <= 0) break;
            if (t.minutes <= excess) {
              remove.push(t.id);
              excess -= t.minutes;
            } else {
              resize.push({ id: t.id, minutes: t.minutes - excess });
              excess = 0;
            }
          }
        } else if (left > openTotal) {
          // More time: added practice right after the topic's last task.
          for (const p of parts(left - openTotal, `Practice: ${topic.name} (added time)`)) {
            create.push({
              topicId: id, subtopicIndex: null, stageId: last.stageId, kind: "PRACTICE", title: p.title, notes: topic.exercise,
              minutes: p.minutes, originalDate: last.originalDate, position: last.position,
            });
          }
        }
      }
      anchor = { originalDate: last.originalDate, position: last.position, stageId: last.stageId };
    }
  }
  return { create, remove, resize };
}
