import { type Request, Router } from "express";
import { z } from "zod";
import type { Deps } from "../../app.js";
import { validate } from "../../lib/http.js";
import { idParam, slug, slugParam } from "../../lib/schemas.js";
import { revisionOverview } from "./overview.js";
import { revisionService } from "./service.js";

const method = z.enum(["CONCEPTUAL", "QUESTION_ANSWER", "WRITTEN", "VISUAL", "PRACTICAL", "SCENARIO"]);
const text = (max: number) => z.string().max(max);
const promptRef = {
  promptId: z.number().int().positive().optional(),
  templateKey: z.string().regex(/^[a-z]{1,20}$/).optional(),
};
const onePrompt = (b: { promptId?: number; templateKey?: string }) => (b.promptId === undefined) !== (b.templateKey === undefined);

const attemptBody = z
  .object({
    topicId: slug,
    subtopicId: z.number().int().positive().optional(),
    ...promptRef,
    retrievalMethod: method,
    score: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    usedHints: z.boolean(),
    usedNotes: z.boolean(),
    correctionCompleted: z.boolean().default(false),
    durationMinutes: z.number().int().min(1).max(720).optional(),
    response: text(5000).optional(),
    mistakes: text(2000).optional(),
    comment: text(1000).optional(),
    evaluationId: z.number().int().positive().optional(),
    selfScore: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
    inputMode: z.enum(["TYPED", "SPOKEN"]).optional(),
  })
  .strict()
  .refine(onePrompt, { message: "Provide exactly one of promptId or templateKey" });

const correctionBody = z.object({ mistakes: text(2000).optional() }).strict();

const checkpointBody = z
  .object({
    topicId: slug,
    subtopicId: z.number().int().positive(),
    ...promptRef,
    result: z.enum(["RECALLED", "PARTIAL", "NOT_RECALLED"]),
    neededAssistance: z.boolean(),
    gaps: text(2000).optional(),
    response: text(5000).optional(),
  })
  .strict()
  .refine(onePrompt, { message: "Provide exactly one of promptId or templateKey" });

const promptBody = z
  .object({
    topicId: slug,
    subtopicId: z.number().int().positive().optional(),
    title: z.string().trim().max(120).optional(),
    content: z.string().trim().min(5).max(2000),
    retrievalMethod: method,
    expectedAnswer: z.string().trim().min(1).max(4000),
    difficulty: z.number().int().min(1).max(3).optional(),
  })
  .strict();

const promptPatch = z
  .object({
    title: z.string().trim().max(120).optional(),
    content: z.string().trim().min(5).max(2000).optional(),
    retrievalMethod: method.optional(),
    expectedAnswer: z.string().trim().min(1).max(4000).optional(),
    difficulty: z.number().int().min(1).max(3).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Provide at least one field" });

export function revisionRoutes({ clock }: Deps) {
  const svc = (req: Request) => revisionService(req.db, clock);
  const r = Router();
  r.get("/revision/overview", async (req, res) => {
    res.json(await revisionOverview(req.db, clock)());
  });
  r.get("/topics/:id/revision", async (req, res) => {
    res.json(await svc(req).topicRevision(validate(slugParam, req.params).id));
  });
  r.post("/revision/attempts", async (req, res) => {
    res.status(201).json(await svc(req).submitAttempt(validate(attemptBody, req.body)));
  });
  r.post("/revision/attempts/:id/correction", async (req, res) => {
    const { id } = validate(idParam, req.params);
    res.json(await svc(req).correctAttempt(id, validate(correctionBody, req.body ?? {}).mistakes));
  });
  r.post("/checkpoints", async (req, res) => {
    res.status(201).json(await svc(req).createCheckpoint(validate(checkpointBody, req.body)));
  });
  r.post("/prompts", async (req, res) => {
    res.status(201).json(await svc(req).createPrompt(validate(promptBody, req.body)));
  });
  r.patch("/prompts/:id", async (req, res) => {
    const { id } = validate(idParam, req.params);
    res.json(await svc(req).patchPrompt(id, validate(promptPatch, req.body)));
  });
  r.delete("/prompts/:id", async (req, res) => {
    await svc(req).deletePrompt(validate(idParam, req.params).id);
    res.status(204).end();
  });
  return r;
}
