/** DTOs returned by the REST API (mirrors LLD §4). */
export type ISODate = string;
export type Priority = "CORE" | "IMPORTANT" | "OPTIONAL";
export type TopicStatus = "NOT_STARTED" | "IN_PROGRESS" | "LEARNED" | "DEMONSTRATED";
export type TaskKind = "STUDY" | "PRACTICE" | "REVISION";
export type TaskStatus = "TODO" | "DONE" | "SKIPPED";
export type RetrievalMethod = "CONCEPTUAL" | "QUESTION_ANSWER" | "WRITTEN" | "VISUAL" | "PRACTICAL" | "SCENARIO";
export type RevisionScope = "SUBTOPIC" | "TOPIC";
export type RevisionStatus = "SCHEDULED" | "DUE" | "OVERDUE" | "AWAITING_CORRECTION" | "SUSPENDED";
export type PromptSource = "CURRICULUM" | "TEMPLATE" | "LEARNER";
export type CheckpointResult = "RECALLED" | "PARTIAL" | "NOT_RECALLED";

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
  source: "PLAN" | "MANUAL" | "REVISION";
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
  /** Set for scheduler-created revision tasks; originalDate is the due date. */
  revision: {
    scheduleId: number;
    scope: RevisionScope;
    weak: boolean;
    correctionPending: boolean;
    lastScore: number | null;
    dueDate: ISODate;
    overdueDays: number;
  } | null;
}

export interface PromptOption {
  promptId: number | null;
  templateKey: string | null;
  source: PromptSource;
  title: string;
  content: string;
  retrievalMethod: RetrievalMethod;
  expectedAnswer: string;
  difficulty: number | null;
  isActive: boolean;
  uses: number;
  lastUsedDate: ISODate | null;
}

export interface RevisionUnit {
  unit: string;
  scope: RevisionScope;
  subtopicId: number | null;
  label: string;
  learned: boolean;
  eligible: boolean;
  schedule: {
    id: number;
    status: RevisionStatus;
    nextDueDate: ISODate | null;
    lastAttemptDate: ISODate | null;
    lastScore: number | null;
    consecutiveSuccesses: number;
    consecutiveFailures: number;
    weak: boolean;
    correctionPending: boolean;
    pendingAttemptId: number | null;
    openTask: { id: number; scheduledDate: ISODate } | null;
    attempts: number;
  } | null;
  options: PromptOption[];
  suggested: number;
}

export interface Attempt {
  id: number;
  scheduleId: number;
  label: string;
  scope: RevisionScope;
  promptId: number | null;
  promptText: string;
  score: number;
  effectiveScore: number;
  retrievalMethod: RetrievalMethod;
  attemptedAt: string;
  attemptDate: ISODate;
  durationMinutes: number | null;
  usedHints: boolean;
  usedNotes: boolean;
  response: string;
  mistakes: string;
  correctionCompleted: boolean;
  correctedAt: string | null;
  comment: string;
  intervalDays: number;
  nextDueDate: ISODate | null;
}

export interface Checkpoint {
  id: number;
  topicId: string;
  subtopicId: number;
  label?: string;
  promptId: number | null;
  promptText: string;
  result: CheckpointResult;
  neededAssistance: boolean;
  gaps: string;
  response: string;
  date: ISODate;
  completedAt: string;
}

export interface Prompt {
  id: number;
  topicId: string;
  subtopicId: number | null;
  source: PromptSource;
  title: string;
  content: string;
  retrievalMethod: RetrievalMethod;
  expectedAnswer: string;
  difficulty: number | null;
  isActive: boolean;
}

export interface TopicRevision {
  topicId: string;
  today: ISODate;
  policy: { subtopicMinutes: number; topicMinutes: number; dailyBudgetMinutes: number };
  units: RevisionUnit[];
  attempts: Attempt[];
  checkpoints: Checkpoint[];
  prompts: Prompt[];
}

export interface AttemptResult {
  attempt: Attempt;
  nextDueDate: ISODate | null;
  nextTaskDate: ISODate | null;
  correctionPending: boolean;
  intervalDays: number;
  effectiveScore: number;
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
  revision: {
    plannedMinutes: number;
    learningMinutes: number;
    dailyAllowanceMinutes: number;
    weeklyOvertimeMinutes: number;
    overTargetMinutes: number;
    weekOverTargetMinutes: number;
    competing: boolean;
    dueCount: number;
    overdueCount: number;
    weakCount: number;
    awaitingCorrection: number;
    backlog: { count: number; oldestDue: ISODate | null };
    optional: Task[];
    sessionTaskIds: number[];
  };
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
  revisionTasks: number;
  revisionPlannedMinutes: number;
  revisionDoneMinutes: number;
  overTargetMinutes: number;
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
  revision: {
    plannedMinutes: number; doneMinutes: number; upcomingMinutes: number; dueThisWeek: number; overdue: number;
    overTargetMinutes: number; dailyAllowanceMinutes: number; weeklyOvertimeMinutes: number;
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
  revision: {
    attempts: number;
    successful: number;
    distribution: number[];
    checkpoints: number;
    activeUnits: number;
    dueToday: number;
    overdue: number;
    awaitingCorrection: number;
    dailyAllowanceMinutes: number;
    monthly: { month: string; attempts: number; successful: number; averageScore: number | null }[];
    weakUnits: {
      scheduleId: number; topicId: string; subtopicId: number | null; scope: RevisionScope; label: string;
      lastScore: number | null; consecutiveFailures: number; nextDueDate: ISODate | null;
    }[];
  };
}

export interface RevisionUnitRow {
  scheduleId: number;
  topicId: string;
  topicName: string;
  districtId: string;
  subtopicId: number | null;
  scope: RevisionScope;
  label: string;
  status: RevisionStatus;
  nextDueDate: ISODate | null;
  overdueDays: number;
  lastAttemptDate: ISODate | null;
  lastScore: number | null;
  consecutiveSuccesses: number;
  weak: boolean;
  correctionPending: boolean;
  pendingAttemptId: number | null;
  openTask: { id: number; scheduledDate: ISODate } | null;
}

/** GET /revision/overview: the Revision section (read-only, derived from the one schedule table). */
export interface RevisionOverview {
  today: ISODate;
  upcomingDays: number;
  dailyAllowanceMinutes: number;
  weeklyOvertimeMinutes: number;
  counts: { due: number; overdue: number; upcoming: number; later: number; weak: number; awaitingCorrection: number; active: number; paused: number };
  overdue: RevisionUnitRow[];
  due: RevisionUnitRow[];
  upcoming: RevisionUnitRow[];
  weak: RevisionUnitRow[];
  awaitingCorrection: RevisionUnitRow[];
  session: { topicId: string; scope: RevisionScope; subtopicId: number | null }[];
  history: (Attempt & { topicId: string; topicName: string })[];
  checkpoints: { id: number; topicId: string; topicName: string; subtopicId: number; label: string; result: CheckpointResult; neededAssistance: boolean; gaps: string; date: ISODate }[];
}
