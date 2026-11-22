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

/**
 * Semantic presentation from the backend (LLD §4.4, GET /api/presentation). The backend decides what a state means;
 * the frontend only maps tone/variant/icon to its design tokens. Unknown values fall back to neutral.
 */
export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "ai";
export type Variant = "solid" | "soft" | "outline" | "plain";
export interface Presentation {
  state: string;
  tone: Tone;
  variant: Variant;
  icon: string;
  label: string;
  flags?: Presentation[];
}

export interface Subtopic {
  id: number;
  position: number;
  name: string;
  completedAt: string | null;
  presentation?: Presentation;
  /** Recall (docs/Recall-Plan.md): when it is next due, and how the last check went. */
  recall?: { nextDueDate: ISODate | null; stage: number; last: { date: ISODate; score: number; depth: RecallDepth } | null } | null;
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
  presentation?: Presentation;
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
  presentation?: Presentation;
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
    presentation?: Presentation;
  } | null;
  /** Set for recall tasks: done by checking the recall (Revise); originalDate is the due date. */
  recall?: { stateId: number; stage: number; lastReviewDate: ISODate | null; dueDate: ISODate; overdueDays: number; presentation?: Presentation } | null;
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
    presentation?: Presentation;
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
  presentation?: Presentation;
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
  evaluationId?: number | null;
  selfScore?: number | null;
  inputMode?: "TYPED" | "SPOKEN";
}

export interface Checkpoint {
  id: number;
  topicId: string;
  subtopicId: number;
  label?: string;
  promptId: number | null;
  promptText: string;
  result: CheckpointResult;
  presentation?: Presentation;
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
  /** The city's time zone: "today" is counted in it. */
  timezone?: string;
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
  /** Recall as of the real today: due (incl. carried over), overdue, due tomorrow; minutes planned on this day. */
  recall: { dueCount: number; overdueCount: number; tomorrowCount: number; plannedMinutes: number };
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
  /** Sub-topics due for recall that day (overdue ones on today). */
  recall: string[];
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
  milestones: { date: ISODate; type: "PRACTICE" | "STAGE_END"; title: string; topicId: string | null; stageId: string | null; done: boolean; presentation?: Presentation }[];
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
  presentation?: Presentation;
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
  /** What is realistically achievable with the learner's week (reported only; nothing is scheduled from it). */
  forecast?: Forecast;
  stages: (Stage & {
    status: StageStatus;
    presentation?: Presentation;
    delayDays: number;
    tasksTotal: number;
    tasksDone: number;
    minutesTotal: number;
    minutesDone: number;
    overdueTasks: number;
    bufferDays: number;
  })[];
  recall: {
    inRecall: number; dueNow: number; reviews: number; averageScore: number | null;
    depth: Record<RecallDepth, number>; outcomes: Record<"PASS" | "HOLD" | "LAPSE", number>;
    monthly: { month: string; reviews: number; averageScore: number | null }[];
    /** Per sub-topic progress and blind spots across sub-topics, computed in code (Recall-Plan §3.5, §7). */
    coaching?: RecallCoaching;
  };
}

export interface RecallCoaching {
  subtopics: {
    subtopicId: number; subtopic: string; topic: string; reviews: number; lastDate: ISODate; lastScore: number; scoreDelta: number | null;
    narrative: string; newlyMastered: string[]; slipped: string[]; blindSpots: { label: string; missedInARow: number }[];
    recurringMisconceptions: { claim: string; correction: string }[];
  }[];
  blindSpots: { subtopicId: number; subtopic: string; label: string; missedInARow: number }[];
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
  presentation?: Presentation;
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
  attention?: Presentation;
  overdue: RevisionUnitRow[];
  due: RevisionUnitRow[];
  upcoming: RevisionUnitRow[];
  weak: RevisionUnitRow[];
  awaitingCorrection: RevisionUnitRow[];
  session: { topicId: string; scope: RevisionScope; subtopicId: number | null }[];
  history: (Attempt & { topicId: string; topicName: string })[];
  checkpoints: { id: number; topicId: string; topicName: string; subtopicId: number; label: string; result: CheckpointResult; presentation?: Presentation; neededAssistance: boolean; gaps: string; date: ISODate }[];
}

/** AI design §4.5. */
export interface AiAnalytics {
  selfScored: number;
  selfMatches: number;
  selfMeanDifference: number | null;
  checked: number;
  agreed: number;
  savedHigher: number;
  savedLower: number;
  spoken: { attempts: number; averageScore: number | null };
  typed: { attempts: number; averageScore: number | null };
}

