/**
 * Recall rules in code (docs/Recall-Plan.md §4.2, §5.4, §6): no AI here. The grading model only labels each checklist
 * point; everything below turns those labels into a score, a depth level, a result and the next date, and checks that
 * the model's quotes really are the learner's words. Pure and deterministic.
 */
import { type ISODate, addDays } from "../../domain/dates.js";
import { normalise } from "../ai/evaluation/verify.js";

export type PointStatus = "ACCURATE" | "PARTIAL" | "MISSED";
export type Depth = "FOUNDATIONAL" | "INTERMEDIATE" | "MASTERY";
export type Outcome = "PASS" | "HOLD" | "LAPSE";

export const RULES = {
  /** Checklist size and tiers (§4.1). */
  minPoints: 6,
  maxPoints: 8,
  /** Tier 3 (pitfalls, trade-offs) at most twice: the checklist is the core of the sub-topic, not its corners. */
  maxTier3: 2,
  /** Score (§6.1). */
  credit: { ACCURATE: 1, PARTIAL: 0.5, MISSED: 0 } as Record<PointStatus, number>,
  /**
   * Only these tiers make the score (decided 21 Nov 2026, Recall-Plan §14): tier 3 (pitfalls, trade-offs) decides
   * Mastery depth instead, so a strong explanation of the core is not held back by two edge cases.
   */
  scoredTiers: [1, 2] as readonly number[],
  misconceptionPenalty: 0.15,
  /** Depth (§6.2): a tier counts when at least this share of its weight is earned. */
  tierShare: 0.7,
  /** Results (§6.3). */
  passScore: 0.75,
  holdScore: 0.5,
  /** Gaps in days for stages 1–5; from stage 6 the previous gap × growth, at most maxGap. */
  gaps: [1, 2, 4, 7, 15],
  growth: 2.2,
  maxGap: 180,
  /** Minutes one review takes, for the daily limit (§3.1). */
  minutesPerReview: 8,
} as const;

/* ---------------- score and depth ---------------- */

export interface ScoredPoint { tier: number; weight: number; status: PointStatus }

/**
 * Weighted share of the tier 1 and 2 points, less 0.15 per misconception, never below 0 (§6.1, §14). Tier 3 counts
 * toward depth only; a checklist with no tier 1 or 2 point is scored on all its points. Left-out points are not passed in.
 */
export function recallScore(points: ScoredPoint[], misconceptions: number): number {
  const core = points.filter((p) => RULES.scoredTiers.includes(p.tier));
  const scored = core.length ? core : points;
  const total = scored.reduce((a, p) => a + p.weight, 0);
  if (!total) return 0;
  const earned = scored.reduce((a, p) => a + p.weight * RULES.credit[p.status], 0);
  return Math.max(0, Math.round((earned / total - RULES.misconceptionPenalty * misconceptions) * 1000) / 1000);
}

/** Each tier's earned share on its own (null when the checklist has no point of that tier). */
export function tierShares(points: ScoredPoint[]): (number | null)[] {
  return [1, 2, 3].map((tier) => {
    const xs = points.filter((p) => p.tier === tier);
    const total = xs.reduce((a, p) => a + p.weight, 0);
    return total ? xs.reduce((a, p) => a + p.weight * RULES.credit[p.status], 0) / total : null;
  });
}

/** Mastery: tiers 1, 2 and 3 each ≥ 70 %; Intermediate: tiers 1 and 2; otherwise Foundational (§6.2). A missing tier counts as met. */
export function depthOf(points: ScoredPoint[]): Depth {
  const [t1, t2, t3] = tierShares(points).map((x) => x === null || x >= RULES.tierShare);
  if (t1 && t2 && t3) return "MASTERY";
  if (t1 && t2) return "INTERMEDIATE";
  return "FOUNDATIONAL";
}

/* ---------------- result and schedule ---------------- */

/** Pass: ≥ 75 % and no misconception; Hold: 50–74 %, or ≥ 75 % with a misconception; Lapse: < 50 % (§6.3). */
export function outcomeOf(score: number, misconceptions: number): Outcome {
  if (score >= RULES.passScore && misconceptions === 0) return "PASS";
  if (score >= RULES.holdScore) return "HOLD";
  return "LAPSE";
}

