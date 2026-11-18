export type Priority = "CORE" | "IMPORTANT" | "OPTIONAL";
export type ResourceKind = "ROADMAP" | "DOCS" | "COURSE" | "ARTICLE";

export interface ResourceDef {
  label: string;
  url: string;
  kind: ResourceKind;
}

export interface TopicDef {
  /** Stable forever: progress is keyed on it. */
  slug: string;
  name: string;
  description: string;
  priority: Priority;
  /** Whole hours, including practice. */
  hours: number;
  /** Floors, in learning order. */
  subtopics: string[];
  /** The practical milestone that demonstrates the skill. */
  exercise: string;
  resources: ResourceDef[];
  dependsOn?: string[];
}

export interface DistrictDef {
  slug: string;
  name: string;
  subtitle: string;
  layer: 1 | 2 | 3 | 4 | 5;
  color: string;
  cols: number;
  goal: string;
  note: string;
  topics: TopicDef[];
}

export interface StageDef {
  slug: string;
  name: string;
  kind: "MAIN" | "PARALLEL";
  start: string;
  end: string;
  districts: string[];
  /** Planner queue this stage consumes. */
  queue: string;
  /** Eligible ISO weekdays (1 = Monday … 7 = Sunday). */
  weekdays: number[];
}

/** Helpers to keep the data files short. */
export const roadmap = (label: string, url: string): ResourceDef => ({ label, url, kind: "ROADMAP" });
export const docs = (label: string, url: string): ResourceDef => ({ label, url, kind: "DOCS" });
export const course = (label: string, url: string): ResourceDef => ({ label, url, kind: "COURSE" });
export const article = (label: string, url: string): ResourceDef => ({ label, url, kind: "ARTICLE" });
