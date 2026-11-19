import express, { type Request, Router } from "express";
import { z } from "zod";
import type { Deps } from "../../app.js";
import { validate } from "../../lib/http.js";
import { aiService } from "./service.js";

const evaluationBody = z
  .object({
    scheduleId: z.number().int().positive(),
    promptId: z.number().int().positive().optional(),
    templateKey: z.string().regex(/^[a-z]{1,20}$/).optional(),
    transcript: z.string().max(5000),
    parentId: z.number().int().positive().optional(),
  })
  .strict();

const transcriptionQuery = z.object({ scheduleId: z.coerce.number().int().positive() }).strict();

export function aiRoutes(deps: Deps) {
  const { ai } = deps;
  const usage = deps.aiUsage;
  // City-scoped data plus the signed-in user's AI consent record (GDPR Art. 7: given and withdrawn per person).
  const svc = (req: Request) =>
    aiService(req.db, deps.clock, ai.config, ai.providers, {
      get: () => deps.auth.hasConsent(req.user!.id, "AI_PROCESSING"),
      grant: async () => {
        await deps.auth.setConsent(req.user!.id, "AI_PROCESSING", true);
        return (await deps.auth.hasConsent(req.user!.id, "AI_PROCESSING"))!;
      },
    }, usage);
  const r = Router();
  r.get("/ai/status", async (req, res) => {
    res.json(await svc(req).status());
  });
  r.post("/ai/consent", async (req, res) => {
    res.json(await svc(req).consent());
  });
  // Raw WAV body, only on this route (AI design §8.2): no multipart, so a cross-site page cannot send it as a simple
  // request. The body stays in memory for one request and is never stored (I-5).
  r.post(
    "/ai/transcriptions",
    express.raw({ type: () => true, limit: ai.config.maxAudioBytes }),
    async (req, res) => {
      const { scheduleId } = validate(transcriptionQuery, req.query);
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      res.json(await svc(req).transcribe(scheduleId, body, req.get("content-type")));
    },
  );
  r.post("/revision/evaluations", async (req, res) => {
    res.status(201).json(await svc(req).evaluate(validate(evaluationBody, req.body)));
  });
  return r;
}
