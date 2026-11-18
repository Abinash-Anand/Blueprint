/** DTOs returned by the REST API (mirrors LLD §4). */
export type ISODate = string;
export type Priority = "CORE" | "IMPORTANT" | "OPTIONAL";
export type TopicStatus = "NOT_STARTED" | "IN_PROGRESS" | "LEARNED" | "DEMONSTRATED";
export type TaskKind = "STUDY" | "PRACTICE" | "REVISION";
export type TaskStatus = "TODO" | "DONE" | "SKIPPED";

export interface Subtopic {
  id: number;
  position: number;
  name: string;
  completedAt: string | null;
}

export interface Resource {
  label: string;
  url: string;
  kind: "ROADMAP" | "DOCS" | "COURSE" | "ARTICLE";
}

export interface Topic {
  id: string;
  districtId: string;
  position: number;
  name: string;
  description: string;
  priority: Priority;
  estimatedHours: number;
  exercise: string;
  status: TopicStatus;
  demonstratedAt: string | null;
  demonstrationNote: string | null;
  needsReview: boolean;
  subtopics: Subtopic[];
  resources: Resource[];
  dependsOn: string[];
  plannedMinutes: number;
  loggedMinutes: number;
  firstDate: ISODate | null;
  lastDate: ISODate | null;
}

export interface District {
  id: string;
  position: number;
  name: string;
  subtitle: string;
  layer: number;
  color: string;
  cols: number;
  goal: string;
  note: string;
  topics: Topic[];
}

export interface Stage {
  id: string;
  position: number;
  name: string;
  kind: "MAIN" | "PARALLEL";
  startDate: ISODate;
  endDate: ISODate;
  districtIds: string[];
}

export interface Curriculum {
  districts: District[];
  stages: Stage[];
}

export interface Task {
  id: number;
  title: string;
  notes: string;
  kind: TaskKind;
  status: TaskStatus;
  source: "PLAN" | "MANUAL";
  estimatedMinutes: number;
  loggedMinutes: number;
  originalDate: ISODate;
  scheduledDate: ISODate;
  rescheduleCount: number;
  completedAt: string | null;
  overdueDays: number;
  topic: { id: string; name: string; districtId: string } | null;
  subtopic: { id: number; name: string; completed: boolean } | null;
  stageId: string | null;
}

export interface Session {
  id: number;
  date: ISODate;
  minutes: number;
  taskId: number | null;
  topicId: string | null;
  note: string;
}

export interface Today {
  date: ISODate;
  today: ISODate;
  weekday: number;
  isRestDay: boolean;
  isBufferDay: boolean;
  journey: { start: ISODate; end: ISODate; day: number; totalDays: number; status: "BEFORE" | "ACTIVE" | "AFTER" };
  targetMinutes: number;
  plannedMinutes: number;
  doneMinutes: number;
  actualMinutes: number;
  tasks: Task[];
  carriedOver: Task[];
  sessions: Session[];
  stages: Stage[];
  current: { districtId: string | null; topicId: string | null };
  next: { topicId: string; subtopic: string | null } | null;
  reviewTopics: { id: string; name: string; districtId: string }[];
}

export interface WeekDay {
  date: ISODate;
  weekday: number;
  inJourney: boolean;
  isRestDay: boolean;
  targetMinutes: number;
  plannedMinutes: number;
  actualMinutes: number;
  tasksTotal: number;
  tasksDone: number;
}

export interface Week {
  weekStart: ISODate;
  weekEnd: ISODate;
  today: ISODate;
  days: WeekDay[];
  totals: {
    targetMinutes: number;
    plannedMinutes: number;
    actualMinutes: number;
    tasksDone: number;
    tasksRemaining: number;
    remainingMinutes: number;
  };
  milestones: { date: ISODate; type: "PRACTICE" | "STAGE_END"; title: string; topicId: string | null; stageId: string | null; done: boolean }[];
  tasks: Task[];
}

export type StageStatus = "UPCOMING" | "ON_TRACK" | "BEHIND" | "DELAYED" | "COMPLETE";

export interface DistrictProgress {
  id: string;
  subtopicsTotal: number;
  subtopicsLearned: number;
  topicsTotal: number;
  topicsLearned: number;
  topicsDemonstrated: number;
  coreTotal: number;
  coreLearned: number;
  coreDemonstrated: number;
  roadFraction: number;
  passed: boolean;
  plannedMinutes: number;
  actualMinutes: number;
}

export interface Road {
  currentDistrictIndex: number;
  districtFraction: number;
  overall: number;
  currentTopicId: string | null;
}

export interface Progress {
  today: ISODate;
  hours: { plannedTotal: number; plannedToDate: number; actualTotal: number; thisWeek: number; thisMonth: number };
  weekly: { weekStart: ISODate; actualMinutes: number; plannedMinutes: number }[];
  monthly: { month: string; actualMinutes: number; plannedMinutes: number }[];
  districts: DistrictProgress[];
  core: { total: number; learned: number; demonstrated: number };
  practice: { total: number; done: number };
  road: Road;
  stages: (Stage & {
    status: StageStatus;
    delayDays: number;
    tasksTotal: number;
    tasksDone: number;
    minutesTotal: number;
    minutesDone: number;
    overdueTasks: number;
    bufferDays: number;
  })[];
}