/**
 * The gap in days for a stage (§6.3): 1, 2, 4, 7, 15, then each stage 2.2 × the one before (33, 73, 160), at most
 * 180. A function of the stage alone, so a lapse shortens the gap as surely as a pass lengthens it.
 */
export function gapFor(stage: number): number {
  if (stage <= 0) return 1;
  if (stage <= RULES.gaps.length) return RULES.gaps[stage - 1];
  const last = RULES.gaps[RULES.gaps.length - 1];
  return Math.min(RULES.maxGap, Math.round(last * RULES.growth ** (stage - RULES.gaps.length)));
}

export interface RecallSchedule { stage: number; nextDueDate: ISODate; gap: number }

/**
 * The next stage and date after a review on `reviewed` (the day it was actually done): Pass +1, Hold unchanged (at
 * least 1), Lapse back two stages (at least 1). The gap is counted from the review day.
 */
export function nextSchedule(stage: number, outcome: Outcome, reviewed: ISODate): RecallSchedule {
  const next = outcome === "PASS" ? stage + 1 : outcome === "HOLD" ? Math.max(1, stage) : Math.max(1, stage - 2);
  const gap = gapFor(next);
  return { stage: next, nextDueDate: addDays(reviewed, gap), gap };
}

/** How many reviews fit in a day: the daily revision minutes ÷ 8, at least 1 (§3.1). */
export const dailyLimit = (dailyMinutes: number) => Math.max(1, Math.floor(dailyMinutes / RULES.minutesPerReview));

/* ---------------- the grader's reply ---------------- */

export interface GradedPoint { code: string; status: PointStatus; evidence: string | null }
export interface GradeReply { points: GradedPoint[]; misconceptions: { claim: string; correction: string }[] }

export class GradeError extends Error {}

const words = (s: string) => normalise(s).split(" ").filter(Boolean);

/** Where a quote part sits in the explanation's words (searching from `from`): [first, end) word indexes, or null. */
function findPart(part: string[], text: string[], from: number): [number, number] | null {
  // Short parts (one or two words) must be exact and contiguous.
  if (part.length < 3) {
    for (let i = from; i + part.length <= text.length; i++) if (part.every((w, k) => text[i + k] === w)) return [i, i + part.length];
    return null;
  }
  // Longer parts: at least 80 % of their words, in order, within a window not much longer than the part.
  const need = Math.ceil(part.length * 0.8);
  const span = Math.ceil(part.length * 1.25) + 2;
  for (let i = from; i < text.length; i++) {
    if (text[i] !== part[0] && text[i] !== part[1]) continue;
    const end = Math.min(text.length, i + span);
    let at = i, matched = 0, first = -1, last = i;
    for (const w of part) {
      let j = at;
      while (j < end && text[j] !== w) j++;
      if (j < end) {
        matched++;
        if (first < 0) first = j;
        at = j + 1;
        last = j + 1;
      }
    }
    if (matched >= need) return [first, last];
  }
  return null;
}

/** Where each part of a quote sits in `text`'s words, in order, or null when it is not there (quoteMatches). */
function quoteParts(quote: string, text: string[]): [number, number][] | null {
  const parts = quote.split(/\.{3,}|…/).map(words).filter((p) => p.length);
  if (!parts.length) return null;
  const found: [number, number][] = [];
  let from = 0;
  for (const p of parts) {
    const at = findPart(p, text, from);
    if (!at) return null;
    found.push(at);
    from = at[1];
  }
  return found;
}

/**
 * Whether a quote is the learner's own words (§5.4), tolerant of how models quote but not of invention: case and
 * punctuation are ignored; an elision ("…" or "...") splits the quote into parts that must each be found, in order;
 * a part of three words or more may miss up to 20 % of its words (a slip in copying), but only within a window of the
 * explanation not much longer than the part; one- and two-word parts must be exact.
 */
export function quoteMatches(quote: string, text: string): boolean {
  return quoteParts(quote, words(text)) !== null;
}

/** A stretch of the graded text, as character offsets: [start, end). */
export interface TextRange { start: number; end: number }

/** The text's words with where each came from: every run of letters and digits, normalised like `words`. */
function located(text: string) {
  const ws: { w: string; start: number; end: number }[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    for (const w of normalise(m[0]).split(" ").filter(Boolean)) ws.push({ w, start: m.index, end: m.index + m[0].length });
  }
  return ws;
}