export interface AiStatus {
  enabled: boolean;
  consented: boolean;
  consentedAt: string | null;
  evaluationProvider: string;
  transcriptionProvider: string;
  evaluationModel: string;
  transcriptionModel: string;
  evaluationFallbackModel?: string | null;
  transcriptionFallbackModel?: string | null;
  maxRecordingSeconds: number;
  maxAudioBytes: number;
  maxFollowUps: number;
  dailyRequestLimit: number;
  requestsLast24h: number;
  monthlyBudgetEur: number;
  spentThisMonthEur: number;
}

export type Verdict = "COVERED" | "PARTIAL" | "MISSING" | "INCORRECT";

export interface AiEvaluation {
  id: number;
  parentId: number | null;
  rootId: number;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  presentation?: Presentation;
  errorCode: string | null;
  transcript: string;
  suggestedScore: 0 | 1 | 2 | 3 | null;
  suggestion?: Presentation | null;
  relevant: boolean | null;
  criteria: { index: number; text: string; verdict: Verdict; presentation?: Presentation; evidence: string | null; recoveredInFollowUp: boolean }[];
  misconceptions: { claim: string; correction: string; verified: boolean }[];
  feedback: string;
  followUpQuestion: string | null;
  suggestedMistakes: string;
  assisted: boolean;
  createdAt: string;
}

/* ---------------- accounts and cities (multi-user sprint) ---------------- */

export interface Account {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  timezone: string;
  language: "en" | "de" | string;
  preferences: { reducedMotion?: "system" | "reduce" | "no-preference"; defaultDailyMinutes?: number; defaultDaysPerWeek?: number };
  onboardedAt: string | null;
  createdAt: string;
}

export type CityStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";

/** "Here's what I understood" for a new city (backend ai/curriculum/intake.ts), as the AI wrote it or the learner corrected it. */
export interface Understanding {
  name?: string;
  category?: string;
  goal?: string;
  currentLevel?: string;
  targetLevel?: string;
  subjects?: string[];
  alreadyKnown?: string[];
  resources?: string[];
  focusOptions?: string[];
  questions?: { question: string; options: string[] }[];
  plan?: string | null;
  planMonths?: number | null;
  estimatedHours?: number;
}
/** A learner's own plan file: only its extracted text is kept on the server; this is what the browser sees of it. */
export interface CityAttachment { id: number; name: string; mimeType: string; size: number; pages: number | null; chars: number; hasText: boolean; preview: string }

export interface CityRequirements {
  /** The learner's own words (city creation, step 1). */
  brief?: string;
  understood?: Understanding;
  focus?: string;
  answers?: { question: string; answer: string }[];
  outcome?: string;
  currentLevel?: "NONE" | "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  targetLevel?: "FOUNDATIONS" | "WORKING" | "PROFESSIONAL" | "EXPERT";
  subjects?: string[];
  resources?: string[];
  prerequisites?: string[];
}
export interface CityConstraints {
  hoursPerDay?: number;
  daysPerWeek?: number;
  pace?: "LIGHT" | "STEADY" | "INTENSIVE";
  startDate?: ISODate;
  targetDate?: ISODate;
  timezone?: string;
  /** ISO weekdays the learner studies (1 = Monday). */
  weekdays?: number[];
}

export interface CitySummary {
  id: string;
  name: string;
  description: string;
  goal: string;
  category: string | null;
  status: CityStatus;
  presentation?: Presentation;
  template: string | null;
  requirements: CityRequirements | null;
  constraints: CityConstraints | null;
  createdAt: string;
  updatedAt: string;
  pausedAt: string | null;
  archivedAt: string | null;
  completedAt: string | null;
  topics: number | null;
  versions: number | null;
}

export interface NewCity {
  name: string;
  description?: string;
  goal?: string;
  category?: string | null;
  requirements?: CityRequirements | null;
  constraints?: CityConstraints | null;
}

export interface Template { id: "engineering"; name: string; description: string; districts: number; topics: number; hours: number; weeks: number }

export interface CurriculumChanges {
  added: { districts: string[]; topics: string[] };
  modified: { districts: string[]; topics: string[] };
  removed: { districts: string[]; topics: string[] };
}

export interface CurriculumDocumentView {
  title: string;
  journey: { start: ISODate; end: ISODate; timezone: string };
  districts: { key: string; name: string; color: string; topics: { key: string; name: string; hours: number; priority: Priority; subtopics: string[]; exercise: string; dependsOn: string[] }[] }[];
  stages: { key: string; name: string; start: ISODate; end: ISODate; districts: string[] }[];
}

