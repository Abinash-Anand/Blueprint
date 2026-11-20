/**
 * Revision v2, phases 2 and 3: the revision home, sessions, answers, hints, results, finishing, spoken answers and the
 * per-topic history. City routes: every lookup goes through `req.db`, so another city's sessions answer 404.
 */
import express, { type Request, Router } from "express";
import { z } from "zod";
import type { Deps } from "../../app.js";
import { validate } from "../../lib/http.js";
import { idParam, slugParam } from "../../lib/schemas.js";
import { aiService } from "../ai/service.js";
import { sessionService } from "./sessionService.js";

const startBody = z.object({ kind: z.enum(["PLANNED", "EARLY", "PRACTICE"]).default("PLANNED") }).strict();
const indexBody = z.object({ index: z.number().int().min(0).max(200) }).strict();
const answerBody = z.object({
  index: z.number().int().min(0).max(200),
  mode: z.enum(["TYPED", "SPOKEN", "CODE", "CHOICE"]),
  answer: z.string().max(5000).optional(),
  choice: z.array(z.number().int().min(0).max(9)).max(10).optional(),
  confidence: z.number().int().min(0).max(3).optional(),
  seconds: z.number().int().min(0).max(7200).optional(),
}).strict();
const resultBody = z.object({ responseId: z.number().int().positive(), final: z.number().int().min(0).max(3), modelShown: z.boolean().optional() }).strict();
const transcribeQuery = z.object({ index: z.coerce.number().int().min(0).max(200) }).strict();
const maintenanceBody = z.object({ maintenance: z.boolean() }).strict();

export function revisionSessionRoutes(deps: Deps) {
  const { ai } = deps;
  const svc = (req: Request) => {
    const consent = {
      get: () => deps.auth.hasConsent(req.user!.id, "AI_PROCESSING"),
      grant: async () => {
        await deps.auth.setConsent(req.user!.id, "AI_PROCESSING", true);
        return (await deps.auth.hasConsent(req.user!.id, "AI_PROCESSING"))!;
      },
    };
    const a = aiService(req.db, deps.clock, ai.config, ai.providers, consent, deps.aiUsage);
    const topUp = (ids: number[]) => void deps.packs.topUp(req.db, req.city!.id, req.user!.id, ids).catch(() => undefined);
    return { ai: a, s: sessionService(req.db, deps.clock, a, async () => ai.config.enabled && !!(await consent.get()), topUp) };
  };
  const r = Router();

  r.get("/revision/home", async (req, res) => {
    res.json(await svc(req).s.home());
  });
  r.post("/revision/sessions", async (req, res) => {
    res.status(201).json(await svc(req).s.start(validate(startBody, req.body ?? {}).kind));
  });
  r.get("/revision/sessions/:id", async (req, res) => {
    res.json(await svc(req).s.session(validate(idParam, req.params).id));
  });
  r.post("/revision/sessions/:id/hint", async (req, res) => {
    res.json(await svc(req).s.hint(validate(idParam, req.params).id, validate(indexBody, req.body).index));
  });
  r.post("/revision/sessions/:id/answers", async (req, res) => {
    res.status(201).json(await svc(req).s.answer(validate(idParam, req.params).id, validate(answerBody, req.body)));
  });
  r.post("/revision/sessions/:id/results", async (req, res) => {
    res.json(await svc(req).s.result(validate(idParam, req.params).id, validate(resultBody, req.body)));
  });
  r.post("/revision/sessions/:id/skip", async (req, res) => {
    res.json(await svc(req).s.skip(validate(idParam, req.params).id, validate(indexBody, req.body).index));
  });
  r.post("/revision/sessions/:id/finish", async (req, res) => {
    res.json(await svc(req).s.finish(validate(idParam, req.params).id));
  });
  // Raw WAV body on this route only (no multipart); the recording is transcribed and never stored.
  r.post("/revision/sessions/:id/transcriptions", express.raw({ type: () => true, limit: ai.config.maxAudioBytes }), async (req, res) => {
    const { id } = validate(idParam, req.params);
    const { index } = validate(transcribeQuery, req.query);
    const { ai: a, s } = svc(req);
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    res.json(await a.transcribeTerms(body, req.get("content-type"), () => s.terms(id, index)));
  });
  r.patch("/topics/:id/revision/track", async (req, res) => {
    res.json(await svc(req).s.setMaintenance(validate(slugParam, req.params).id, validate(maintenanceBody, req.body).maintenance));
  });
  r.get("/topics/:id/revision/history", async (req, res) => {
    res.json(await svc(req).s.history(validate(slugParam, req.params).id));
  });
  return r;
}