/** Unquoted sentences shorter than this many words are not worth showing ("Also in your answer"). */
export const UNCOVERED_MIN_WORDS = 4;

/** Whether the text between two words ends a sentence: a full stop, question or exclamation mark before a space, or a line break. */
const SENTENCE_BREAK = /[.!?]["'”’)\]*_]*\s|\n/;

/**
 * Where the learner's quoted words are in the graded text, for showing them (never for grading): each quote's
 * stretches, found the way quoteMatches finds them (a quote with an elision has one stretch per part; a quote
 * that is not found has none), and the sentences of at least UNCOVERED_MIN_WORDS words that contain no quoted word
 * at all. A sentence that holds a quote is the learner's explanation of that point, so it is not listed.
 */
export function answerSpans(text: string, quotes: string[]): { quotes: TextRange[][]; uncovered: TextRange[] } {
  const ws = located(text);
  const plain = ws.map((x) => x.w);
  const covered = new Array<boolean>(ws.length).fill(false);
  const found = quotes.map((q) => {
    const parts = q.trim() ? quoteParts(q, plain) : null;
    return (parts ?? []).map(([a, b]) => {
      for (let i = a; i < b; i++) covered[i] = true;
      return { start: ws[a].start, end: ws[b - 1].end };
    });
  });
  const uncovered: TextRange[] = [];
  for (let i = 0; i < ws.length; ) {
    let j = i + 1;
    while (j < ws.length && !SENTENCE_BREAK.test(text.slice(ws[j - 1].end, ws[j].start))) j++;
    if (j - i >= UNCOVERED_MIN_WORDS && !covered.slice(i, j).some(Boolean)) {
      // The sentence's own closing mark comes along (not the space or line after it).
      const close = /^[.!?]+/.exec(text.slice(ws[j - 1].end))?.[0].length ?? 0;
      uncovered.push({ start: ws[i].start, end: ws[j - 1].end + close });
    }
    i = j;
  }
  return { quotes: found, uncovered };
}

/**
 * Checks the grader's reply against the checklist and the explanation (§5.4): exactly one result per point, known
 * codes only; a missed point has no evidence; every quote must be the learner's words (quoteMatches), otherwise that
 * point becomes missed; a misconception whose claim is not quoted from the explanation is dropped. Returns the verified
 * results in checklist order and how many quotes were rejected.
 */
export function verifyGrade(reply: GradeReply, codes: string[], explanation: string): GradeReply & { rejectedQuotes: number } {
  const seen = new Map<string, GradedPoint>();
  for (const p of reply.points) {
    if (!codes.includes(p.code)) throw new GradeError(`Unknown point ${p.code}`);
    if (seen.has(p.code)) throw new GradeError(`Point ${p.code} graded twice`);
    seen.set(p.code, p);
  }
  if (seen.size !== codes.length) throw new GradeError("Not every point was graded");
  let rejectedQuotes = 0;
  const points = codes.map((code): GradedPoint => {
    const p = seen.get(code)!;
    if (p.status === "MISSED") return { code, status: "MISSED", evidence: null };
    const quote = (p.evidence ?? "").trim();
    if (!quote || !quoteMatches(quote, explanation)) {
      rejectedQuotes++;
      return { code, status: "MISSED", evidence: null };
    }
    return { code, status: p.status, evidence: quote };
  });
  const misconceptions = reply.misconceptions
    .filter((m) => m.claim.trim() && m.correction.trim() && quoteMatches(m.claim, explanation))
    .slice(0, 5);
  return { points, misconceptions, rejectedQuotes };
}

/* ---------------- the checklist ---------------- */

export interface DraftPoint { label: string; description: string; tier: number }

/** Problems with a drafted checklist (§4.2); empty when it can be locked. */
export function checklistProblems(points: DraftPoint[], otherSubtopics: string[]): string[] {
  const problems: string[] = [];
  if (points.length < RULES.minPoints || points.length > RULES.maxPoints) problems.push(`write ${RULES.minPoints}–${RULES.maxPoints} points (wrote ${points.length})`);
  const tiers = points.map((p) => p.tier);
  if (tiers.some((t) => ![1, 2, 3].includes(t))) problems.push("every tier must be 1, 2 or 3");
  if (!tiers.includes(1)) problems.push("include tier 1 points (definition and purpose)");
  if (!tiers.includes(2)) problems.push("include tier 2 points (how it works and is used)");
  if (tiers.filter((t) => t === 3).length > RULES.maxTier3) problems.push(`write at most ${RULES.maxTier3} tier 3 points`);
  if (tiers.some((t, i) => i > 0 && t < tiers[i - 1])) problems.push("order the points by tier: 1, then 2, then 3");
  const labels = points.map((p) => normalise(p.label));
  if (new Set(labels).size !== labels.length) problems.push("every label must be different");
  if (points.some((p) => !p.label.trim() || !p.description.trim())) problems.push("every point needs a label and a description");
  const others = otherSubtopics.map(normalise).filter((x) => x.length > 3);
  for (const p of points) if (others.includes(normalise(p.label))) problems.push(`"${p.label}" is another sub-topic of this topic`);
  for (const u of umbrellaPoints(points))
    problems.push(`"${u.point.label}" only sums up points already on the list (${u.parts.map((x) => `"${x}"`).join(", ")}): leave it out`);
  return problems;
}

/** A count in a label or description: "three kinds", "both", "2 ways"; English and German, the checklist languages. */
const COUNTED = /(^|[^\p{L}\p{N}])(two|three|four|five|six|both|zwei|drei|vier|fünf|sechs|beide[nrs]?|[2-6])([^\p{L}\p{N}]|$)|\b(types|kinds|forms|ways) of\b|\b(arten|formen) (von|der|des)\b/iu;
const stemsMatch = (a: string, b: string) => {
  const n = Math.min(5, a.length);
  return b.length >= n && a.slice(0, n) === b.slice(0, n);
};

/**
 * Umbrella points (checklist prompt v3): a point that counts things ("the three kinds of X") and whose description
 * names two or more other points by what sets each apart. Each point's distinctive words are the words of its label
 * that no other label uses, so words several labels share, such as "role" or "callback", never count. Works on the
 * words alone, with no knowledge of the subject.
 */
export function umbrellaPoints(points: DraftPoint[]): { point: DraftPoint; parts: string[] }[] {
  const labelWords = points.map((p) => [...contentWords(p.label)]);
  const distinctive = labelWords.map((ws, i) => ws.filter((w) => labelWords.every((xs, j) => j === i || !xs.includes(w))));
  const out: { point: DraftPoint; parts: string[] }[] = [];
  points.forEach((u, i) => {
    if (!COUNTED.test(`${u.label} ${u.description}`)) return;
    const said = [...contentWords(u.description)];
    const own = new Set(labelWords[i]);
    const parts = points.filter((_, j) => j !== i && distinctive[j].some((w) => !own.has(w) && said.some((x) => stemsMatch(w, x))));
    if (parts.length >= 2) out.push({ point: u, parts: parts.map((p) => p.label) });
  });
  return out;
}

/* ---------------- phase 2: the follow-up and progress over time ---------------- */

export type CuedRating = "Strong" | "Developing" | "Needs Work";

/**
 * How well the learner reasoned when asked (the senior engineer's follow-up): the share of the points missed on
 * their own that they explained when prompted. Strong ≥ 2/3, Developing ≥ 1/3, else Needs Work; null when there was
 * nothing to ask or the follow-up was skipped. It never changes the score, the result or the date.
 */
export function cuedRating(missed: number, recalledWhenAsked: number, answered: boolean): CuedRating | null {
  if (!answered || missed === 0) return null;
  const share = recalledWhenAsked / missed;
  return share >= 2 / 3 ? "Strong" : share >= 1 / 3 ? "Developing" : "Needs Work";
}

/** One completed review of a sub-topic, by checklist point id. */
export interface AttemptView {
  attempt: number;
  date: ISODate;
  score: number;
  depth: Depth;
  points: Record<number, { status: PointStatus; recalledWhenAsked: boolean }>;
  /** The misconceptions the check found in this review (verified quotes only). */
  misconceptions?: { claim: string; correction: string }[];
}
export interface PointRef { pointId: number; label: string }
export interface RecurringMisconception { claim: string; correction: string; seenBefore: number }
export interface SessionDiff {
  attempt: number;
  previousAttempt: number | null;
  scoreDelta: number | null;
  newlyMastered: PointRef[];
  retained: PointRef[];
  regressed: (PointRef & { from: PointStatus; to: PointStatus })[];
  persistentBlindSpots: (PointRef & { missedInARow: number })[];
  /** Mistakes in this review that were already corrected in an earlier one (plan §7: "whether a misconception came back"). */
  recurringMisconceptions: RecurringMisconception[];
  scoreTrajectory: { attempt: number; date: ISODate; score: number; depth: Depth }[];
}

const STOP = new Set("the and that this with from into for are was were not but can its it's they them their than then when what which while does doesn has have had you your about only also just more most very each every some any all one two".split(" "));
const contentWords = (s: string) => new Set(s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((w) => w.length >= 3 && !STOP.has(w)));

/**
 * Whether two misconceptions are the same mistake, from the words of the claim and the correction: at least 60 % of
 * the shorter one's words appear in the other (and at least three shared words). Free text, so this is deliberately
 * strict: a different mistake about the same point should not count as "came back".
 */
export function sameMisconception(a: { claim: string; correction: string }, b: { claim: string; correction: string }): boolean {
  const x = contentWords(`${a.claim} ${a.correction}`), y = contentWords(`${b.claim} ${b.correction}`);
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  if (!small.size) return false;
  let shared = 0;
  for (const w of small) if (big.has(w)) shared++;
  return shared >= 3 && shared / small.size >= 0.6;
}

/**
 * The deterministic diff between the latest review and the ones before it (plan §7), over the points of the same
 * checklist: newly mastered (missed or partial → accurate), retained (accurate → accurate), regressed (accurate →
 * partial or missed), persistent blind spots (missed in 2+ consecutive reviews up to now), and the score over time.
 * `history` is oldest first and ends with the current review.
 */
export function computeSessionDiff(history: AttemptView[], labels: Map<number, string>): SessionDiff {
  const current = history[history.length - 1];
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const ref = (pointId: number): PointRef => ({ pointId, label: labels.get(pointId) ?? `point ${pointId}` });
  const ids = Object.keys(current.points).map(Number).filter((id) => labels.has(id));
  const newlyMastered: PointRef[] = [], retained: PointRef[] = [], regressed: SessionDiff["regressed"] = [], persistentBlindSpots: SessionDiff["persistentBlindSpots"] = [];
  for (const id of ids) {
    const now = current.points[id].status;
    const before = previous?.points[id]?.status;
    if (before) {
      if (now === "ACCURATE" && before !== "ACCURATE") newlyMastered.push(ref(id));
      else if (now === "ACCURATE" && before === "ACCURATE") retained.push(ref(id));
      else if (before === "ACCURATE" && now !== "ACCURATE") regressed.push({ ...ref(id), from: before, to: now });
    }
    let run = 0;
    for (let i = history.length - 1; i >= 0 && history[i].points[id]?.status === "MISSED"; i--) run++;
    if (run >= 2) persistentBlindSpots.push({ ...ref(id), missedInARow: run });
  }
  const earlier = history.slice(0, -1);
  const recurringMisconceptions: RecurringMisconception[] = [];
  for (const m of current.misconceptions ?? []) {
    const seenBefore = earlier.filter((h) => (h.misconceptions ?? []).some((o) => sameMisconception(m, o))).length;
    if (seenBefore) recurringMisconceptions.push({ claim: m.claim, correction: m.correction, seenBefore });
  }
  return {
    attempt: current.attempt,
    previousAttempt: previous?.attempt ?? null,
    scoreDelta: previous ? Math.round((current.score - previous.score) * 1000) / 1000 : null,
    newlyMastered, retained, regressed, persistentBlindSpots, recurringMisconceptions,
    scoreTrajectory: history.map((h) => ({ attempt: h.attempt, date: h.date, score: h.score, depth: h.depth })),
  };
}

/* ---------------- phase 3: sketch photos ---------------- */

export type ImageType = "image/png" | "image/jpeg" | "image/webp";
/** A photo's type from its first bytes (not its name or declared type), or null if it is not PNG, JPEG or WebP. */
export function imageType(buf: Buffer): ImageType | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}