export interface GenerationAvailability {
  available: boolean;
  reason: "AI_DISABLED" | "NO_PROVIDER" | "CONSENT_REQUIRED" | null;
  consented: boolean;
  provider: string;
  model: string;
  /** The model that reads a new city's goal. */
  understandModel?: string;
  /** Share of study time each pace plans for new material. */
  paces?: Record<"LIGHT" | "STEADY" | "INTENSIVE", number>;
}

export interface CurriculumVersion {
  version: number;
  status: "GENERATING" | "FAILED" | "PROPOSED" | "APPLIED" | "REJECTED";
  /** While GENERATING: what the generator is doing. */
  progress: { step: string; label: string; done: number; total: number; districts?: { name: string; done: boolean }[] } | null;
  /** When FAILED: why, for the learner. */
  error: string | null;
  source: "BUILTIN" | "TEMPLATE" | "IMPORT" | "GENERATED";
  contractVersion: number;
  note: string;
  createdAt: string;
  appliedAt: string | null;
  changes: CurriculumChanges | null;
  /** null while generating or after a failure. */
  summary: { title: string; districts: number; topics: number; hours: number; start: ISODate; end: ISODate } | null;
  content?: CurriculumDocumentView;
}
export type CityProposal = CurriculumVersion & { blockedRemovals: string[] };

export interface ConsentState {
  current: { purpose: "TERMS" | "PRIVACY_NOTICE" | "AI_PROCESSING" | "AI_CURRICULUM"; optional: boolean; granted: boolean; policyVersion: string | null; currentVersion: string; at: string | null }[];
  history: { purpose: string; granted: boolean; policyVersion: string; at: string }[];
}

/* ---------------- Revision v2, phase 1: material and the revision pack ---------------- */

export interface RevisionMaterial { id: number; name: string; mimeType: string; size: number; pages: number | null; chars: number; hasText: boolean; preview: string; createdAt: string }

export type PackStatus = "BUILDING" | "READY" | "FAILED" | "SUPERSEDED";
export interface PackConcept {
  id: number; position: number; title: string; summary: string; subtopicId: number | null; subtopicName: string | null;
  keyPoints: string[]; misconceptions: string[]; source: "AI" | "EDITED" | "LEARNER"; status: "BUILDING" | "READY" | "NEEDS_QUESTIONS"; removed: boolean;
  questions: { total: number; open: number; choice: number; levels: Record<string, number> };
}
export interface PackProgress { step: string; label: string; done: number; total: number; concepts?: { title: string; done: boolean }[] }
export interface RevisionPack {
  id: number; version: number; status: PackStatus; basis: "MATERIAL" | "OUTLINE"; language: string; provider: string; model: string; promptVersion: string;
  createdAt: string; completedAt: string | null; progress: PackProgress | null; error: string | null; stale: boolean; concepts: PackConcept[] | null;
}
export interface PackOverview {
  topicId: string;
  ai: { available: boolean; reason: "AI_DISABLED" | "NO_PROVIDER" | "CONSENT_REQUIRED" | null; consented: boolean; provider: string; model: string };
  limits: { maxFiles: number; maxBytes: number; maxChars: number; types: string[] };
  materials: RevisionMaterial[];
  pack: RevisionPack | null;
  building: RevisionPack | null;
  failed: { version: number; error: string | null; createdAt: string } | null;
}
export interface PackItem {
  id: number; conceptId: number; level: number; kind: string; format: "OPEN" | "CHOICE" | "MULTI";
  situation: string; code: string | null; question: string; answerSize: string; expected: string[]; modelAnswer: string; hints: string[];
  options: { text: string; correct: boolean; explanation: string }[] | null; source: "AI" | "EDITED" | "LEARNER"; removed: boolean;
}

/* ---------------- Revision v2, phases 2 and 3: home, sessions, history ---------------- */

