/**
 * Business checks after schema validation (AI design §6.4). Pure.
 *
 * Every quote the model gives must really be in the learner's answer. A claim that cannot be found is never allowed
 * to raise a score: an unverifiable COVERED or PARTIAL verdict is downgraded to MISSING, and an unverifiable
 * misconception is kept (it can only lower the suggestion, and the learner sees it and can disagree). If most quotes
 * cannot be found the model did not follow the instructions and the whole result is rejected.
 */
import type { EvaluationResult, Verdict } from "./schema.js";

export interface VerifiedCriterion {
  index: number;
  text: string;
  verdict: Verdict;
  evidence: string | null;
  /** The model's verdict before an unverifiable quote downgraded it. */
  claimedVerdict: Verdict;
  recoveredInFollowUp: boolean;
}

export interface VerifiedResult {
  relevant: boolean;
  criteria: VerifiedCriterion[];
  misconceptions: { claim: string; correction: string; verified: boolean }[];
  feedback: string;
  followUpQuestion: string | null;
  downgraded: number;
}

export class VerificationError extends Error {}

/** Lower-case, punctuation to spaces, collapsed whitespace: quotes survive casing and punctuation differences. */
export const normalise = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export const quoteFound = (quote: string, answer: string) => {
  const q = normalise(quote);
  return q.length > 0 && ` ${normalise(answer)} `.includes(` ${q} `);
};

export function verifyResult(r: EvaluationResult, criteria: string[], answer: string): VerifiedResult {
  const byIndex = new Map<number, EvaluationResult["criteria"][number]>();
  for (const c of r.criteria) {
    if (c.index >= criteria.length) throw new VerificationError(`Unknown criterion index ${c.index}`);
    if (byIndex.has(c.index)) throw new VerificationError(`Criterion ${c.index} judged twice`);
    byIndex.set(c.index, c);
  }
  if (byIndex.size !== criteria.length) throw new VerificationError("Not every criterion was judged");

  let quotes = 0;
  let missing = 0;
  let downgraded = 0;
  const verified: VerifiedCriterion[] = criteria.map((text, index) => {
    const c = byIndex.get(index)!;
    const needsEvidence = c.verdict === "COVERED" || c.verdict === "PARTIAL";
    if (c.evidence) quotes++;
    const found = c.evidence ? quoteFound(c.evidence, answer) : false;
    if (c.evidence && !found) missing++;
    if (needsEvidence && !found) {
      downgraded++;
      return { index, text, verdict: "MISSING", evidence: null, claimedVerdict: c.verdict, recoveredInFollowUp: false };
    }
    return { index, text, verdict: c.verdict, evidence: found ? c.evidence : null, claimedVerdict: c.verdict, recoveredInFollowUp: false };
  });

  const misconceptions = r.misconceptions.map((m) => {
    const ok = quoteFound(m.claim, answer);
    quotes++;
    if (!ok) missing++;
    return { claim: m.claim, correction: m.correction, verified: ok };
  });
  if (quotes >= 2 && missing / quotes > 0.5) throw new VerificationError("Most quoted evidence is not in the answer");

  const allCovered = verified.every((c) => c.verdict === "COVERED") && misconceptions.length === 0;
  let followUpQuestion = allCovered ? null : (r.followUpQuestion?.trim() || null);
  // A follow-up must not give the answer away: drop it if it repeats a criterion word for word.
  if (followUpQuestion && criteria.some((c) => normalise(c).length >= 12 && normalise(followUpQuestion!).includes(normalise(c)))) followUpQuestion = null;

  return { relevant: r.relevant, criteria: verified, misconceptions, feedback: r.feedback.trim(), followUpQuestion, downgraded };
}
