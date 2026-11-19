/**
 * Semantic presentation (design note: LLD §4.4). The one place that decides how a domain state is communicated:
 * a tone (what it means), a variant (how strongly), an icon and a short label. The frontend renders these through its
 * own design tokens; it never classifies states itself and never receives colours.
 *
 * Pure and dependency-free: every function takes plain values and returns plain data, so the same mapping is reused by
 * every endpoint that shows the state. Nothing here changes learning, scheduling, scoring or progress.
 */
import { type ISODate, diffDays } from "./dates.js";

/** Bump when a field is added, removed or changes meaning; tones, variants and icons are only ever added. */
export const PRESENTATION_VERSION = 1;

export const TONES = ["success", "warning", "danger", "info", "neutral", "ai"] as const;
export type Tone = (typeof TONES)[number];

/** solid = strongest (a finished milestone), soft = tinted badge, outline = flag, plain = text only, no badge chrome. */
export const VARIANTS = ["solid", "soft", "outline", "plain"] as const;
export type Variant = (typeof VARIANTS)[number];

export const ICONS = [
  "check", "check-circle", "circle", "half", "clock", "calendar", "alert-circle", "alert-triangle", "x-circle",
  "pause", "skip", "flag", "sparkle", "edit", "target", "minus",
] as const;
export type Icon = (typeof ICONS)[number];

export interface Presentation {
  /** Stable machine key, e.g. "revision.overdue". */
  state: StateKey;
  tone: Tone;
  variant: Variant;
  icon: Icon;
  /** Complete, human-readable text; colour is never the only signal. */
  label: string;
  /** Secondary states shown next to the primary one (e.g. "Weak" on an overdue unit). */
  flags?: Presentation[];
}

type Style = { tone: Tone; variant: Variant; icon: Icon };
const s = (tone: Tone, variant: Variant, icon: Icon): Style => ({ tone, variant, icon });

/**
 * The catalogue: every state Blueprint communicates, by domain. Tones follow meaning, not decoration:
 *   success = done or retrieved · warning = needs attention · danger = overdue, failed or wrong
 *   info = scheduled or active · neutral = not started, inactive, skipped · ai = AI suggestions only
 */
export const STATES = {
  "task.todo": s("info", "plain", "circle"),
  "task.done": s("success", "soft", "check-circle"),
  "task.skipped": s("neutral", "plain", "skip"),
  "task.overdue": s("danger", "soft", "alert-circle"),

  "topic.not-started": s("neutral", "plain", "circle"),
  "topic.in-progress": s("info", "soft", "half"),
  "topic.learned": s("info", "soft", "check"),
  "topic.demonstrated": s("success", "solid", "check-circle"),
  "topic.needs-review": s("warning", "outline", "flag"),

  "subtopic.not-learned": s("neutral", "plain", "circle"),
  "subtopic.learned": s("success", "plain", "check"),

  "revision.paused": s("neutral", "outline", "pause"),
  "revision.correction": s("warning", "soft", "edit"),
  "revision.overdue": s("danger", "soft", "alert-circle"),
  "revision.due": s("info", "soft", "clock"),
  "revision.done-today": s("success", "soft", "check"),
  "revision.done": s("success", "soft", "check"),
  "revision.upcoming": s("neutral", "plain", "calendar"),
  "revision.weak": s("warning", "outline", "alert-triangle"),

  "outcome.forgot": s("danger", "soft", "x-circle"),
  "outcome.struggled": s("warning", "soft", "half"),
  "outcome.recalled": s("success", "soft", "check"),
  "outcome.mastered": s("success", "solid", "check-circle"),

  "checkpoint.recalled": s("success", "soft", "check"),
  "checkpoint.partial": s("warning", "soft", "half"),
  "checkpoint.not-recalled": s("danger", "soft", "x-circle"),

  "district.passed": s("success", "solid", "check-circle"),
  "district.current": s("info", "soft", "target"),
  "district.ahead": s("neutral", "plain", "circle"),

  "stage.upcoming": s("neutral", "plain", "calendar"),
  "stage.on-track": s("info", "soft", "clock"),
  "stage.behind": s("warning", "soft", "alert-triangle"),
  "stage.delayed": s("danger", "soft", "alert-circle"),
  "stage.complete": s("success", "solid", "check-circle"),

  "milestone.planned": s("info", "plain", "flag"),
  "milestone.done": s("success", "soft", "check-circle"),
  "milestone.overdue": s("danger", "soft", "alert-circle"),
  "milestone.ended": s("neutral", "plain", "flag"),

  "attention.none": s("neutral", "plain", "check"),
  "attention.due": s("info", "soft", "clock"),
  "attention.overdue": s("danger", "solid", "alert-circle"),

  "city.draft": s("neutral", "outline", "edit"),
  "city.active": s("info", "soft", "target"),
  "city.paused": s("warning", "soft", "pause"),
  "city.completed": s("success", "solid", "check-circle"),
  "city.archived": s("neutral", "plain", "minus"),

  "ai.checking": s("ai", "soft", "sparkle"),
  "ai.suggestion": s("ai", "soft", "sparkle"),
  "ai.failed": s("danger", "soft", "alert-circle"),
  "verdict.covered": s("success", "soft", "check"),
  "verdict.partial": s("warning", "soft", "half"),
  "verdict.missing": s("neutral", "outline", "minus"),
  "verdict.incorrect": s("danger", "soft", "x-circle"),
} as const satisfies Record<string, Style>;
export type StateKey = keyof typeof STATES;

