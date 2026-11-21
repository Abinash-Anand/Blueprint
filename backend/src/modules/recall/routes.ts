/**
 * Recall routes (docs/Recall-Plan.md, phase 1). City routes: every lookup goes through `req.db`, so another city's
 * reviews and points answer 404.
 */
import express, { type Request, Router } from "express";
import { z } from "zod";
import type { Deps } from "../../app.js";
import { validate } from "../../lib/http.js";
import { idParam } from "../../lib/schemas.js";
import { aiService } from "../ai/service.js";
import { RECALL } from "./service.js";

const startBody = z.object({ subtopicId: z.number().int().positive() }).strict();
const typedBody = z.object({ typed: z.string().max(RECALL.maxChars) }).strict();
const partParam = z.object({ id: z.coerce.number().int().positive(), index: z.coerce.number().int().min(0).max(100) });
const leaveOutBody = z.object({ leftOut: z.boolean() }).strict();
const answerBody = z.object({ answer: z.string().max(RECALL.maxChars) }).strict();
const sketchParam = z.object({ id: z.coerce.number().int().positive(), index: z.coerce.number().int().min(0).max(10) });

export function recallRoutes(deps: Deps) {
  const { recall, ai } = deps;
  const r = Router();
  const user = (req: Request) => req.user!.id;
  const city = (req: Request) => req.city!.id;
  // Transcription with the signed-in user's AI consent; recordings stay in memory for one request.
  const aiFor = (req: Request) =>
    aiService(req.db, deps.clock, ai.config, ai.providers, {
      get: () => deps.auth.hasConsent(user(req), "AI_PROCESSING"),
      grant: async () => {
        await deps.auth.setConsent(user(req), "AI_PROCESSING", true);
        return (await deps.auth.hasConsent(user(req), "AI_PROCESSING"))!;
      },
    }, deps.aiUsage);

  r.get("/recall/home", async (req, res) => {
    res.json(await recall.home(req.db, user(req)));
  });
  r.get("/recall/history", async (req, res) => {
    res.json(await recall.history(req.db));
  });
  r.post("/recall/reviews", async (req, res) => {
    res.status(201).json(await recall.start(req.db, city(req), user(req), validate(startBody, req.body).subtopicId));
  });
  r.get("/recall/reviews/:id", async (req, res) => {
    res.json(await recall.review(req.db, validate(idParam, req.params).id));
  });
  r.patch("/recall/reviews/:id", async (req, res) => {
    res.json(await recall.saveTyped(req.db, validate(idParam, req.params).id, validate(typedBody, req.body).typed));
  });
  // One recorded part (raw WAV, this route only): transcribed with the sub-topic's terms, then dropped; the text is kept.
  r.post("/recall/reviews/:id/parts", express.raw({ type: () => true, limit: ai.config.maxAudioBytes }), async (req, res) => {
    const { id } = validate(idParam, req.params);
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const t = await aiFor(req).transcribeTerms(body, req.get("content-type"), () => recall.transcriptionTerms(req.db, id));
    res.status(201).json(await recall.addPart(req.db, id, t.text));
  });
  r.delete("/recall/reviews/:id/parts/:index", async (req, res) => {
    const p = validate(partParam, req.params);
    res.json(await recall.removePart(req.db, p.id, p.index));
  });
  r.post("/recall/reviews/:id/submit", async (req, res) => {
    res.status(202).json(await recall.submit(req.db, city(req), user(req), validate(idParam, req.params).id));
  });
  r.post("/recall/reviews/:id/retry", async (req, res) => {
    res.status(202).json(await recall.retry(req.db, city(req), user(req), validate(idParam, req.params).id));
  });
  r.post("/recall/reviews/:id/complete", async (req, res) => {
    res.json(await recall.complete(req.db, city(req), validate(idParam, req.params).id));
  });
  // Phase 2: the senior engineer's follow-up question, the answer to it, and a spoken answer's text.
  r.post("/recall/reviews/:id/probe", async (req, res) => {
    res.json(await recall.probe(req.db, user(req), validate(idParam, req.params).id));
  });
  r.post("/recall/reviews/:id/followup", async (req, res) => {
    res.json(await recall.followup(req.db, user(req), validate(idParam, req.params).id, validate(answerBody, req.body).answer));
  });
  r.post("/recall/reviews/:id/transcriptions", express.raw({ type: () => true, limit: ai.config.maxAudioBytes }), async (req, res) => {
    const { id } = validate(idParam, req.params);
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    res.json(await aiFor(req).transcribeTerms(body, req.get("content-type"), () => recall.transcriptionTerms(req.db, id, true)));
  });
  // Phase 3: a sketch drawn from memory (raw PNG, JPEG or WebP, this route only); the photo is described and dropped.
  r.post("/recall/reviews/:id/sketches", express.raw({ type: () => true, limit: RECALL.maxSketchBytes + 1 }), async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    res.status(201).json(await recall.addSketch(req.db, user(req), validate(idParam, req.params).id, req.get("content-type"), body));
  });
  r.delete("/recall/reviews/:id/sketches/:index", async (req, res) => {
    const p = validate(sketchParam, req.params);
    res.json(await recall.removeSketch(req.db, p.id, p.index));
  });
  r.get("/recall/subtopics/:id/matrix", async (req, res) => {
    res.json(await recall.matrix(req.db, validate(idParam, req.params).id));
  });
  r.patch("/recall/points/:id", async (req, res) => {
    res.json({ review: await recall.leaveOut(req.db, city(req), validate(idParam, req.params).id, validate(leaveOutBody, req.body).leftOut) });
  });
  r.post("/recall/subtopics/:id/postpone", async (req, res) => {
    res.json(await recall.postpone(req.db, validate(idParam, req.params).id));
  });
  return r;
}
