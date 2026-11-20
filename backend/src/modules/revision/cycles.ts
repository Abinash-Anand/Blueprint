/**
 * Revision v2, phase 2: the learning model in code (docs/Revision-v2-Plan.md §4.2, §4.3, §6). No database and no AI:
 * which questions a topic gets today, how a session is filled and ordered, how a concept's answers roll up into one
 * result, and how a topic moves through its six cycles. Everything here is deterministic and unit-tested.
 */
import { type ISODate, addDays, diffDays } from "../../domain/dates.js";

/* ---------------- constants (plan §4.2, §6) ---------------- */

export const CYCLES = 6;
/** Days from finishing cycle k to cycle k + 1 being due. */
export const GAP_AFTER: Record<number, number> = { 1: 3, 2: 7, 3: 14, 4: 30, 5: 60 };
/** Question levels each cycle asks (per concept, before adaptation). */
export const CYCLE_LEVELS: Record<number, number[]> = { 1: [1, 2], 2: [2, 3], 3: [3], 4: [4], 5: [5], 6: [6] };
/** Questions per topic in one session. */
export const TOPIC_CAP = 5;
/** Sessions are filled to this share of the budget; the rest is buffer. */
export const FILL = 0.85;
/** The optional maintenance check after cycle 6 (plan §4.2: every 3 to 6 months). */
export const MAINTENANCE_DAYS = 120;
/** Weak retry: days until a concept that is still weak is asked again (Forgot, Struggled). */
export const RETRY_DAYS = { forgot: 1, struggled: 2 } as const;

export const RESULT = { FORGOT: 0, STRUGGLED: 1, RECALLED: 2, STRONG: 3 } as const;
export const RESULT_LABEL = ["Forgot", "Struggled", "Recalled", "Strong recall"] as const;
const RESULT_WORD = ["forgot", "struggled", "recalled", "strong"] as const;

/** Minutes per question including feedback (plan §6). */
export function itemMinutes(kind: string, format: string) {
  if (format !== "OPEN") return 1;
  if (kind === "RECALL") return 2;
  if (["EXPLAIN", "PREDICT", "SCENARIO"].includes(kind)) return 4;
  if (["SPOT_ERROR", "DEBUG", "COMPARE"].includes(kind)) return 6;
  return 8; // JUDGE, APPLY, TRANSFER
}

/* ---------------- choosing questions ---------------- */

export interface PlanItem { id: number; level: number; kind: string; format: string }
export interface PlanConcept {
  id: number;
  position: number;
  items: PlanItem[];
  /** Latest result in the previous cycle, or null. */
  previous: number | null;
  /** Latest result in the cycle in progress, or null when not yet reviewed in it. */
  current: number | null;
}
export interface PlanTrack { cycle: number; weakOnly: boolean; /** A retained topic's maintenance check: every concept once more. */ maintenance?: boolean }
/** reused: every question near the wanted level had been asked already, so one is asked again (plan §5.2). */
export interface PlannedQuestion { itemId: number; conceptId: number; level: number; minutes: number; reused: boolean }

/**
 * The levels to ask a concept in cycle k, most wanted first (plan §4.3): struggling concepts stay a level lower, strong
 * ones move a level up; never beyond the pack's highest level.
 */
export function conceptLevels(cycle: number, previous: number | null, top: number) {
  const base = CYCLE_LEVELS[Math.min(Math.max(cycle, 1), CYCLES)];
  const shift = previous === null ? 0 : previous <= RESULT.STRUGGLED ? -1 : previous === RESULT.STRONG ? 1 : 0;
  const clamp = (l: number) => Math.min(top, Math.max(1, l));
  return [...new Set(base.map((l) => clamp(l + shift)))];
}

/**
 * One unused question at the wanted level and format, else the nearest level (plan §5.2); when everything near has
 * been asked, the question asked least often.
 */
