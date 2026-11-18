/**
 * Learning progress (SRS BR-03 … BR-07, LLD §11).
 * Pure: depends only on learning state, never on calendar dates (FR-CAR-01, FR-CAR-04).
 */
export type TopicStatus = "NOT_STARTED" | "IN_PROGRESS" | "LEARNED" | "DEMONSTRATED";
export type Priority = "CORE" | "IMPORTANT" | "OPTIONAL";

export interface TopicLearning {
  id: string;
  priority: Priority;
  estimatedHours: number;
  subtopicsTotal: number;
  subtopicsLearned: number;
  demonstrated: boolean;
  doneTasks: number;
  loggedMinutes: number;
}

export interface DistrictLearning {
  id: string;
  topics: TopicLearning[];
}

/** Learning without demonstration never exceeds this share (BR-04). */
export const LEARN_CAP = 0.8;

export function topicStatus(t: TopicLearning): TopicStatus {
  if (t.demonstrated) return "DEMONSTRATED";
  if (t.subtopicsTotal > 0 && t.subtopicsLearned >= t.subtopicsTotal) return "LEARNED";
  if (t.subtopicsLearned > 0 || t.doneTasks > 0 || t.loggedMinutes > 0) return "IN_PROGRESS";
  return "NOT_STARTED";
}

export function topicScore(t: TopicLearning): number {
  if (t.demonstrated) return 1;
  if (t.subtopicsTotal === 0) return 0;
  return (LEARN_CAP * Math.min(t.subtopicsLearned, t.subtopicsTotal)) / t.subtopicsTotal;
}

const core = (d: DistrictLearning) => d.topics.filter((t) => t.priority === "CORE");

/** Hours-weighted core progress, 0..1 (BR-05). A district without core topics counts as 1. */
export function districtFraction(d: DistrictLearning): number {
  const c = core(d);
  const total = c.reduce((a, t) => a + t.estimatedHours, 0);
  if (total === 0) return 1;
  return c.reduce((a, t) => a + topicScore(t) * t.estimatedHours, 0) / total;
}

/** A checkpoint is passed only when every core topic is demonstrated (FR-CAR-02). */
export function districtPassed(d: DistrictLearning): boolean {
  return core(d).every((t) => t.demonstrated);
}

export interface RoadProgress {
  /** 0..n-1, or n when every district is passed. */
  currentDistrictIndex: number;
  districtFraction: number;
  overall: number;
}

/** BR-06: the car travels the route in order. */
export function roadProgress(districts: DistrictLearning[]): RoadProgress {
  const n = districts.length;
  const i = districts.findIndex((d) => !districtPassed(d));
  if (i < 0) return { currentDistrictIndex: n, districtFraction: 1, overall: 1 };
  const f = districtFraction(districts[i]);
  return { currentDistrictIndex: i, districtFraction: f, overall: (i + f) / n };
}

/**
 * BR-07: the current topic is the topic of the first unfinished task today; otherwise the
 * first non-demonstrated core topic of the current district (falling back to any non-demonstrated topic).
 */
export function currentTopicId(
  districts: DistrictLearning[],
  todayOpenTaskTopicIds: (string | null)[],
): string | null {
  const first = todayOpenTaskTopicIds.find((t): t is string => !!t);
  if (first) return first;
  const { currentDistrictIndex: i } = roadProgress(districts);
  if (i >= districts.length) return null;
  const d = districts[i];
  return (core(d).find((t) => !t.demonstrated) ?? d.topics.find((t) => !t.demonstrated))?.id ?? null;
}
