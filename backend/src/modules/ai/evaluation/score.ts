/**
 * Suggested score from criteria verdicts (AI design §6.4). Pure, so it is repeatable and testable without a model.
 * The learner always chooses the saved score; this is only the suggestion shown next to it.
 */
import type { RecallScore } from "../../../domain/revision.js";
import type { Verdict } from "./schema.js";

export const SCORE_RULES = {
  /** Below this share of the criteria (partly covered counts half) the suggestion is 1. */
  passCoverage: 0.5,
} as const;

export const coverage = (verdicts: Verdict[]) =>
  verdicts.length === 0 ? 0 : verdicts.reduce((s, v) => s + (v === "COVERED" ? 1 : v === "PARTIAL" ? 0.5 : 0), 0) / verdicts.length;

export function suggestScore(r: { relevant: boolean; verdicts: Verdict[]; misconceptions: number }): RecallScore {
  const c = coverage(r.verdicts);
  if (!r.relevant || c === 0) return 0;
  if (r.misconceptions > 0 || r.verdicts.includes("INCORRECT")) return 1;
  if (c < SCORE_RULES.passCoverage) return 1;
  if (c < 1) return 2;
  return 3;
}

/** "What was missing" text for the Assess step, pre-filled from the verdicts and editable by the learner. */
export function suggestedMistakes(criteria: { text: string; verdict: Verdict }[], misconceptions: { claim: string; correction: string }[]) {
  const pick = (v: Verdict) => criteria.filter((c) => c.verdict === v).map((c) => c.text);
  const parts = [
    pick("INCORRECT").length ? `Incorrect: ${pick("INCORRECT").join("; ")}.` : "",
    ...misconceptions.map((m) => `Wrong: "${m.claim}" (${m.correction}).`),
    pick("PARTIAL").length ? `Partly: ${pick("PARTIAL").join("; ")}.` : "",
    pick("MISSING").length ? `Missing: ${pick("MISSING").join("; ")}.` : "",
  ].filter(Boolean);
  return parts.join(" ").slice(0, 2000);
}