export interface RevisionHome {
  today: string;
  budgetMinutes: number;
  plan: { topics: { topicId: string; name: string; cycle: number; questions: number; minutes: number }[]; questions: number; minutes: number; laterToday: number };
  activeSession: { id: number; kind: SessionKind } | null;
  needsMaterial: { topicId: string; name: string; district: string }[];
  tracks: {
    topicId: string; name: string; cycle: number; inProgress: number; state: "ACTIVE" | "RETAINED"; nextDueDate: string | null; lastReviewDate: string | null;
    weakOnly: boolean; maintenance: boolean; due: boolean; overdue: boolean; line: string;
  }[];
  keepGoing: { tomorrow: number; practice: boolean };
}
export type SessionKind = "PLANNED" | "EARLY" | "PRACTICE";
export interface SessionQuestion {
  index: number; topicId: string; topicName: string; conceptId: number; conceptTitle: string; cycle: number; relearn: boolean; minutes: number;
  /** The pack's language, "en" or "de". */
  language: string;
  itemId: number; level: number | null; kind: string | null; format: "OPEN" | "CHOICE" | "MULTI" | null;
  situation: string; code: string | null; question: string; answerSize: string; options: string[];
  hintsUsed: number; hintsAvailable: number; hints: string[];
}
export interface AnswerCheck {
  relevant: boolean;
  criteria: { index: number; text: string; verdict: "COVERED" | "PARTIAL" | "MISSING" | "INCORRECT"; evidence: string | null }[];
  misconceptions: { claim: string; correction: string }[];
  feedback: string; suggestedScore: number; provider: string; model: string;
}
export interface SessionFeedback {
  responseId: number; index: number; format: "OPEN" | "CHOICE" | "MULTI"; mode: string; answer: string; correct: boolean | null;
  options: { text: string; correct: boolean; explanation: string; chosen: boolean }[];
  expected: string[]; modelAnswer: { gist: string; full: string }; code: string | null; hints: string[]; misconceptions: string[];
  evaluation: AnswerCheck | null; confidence: number | null; hintsUsed: number;
  suggested: number | null; suggestedLabel: string | null; final: number | null; aiError?: string | null;
}
export interface RevisionSessionView {
  id: number; kind: SessionKind; status: "ACTIVE" | "FINISHED"; date: string; budgetMinutes: number; plannedMinutes: number;
  topics: { topicId: string; name: string; questions: number; done: number }[];
  entries: { index: number; topicId: string; topicName: string; conceptTitle: string; relearn: boolean; minutes: number; state: "OPEN" | "ANSWERED" | "DONE"; final: number | null }[];
  current: { question: SessionQuestion; feedback: SessionFeedback | null } | null;
}
export interface CompletionCard {
  topicId: string; name: string; cycle: number; cycleDone: boolean; retained: boolean; nextDueDate: string | null; weakOnly: boolean;
  results: { conceptId: number | null; title: string; result: number; label: string; relearned: boolean }[]; firstNext: string | null;
  /** Set when the gap before the next cycle was adapted to the concepts' record (phase 4): days instead of the fixed gap. */
  interval?: { days: number; fixed: number; reason: string | null } | null;
}
export interface HistoryAnswer {
  id: number; relearn: boolean; kind: string; format: string; question: string; code: string | null; answer: string; mode: string; correct: boolean | null;
  evaluation: AnswerCheck | null; expected: string[]; modelAnswer: string; hintsUsed: number; confidence: number | null; final: number; label: string; date: string;
}
export interface RevisionHistory {
  topicId: string; name: string;
  track: { cycle: number; state: string; nextDueDate: string | null; weakOnly: boolean } | null;
  cycles: number[];
  concepts: { conceptId: number | null; title: string; removed: boolean; story: string; cells: { cycle: number; result: number | null; label: string | null; firstResult: number | null; date: string | null; reviews: number; answers: HistoryAnswer[] }[] }[];
}

/** The retired revision systems' history (docs/Recall-Plan.md §9): attempts and study-time checks, read-only. */
export interface RevisionArchive {
  attempts: { id: number; date: ISODate; label: string; topicName: string; score: number; method: string; withHelp: boolean; gap: string }[];
  checkpoints: { id: number; date: ISODate; label: string; topicName: string; result: CheckpointResult; gaps: string }[];
}

/* ---------------- Recall (docs/Recall-Plan.md) ---------------- */