export function pickItem(items: PlanItem[], level: number, format: "OPEN" | "CHOICE", uses: Map<number, number>, exclude: Set<number>) {
  const fits = (i: PlanItem) => (format === "OPEN" ? i.format === "OPEN" : i.format !== "OPEN");
  const pool = items.filter((i) => !exclude.has(i.id));
  const byDistance = (xs: PlanItem[]) => [...xs].sort((a, b) => Math.abs(a.level - level) - Math.abs(b.level - level) || a.level - b.level || a.id - b.id);
  const unused = byDistance(pool.filter((i) => !uses.get(i.id)));
  const pick = unused.find(fits) ?? (format === "OPEN" ? undefined : unused[0]);
  if (pick) return pick;
  const least = [...pool].filter(fits).sort((a, b) => (uses.get(a.id) ?? 0) - (uses.get(b.id) ?? 0) || Math.abs(a.level - level) - Math.abs(b.level - level));
  return least[0] ?? byDistance(pool)[0] ?? null;
}

/**
 * Today's questions for one topic (plan §6): the concepts not yet reviewed in the cycle in progress, weak ones first;
 * on a weak retry only the concepts still weak. Cycle 1 and struggling concepts get two questions (multiple choice,
 * then an open one a level up), the others one open question. At most TOPIC_CAP questions; a concept's questions are
 * never split across sessions, and the rest of the cycle continues next time.
 */
export function planTopic(track: PlanTrack, concepts: PlanConcept[], top: number, uses: Map<number, number>): PlannedQuestion[] {
  const k = Math.min(track.cycle + 1, CYCLES);
  const live = concepts.filter((c) => c.items.length > 0);
  const pending = track.maintenance ? [...live] : live.filter((c) => (track.weakOnly ? c.current !== null && c.current <= RESULT.STRUGGLED : c.current === null));
  const weak = (c: PlanConcept) => (c.current ?? c.previous ?? RESULT.RECALLED) <= RESULT.STRUGGLED;
  pending.sort((a, b) => Number(weak(b)) - Number(weak(a)) || a.position - b.position);
  const out: PlannedQuestion[] = [];
  const taken = new Set<number>();
  for (const c of pending) {
    const levels = conceptLevels(k, c.current ?? c.previous, top);
    const pair = !track.maintenance && (k === 1 || weak(c));
    const wanted: { level: number; format: "OPEN" | "CHOICE" }[] = pair
      ? [{ level: levels[0], format: "CHOICE" }, { level: levels[levels.length - 1], format: "OPEN" }]
      : [{ level: levels[levels.length - 1], format: "OPEN" }];
    if (out.length && out.length + wanted.length > TOPIC_CAP) break;
    for (const w of wanted) {
      const it = pickItem(c.items, w.level, w.format, uses, taken);
      if (!it) continue;
      taken.add(it.id);
      out.push({ itemId: it.id, conceptId: c.id, level: it.level, minutes: itemMinutes(it.kind, it.format), reused: (uses.get(it.id) ?? 0) > 0 });
    }
    if (out.length >= TOPIC_CAP) break;
  }
  return out;
}

/* ---------------- the session ---------------- */

export interface TopicCandidate { topicId: string; due: ISODate; weak: boolean; questions: PlannedQuestion[] }
export interface QueueEntry { itemId: number; conceptId: number; topicId: string; cycle: number; minutes: number; relearn: boolean; hintsUsed?: number; reused?: boolean }

/**
 * A session within the budget (plan §6): overdue topics first, then weak ones, then those due today; whole topics
 * until about 85 % of the budget is used (always at least one), then the questions interleaved across topics.
 */
export function planSession(candidates: (TopicCandidate & { cycle: number })[], budgetMinutes: number) {
  const ordered = [...candidates].filter((c) => c.questions.length).sort((a, b) => a.due.localeCompare(b.due) || Number(b.weak) - Number(a.weak) || a.topicId.localeCompare(b.topicId));
  const limit = budgetMinutes * FILL;
  const chosen: typeof ordered = [];
  let minutes = 0;
  for (const c of ordered) {
    const m = c.questions.reduce((a, q) => a + q.minutes, 0);
    if (chosen.length && minutes + m > limit) continue;
    chosen.push(c);
    minutes += m;
  }
  const queue: QueueEntry[] = [];
  for (let i = 0; chosen.some((c) => i < c.questions.length); i++)
    for (const c of chosen) {
      const q = c.questions[i];
      if (q) queue.push({ itemId: q.itemId, conceptId: q.conceptId, topicId: c.topicId, cycle: Math.min(c.cycle + 1, CYCLES), minutes: q.minutes, relearn: false, reused: q.reused });
    }
  return { queue, minutes, topics: chosen.map((c) => c.topicId), left: ordered.length - chosen.length };
}

