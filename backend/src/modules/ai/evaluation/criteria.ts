/**
 * The rubric is the prompt's existing `expectedAnswer` ("what a score of 3 has to cover"), written as criteria
 * separated by "·" in curriculum and template prompts, or one per line in learner prompts (AI design §6.1). Pure.
 */
export const MAX_CRITERIA = 20;

export function splitCriteria(expectedAnswer: string): string[] {
  return expectedAnswer
    .split(/\s*·\s*|\r?\n+/)
    .map((c) => c.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/[\s.;]+$/, "").trim())
    .filter((c) => c.length > 0)
    .slice(0, MAX_CRITERIA);
}