export type RecallDepth = "FOUNDATIONAL" | "INTERMEDIATE" | "MASTERY";
export interface RecallItem {
  subtopicId: number; subtopic: string; topicId: string; topic: string; district: string; stage: number; nextDueDate: ISODate | null; lastReviewDate: ISODate | null;
  taskId: number; scheduledDate: ISODate; overdueDays: number;
}
export interface RecallHistoryRow {
  reviewId: number; date: ISODate; attempt: number; score: number; depth: RecallDepth; outcome: "PASS" | "HOLD" | "LAPSE"; nextDueDate: ISODate | null;
  subtopicId: number; subtopic: string; topic: string;
}
export interface RecallHome {
  today: ISODate; limit: number; doneToday: number;
  due: RecallItem[]; later: RecallItem[]; upcoming: RecallItem[];
  open: { reviewId: number; subtopicId: number; status: RecallStatus }[];
  ai: { available: boolean; reason: "AI_DISABLED" | "NO_PROVIDER" | "CONSENT_REQUIRED" | null; consented: boolean; provider: string; model: string };
}
export type RecallStatus = "DRAFT" | "WAITING" | "CHECKED" | "COMPLETE";
export type RecallPointStatus = "ACCURATE" | "PARTIAL" | "MISSED";
export interface RecallPointView { id: number; code: string; label: string; description: string; tier: number; leftOut: boolean; status: RecallPointStatus | null; evidence: string | null; recalledWhenAsked: boolean }
export interface RecallReview {
  id: number; subtopicId: number; subtopic: string; topicId: string; topic: string; attempt: number; status: RecallStatus; date: ISODate;
  spokenParts: string[]; typed: string; sketches: string[]; waitReason: string | null; language: string; submittedAt: string | null;
  /** Phase 2: the senior engineer's follow-up and verdict (after checking). */
  followupQuestion: string | null; followupAnswer: string | null; seniorVerdict: SeniorVerdict | null;
  result: null | {
    score: number; depth: "FOUNDATIONAL" | "INTERMEDIATE" | "MASTERY"; outcome: "PASS" | "HOLD" | "LAPSE";
    misconceptions: { claim: string; correction: string }[];
    stageBefore: number; stageAfter: number; nextDueDate: ISODate | null; tierShares: (number | null)[]; gradingModel: string | null;
    points: RecallPointView[];
    /** The graded text and where its quoted words are (absent from responses before 23 Nov 2026). */
    answer?: RecallAnswer;
  };
}
/** A stretch of the graded text, as character offsets: [start, end). */
export interface TextRange { start: number; end: number }
export type RecallAnswerSpan = TextRange & ({ kind: "point"; pointId: number } | { kind: "claim"; index: number });
/** For showing the answer next to the checklist, never for grading: quotes found in `text`, and runs no quote covers. */
export interface RecallAnswer { text: string; spans: RecallAnswerSpan[]; uncovered: TextRange[] }

export interface SeniorVerdict {
  foundationsSummary: string; architectureAndEdgeCasesSummary: string; focusNext: string;
  /** Worked out in code from the follow-up; null when it was skipped or nothing was missed. */
  cuedReasoningRating: "Strong" | "Developing" | "Needs Work" | null;
  recalledWhenAsked: string[]; promptVersion: string; model: string;
}
export interface RecallDiff {
  attempt: number; previousAttempt: number | null; scoreDelta: number | null;
  newlyMastered: { pointId: number; label: string }[]; retained: { pointId: number; label: string }[];
  regressed: { pointId: number; label: string; from: RecallPointStatus; to: RecallPointStatus }[];
  persistentBlindSpots: { pointId: number; label: string; missedInARow: number }[];
  /** Mistakes that came back after an earlier review corrected them (absent in notes written before 21 Nov 2026). */
  recurringMisconceptions?: { claim: string; correction: string; seenBefore: number }[];
  scoreTrajectory: { attempt: number; date: ISODate; score: number; depth: RecallDepth }[];
}
export interface RecallMatrix {
  subtopicId: number; subtopic: string; topic: string; version: number | null;
  points: { id: number; code: string; label: string; tier: number; leftOut: boolean }[];
  attempts: { reviewId: number; attempt: number; date: ISODate; score: number | null; depth: RecallDepth | null; outcome: "PASS" | "HOLD" | "LAPSE" | null; cells: Record<number, { status: RecallPointStatus; recalledWhenAsked: boolean }> }[];
  analyses: { attempt: number; narrative: string; diff: RecallDiff }[];
}

/** The forecast (Blueprint relationship model): open new material against the week, due revision first. Minutes. */
export interface Forecast {
  remainingNewMinutes: number;
  projectedFinish: ISODate | null;
  planEnd: ISODate;
  daysVsPlan: number | null;
  targetDate: ISODate | null;
  meetsTarget: boolean | null;
  neededNewMinutesPerWeek: number | null;
  week: { available: number; newMaterial: number; revision: number };
  revisionLoad: { weekStart: ISODate; recalls: number; minutes: number }[];
}