export function present(state: StateKey, label: string, flags?: Presentation[]): Presentation {
  return { state, ...STATES[state], label, ...(flags?.length ? { flags } : {}) };
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-21" → "21 Nov" (calendar date, no time zone). */
export const dayMonth = (iso: ISODate) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/* ---------------- tasks ---------------- */

export function taskPresentation(t: { status: "TODO" | "DONE" | "SKIPPED"; overdueDays: number }): Presentation {
  if (t.status === "DONE") return present("task.done", "Done");
  if (t.status === "SKIPPED") return present("task.skipped", "Skipped");
  if (t.overdueDays > 0) return present("task.overdue", `${plural(t.overdueDays, "day")} overdue`);
  return present("task.todo", "To do");
}

/* ---------------- learning ---------------- */

const TOPIC: Record<"NOT_STARTED" | "IN_PROGRESS" | "LEARNED" | "DEMONSTRATED", [StateKey, string]> = {
  NOT_STARTED: ["topic.not-started", "Not started"],
  IN_PROGRESS: ["topic.in-progress", "In progress"],
  LEARNED: ["topic.learned", "Learned"],
  DEMONSTRATED: ["topic.demonstrated", "Demonstrated"],
};

export function topicPresentation(status: keyof typeof TOPIC, needsReview: boolean): Presentation {
  const [state, label] = TOPIC[status];
  return present(state, label, needsReview ? [present("topic.needs-review", "Needs review")] : undefined);
}

export const subtopicPresentation = (learned: boolean) =>
  learned ? present("subtopic.learned", "Learned") : present("subtopic.not-learned", "Not learned");

/* ---------------- revision ---------------- */

export interface RevisionStateInput {
  suspended?: boolean;
  correctionPending: boolean;
  nextDueDate: ISODate | null;
  lastAttemptDate?: ISODate | null;
  /** A revision task that is already done. */
  completed?: boolean;
  weak?: boolean;
}

/**
 * One primary state per unit, in this order (Revision refinement §2.2):
 *   Paused → Correct the gap first → Recorded (finished task) / Done today → Overdue → Due today → Upcoming. "Weak" is a flag, not a state.
 */
export function revisionPresentation(x: RevisionStateInput, today: ISODate): Presentation {
  const flags = x.weak ? [present("revision.weak", "Weak")] : undefined;
  if (x.suspended) return present("revision.paused", "Paused: not marked learned", flags);
  if (x.correctionPending) return present("revision.correction", "Correct the gap first", flags);
  // A finished revision task: its due date is not the next one, so no date is shown.
  if (x.completed) return present("revision.done", "Revision recorded", flags);
  if (x.lastAttemptDate === today && (!x.nextDueDate || x.nextDueDate > today))
    return present("revision.done-today", x.nextDueDate ? `Done today · next ${dayMonth(x.nextDueDate)}` : "Done today", flags);
  if (x.nextDueDate && x.nextDueDate < today) return present("revision.overdue", `${plural(diffDays(x.nextDueDate, today), "day")} overdue`, flags);
  if (x.nextDueDate === today) return present("revision.due", "Due today", flags);
  return present("revision.upcoming", x.nextDueDate ? `Next ${dayMonth(x.nextDueDate)}` : "Scheduled", flags);
}

const OUTCOME: [StateKey, string][] = [
  ["outcome.forgot", "Forgot"],
  ["outcome.struggled", "Struggled"],
  ["outcome.recalled", "Recalled"],
  ["outcome.mastered", "Mastered this attempt"],
];

/** A recall score 0–3 as the learner chose it (Revision spec §7). */
export function outcomePresentation(score: number): Presentation {
  const [state, label] = OUTCOME[Math.max(0, Math.min(3, Math.round(score)))];
  return present(state, label);
}

const CHECKPOINT: Record<"RECALLED" | "PARTIAL" | "NOT_RECALLED", [StateKey, string]> = {
  RECALLED: ["checkpoint.recalled", "Recalled it"],
  PARTIAL: ["checkpoint.partial", "Partly"],
  NOT_RECALLED: ["checkpoint.not-recalled", "Couldn't recall it"],
};
export function checkpointPresentation(result: keyof typeof CHECKPOINT): Presentation {
  const [state, label] = CHECKPOINT[result];
  return present(state, label);
}

/** The Revision tab indicator: overdue work outranks work due today. */
export function attentionPresentation(due: number, overdue: number): Presentation {
  if (overdue > 0) return present("attention.overdue", `${overdue} overdue`);
  if (due > 0) return present("attention.due", `${due} due`);
  return present("attention.none", "Nothing due");
}

/* ---------------- progression ---------------- */

export function districtPresentation(passed: boolean, current: boolean): Presentation {
  if (passed) return present("district.passed", "Passed");
  if (current) return present("district.current", "Current");
  return present("district.ahead", "Not reached");
}

export type StageStatus = "UPCOMING" | "ON_TRACK" | "BEHIND" | "DELAYED" | "COMPLETE";
export function stagePresentation(status: StageStatus, delayDays: number): Presentation {
  switch (status) {
    case "COMPLETE": return present("stage.complete", "Complete");
    case "DELAYED": return present("stage.delayed", delayDays > 0 ? `Delayed by ${plural(delayDays, "day")}` : "Delayed");
    case "BEHIND": return present("stage.behind", "Behind");
    case "ON_TRACK": return present("stage.on-track", "On track");
    default: return present("stage.upcoming", "Upcoming");
  }
}

/** A practice milestone can be overdue; a stage end is a date, so once passed it has simply ended. */
export function milestonePresentation(m: { type: "PRACTICE" | "STAGE_END"; date: ISODate; done: boolean }, today: ISODate): Presentation {
  if (m.done) return present("milestone.done", "Done");
  if (m.date < today) return m.type === "PRACTICE" ? present("milestone.overdue", "Overdue") : present("milestone.ended", "Ended");
  return present("milestone.planned", "Planned");
}

/* ---------------- cities ---------------- */

const CITY: Record<"DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED", [StateKey, string]> = {
  DRAFT: ["city.draft", "Draft: curriculum not approved yet"],
  ACTIVE: ["city.active", "Active"],
  PAUSED: ["city.paused", "Paused"],
  COMPLETED: ["city.completed", "Completed"],
  ARCHIVED: ["city.archived", "Archived"],
};
export function cityPresentation(status: keyof typeof CITY): Presentation {
  const [state, label] = CITY[status];
  return present(state, label);
}

/* ---------------- AI ---------------- */

export function evaluationPresentation(status: "PENDING" | "SUCCEEDED" | "FAILED"): Presentation {
  if (status === "FAILED") return present("ai.failed", "AI check failed");
  if (status === "PENDING") return present("ai.checking", "Checking…");
  return present("ai.suggestion", "AI suggestion");
}

/** The AI's suggested score: always the AI tone, so it never looks like the learner's own result. */
export function suggestionPresentation(score: number | null): Presentation | null {
  if (score === null) return null;
  return present("ai.suggestion", `Suggests ${score} · ${OUTCOME[Math.max(0, Math.min(3, score))][1]}`);
}

const VERDICT: Record<"COVERED" | "PARTIAL" | "MISSING" | "INCORRECT", [StateKey, string]> = {
  COVERED: ["verdict.covered", "Covered"],
  PARTIAL: ["verdict.partial", "Partly"],
  MISSING: ["verdict.missing", "Missing"],
  INCORRECT: ["verdict.incorrect", "Incorrect"],
};
export function verdictPresentation(v: keyof typeof VERDICT): Presentation {
  const [state, label] = VERDICT[v];
  return present(state, label);
}

/** GET /api/presentation: the versioned contract, for clients and documentation. */
export function presentationCatalog() {
  return { version: PRESENTATION_VERSION, tones: TONES, variants: VARIANTS, icons: ICONS, states: STATES };
}
