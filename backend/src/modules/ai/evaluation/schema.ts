/**
 * One source of truth for the model's output (AI design §6.3): the TypeScript type, the runtime validation and the
 * JSON schema sent to the provider all come from this Zod schema. The model never returns a score, a confidence, a
 * correction decision or a confirmation flag: those are application decisions (§6.4).
 */
import { z } from "zod/v4";

export const Verdict = z.enum(["COVERED", "PARTIAL", "MISSING", "INCORRECT"]);
export type Verdict = z.infer<typeof Verdict>;

export const EvaluationResult = z
  .object({
    relevant: z.boolean().describe("false when the answer is empty, off-topic or not an attempt to answer"),
    criteria: z
      .array(
        z
          .object({
            index: z.number().int().min(0).describe("the criterion number from the list"),
            verdict: Verdict,
            evidence: z.string().max(300).nullable().describe("exact words copied from the answer, or null"),
          })
          .strict(),
      )
      .max(20),
    misconceptions: z
      .array(
        z
          .object({
            claim: z.string().max(300).describe("exact words copied from the answer that are wrong"),
            correction: z.string().max(300),
          })
          .strict(),
      )
      .max(5),
    feedback: z.string().max(600),
    followUpQuestion: z.string().max(300).nullable(),
  })
  .strict();

export type EvaluationResult = z.infer<typeof EvaluationResult>;

/** JSON schema for the provider's structured-output mode (draft-07 keywords, no $schema key). */
export function evaluationJsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(EvaluationResult, { target: "draft-7" }) as Record<string, unknown>;
  return schema;
}