/* ---------------- results ---------------- */

/**
 * The result a learner is offered for one answer (plan §3.4, §4.3). Multiple choice: right is Recalled (it can never
 * show Strong recall on its own), wrong is Forgot. Open: the AI check's suggestion. Hints cap it: one hint at
 * Recalled, all three at Struggled.
 */
export function suggestResult(a: { format: string; correct: boolean | null; aiScore: number | null; hintsUsed: number }) {
  let r: number | null = a.format === "OPEN" ? a.aiScore : a.correct ? RESULT.RECALLED : RESULT.FORGOT;
  if (r === null) return null;
  if (a.hintsUsed >= 3) r = Math.min(r, RESULT.STRUGGLED);
  else if (a.hintsUsed >= 1) r = Math.min(r, RESULT.RECALLED);
  return r;
}

export interface AnsweredQuestion { conceptId: number; format: string; final: number; relearn: boolean }

/**
 * One concept's result in this review (plan §4.3, §4.4): the weakest of its answers; Strong recall needs an answer in
 * the learner's own words (multiple choice alone gives at most Recalled); an easier question answered right at the end
 * of the session lifts a missed concept to Recalled (relearn before you leave, §3.4).
 */
export function rollUp(answers: AnsweredQuestion[]) {
  const out = new Map<number, { result: number; firstResult: number }>();
  const by = new Map<number, AnsweredQuestion[]>();
  for (const a of answers) by.set(a.conceptId, [...(by.get(a.conceptId) ?? []), a]);
  for (const [id, xs] of by) {
    const main = xs.filter((x) => !x.relearn);
    if (!main.length) continue;
    // Any miss decides. Otherwise the open answers do: a right multiple choice is Recalled by definition and must not
    // hide a Strong answer in the learner's own words; without an open answer the concept is at most Recalled.
    let first = Math.min(...main.map((x) => x.final));
    if (first >= RESULT.RECALLED) {
      const open = main.filter((x) => x.format === "OPEN");
      first = open.length ? Math.min(...open.map((x) => x.final)) : Math.min(first, RESULT.RECALLED);
    }
    const relearned = xs.filter((x) => x.relearn).some((x) => x.final >= RESULT.RECALLED);
    out.set(id, { firstResult: first, result: first <= RESULT.STRUGGLED && relearned ? RESULT.RECALLED : first });
  }
  return out;
}

/* ---------------- cycles and dates (plan §4.2) ---------------- */

export interface TrackState { cycle: number; state: "ACTIVE" | "RETAINED"; nextDueDate: ISODate | null; weakOnly: boolean }

/**
 * After a review: `latest` is every live concept's latest result in the cycle in progress (null when not reviewed in
 * it yet). All reviewed and all at Recalled or better: the cycle is done and the next one is due after its gap (less
 * when the review was early); after cycle 6 the topic is retained. Some still weak: a weak-only retry in 1–2 days,
 * which does not count as a cycle. Some not reviewed yet: the cycle continues tomorrow.
 */
export function advanceTrack(t: TrackState, latest: (number | null)[], today: ISODate, dueDate: ISODate | null, gap?: (cycle: number) => number): TrackState {
  const k = Math.min(t.cycle + 1, CYCLES);
  if (latest.some((r) => r === null)) return { ...t, nextDueDate: addDays(today, 1), weakOnly: false };
  const results = latest as number[];
  if (results.every((r) => r >= RESULT.RECALLED)) {
    if (k >= CYCLES) return { cycle: CYCLES, state: "RETAINED", nextDueDate: null, weakOnly: false };
    const early = dueDate && dueDate > today ? diffDays(today, dueDate) : 0;
    return { cycle: k, state: "ACTIVE", nextDueDate: addDays(today, Math.max(1, (gap ? gap(k) : GAP_AFTER[k]) - early)), weakOnly: false };
  }
  const forgot = results.some((r) => r === RESULT.FORGOT);
  return { ...t, nextDueDate: addDays(today, forgot ? RETRY_DAYS.forgot : RETRY_DAYS.struggled), weakOnly: true };
}

/** First due date of a topic's first cycle (plan §4.2): the day after its first sub-topic was learned, not before today. */
export function firstDue(firstLearned: ISODate | null, today: ISODate): ISODate | null {
  if (!firstLearned) return null;
  const d = addDays(firstLearned, 1);
  return d < today ? today : d;
}

/** "Cold vs hot: struggled in cycles 1–2, recalled in 3." from a concept's results by cycle (plan §3.6). */
export function storyLine(title: string, byCycle: { cycle: number; result: number }[]) {
  const xs = [...byCycle].sort((a, b) => a.cycle - b.cycle);
  if (!xs.length) return `${title}: not revised yet.`;
  const runs: { word: string; from: number; to: number }[] = [];
  for (const x of xs) {
    const w = RESULT_WORD[x.result];
    const last = runs[runs.length - 1];
    if (last && last.word === w && last.to === x.cycle - 1) last.to = x.cycle;
    else runs.push({ word: w, from: x.cycle, to: x.cycle });
  }
  const part = (r: (typeof runs)[number], i: number) =>
    `${r.word} in ${i === 0 ? (r.from === r.to ? "cycle " : "cycles ") : ""}${r.from === r.to ? r.from : `${r.from}–${r.to}`}`;
  return `${title}: ${runs.map(part).join(", ")}.`;
}

/* ---------------- adaptive intervals (plan §11, phase 4) ---------------- */

/** One reviewed concept in one session: its result, its first result (before relearning), hints used, how sure the learner was. */
export type ConceptEvidence = { result: number; firstResult: number; hints: number; confidence: number | null };

/** Bounds of the adjustment, and how many reviews of a concept count as full evidence. */
export const ADAPT = { min: 0.5, max: 1.5, reviews: 3 } as const;

/**
 * How one review stretches or shrinks the next gap: the first attempt counts (relearning helps today, not the interval),
 * Strong recall grows it, Recalled keeps it, Struggled and Forgot shrink it; each hint (up to three) takes 10 % off, and
 * being sure about a miss takes another 10 % (the learner thinks they know it).
 */
export function reviewFactor(e: ConceptEvidence): number {
  const r = Math.min(e.result, e.firstResult);
  let f = [0.5, 0.7, 1, 1.3][r] ?? 1;
  f *= 1 - 0.1 * Math.min(e.hints, 3);
  if (e.confidence === 3 && r <= RESULT.STRUGGLED) f *= 0.9;
  return f;
}

/**
 * A concept's own pace from its last three reviews (oldest first): the geometric mean of their factors, kept within
 * ±50 %, and weighted by how much evidence there is, so a concept with one review moves the gap only a third of the way.
 */
export function conceptPace(history: ConceptEvidence[]): number {
  const last = history.slice(-ADAPT.reviews);
  if (!last.length) return 1;
  const mean = Math.exp(last.reduce((a, e) => a + Math.log(reviewFactor(e)), 0) / last.length);
  const factor = Math.min(ADAPT.max, Math.max(ADAPT.min, mean));
  return 1 + (last.length / ADAPT.reviews) * (factor - 1);
}

/**
 * The gap before the next cycle, adapted to the topic's concepts (FSRS-style in spirit: each concept's own record sets
 * its pace, without fitted weights): the fixed gap times the slowest concept's pace, so the weakest concept decides
 * when the topic comes back. With the reason, for the completion card.
 */
export function adaptiveGap(fixed: number, concepts: { title: string; history: ConceptEvidence[] }[]): { days: number; fixed: number; reason: string | null } {
  if (!concepts.length) return { days: fixed, fixed, reason: null };
  const paced = concepts.map((c) => ({ ...c, pace: conceptPace(c.history) }));
  const slowest = paced.reduce((a, b) => (b.pace < a.pace ? b : a));
  const days = Math.max(1, Math.round(fixed * slowest.pace));
  if (days === fixed) return { days, fixed, reason: null };
  if (days > fixed) return { days, fixed, reason: "every concept recalled well" };
  const last = slowest.history[slowest.history.length - 1];
  const why = !last ? "" : Math.min(last.result, last.firstResult) <= RESULT.STRUGGLED ? "was shaky" : last.hints > 0 ? "needed hints" : "was shaky earlier";
  return { days, fixed, reason: `${slowest.title} ${why}`.trim() };
}
