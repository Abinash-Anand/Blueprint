/** /cities (management, curriculum versions) and /curriculum (templates, contract). Signed-in users, own cities only. */
import express, { Router } from "express";
import { ATTACHMENTS } from "../ai/curriculum/intake.js";
import { z } from "zod";
import type { Deps } from "../../app.js";
import { requireUser } from "../../lib/context.js";
import { validate } from "../../lib/http.js";
import { isoDate } from "../../lib/schemas.js";
import { curriculumJsonSchema } from "./contract.js";
import { cityService } from "./service.js";

const cityId = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/) });
const versionParam = cityId.extend({ version: z.coerce.number().int().positive() });
const str = (max: number) => z.string().trim().max(max);

/** "Here's what I understood" as the learner confirmed or corrected it (ai/curriculum/intake.ts Understanding). */
const understood = z.object({
  name: str(80).optional(), category: str(60).optional(), goal: str(500).optional(),
  currentLevel: str(60).optional(), targetLevel: str(60).optional(),
  subjects: z.array(str(60).min(1)).max(7).optional(),
  alreadyKnown: z.array(str(120).min(1)).max(20).optional(),
  resources: z.array(str(300).min(1)).max(20).optional(),
  focusOptions: z.array(str(60).min(1)).max(4).optional(),
  questions: z.array(z.object({ question: str(200), options: z.array(str(80)).max(4) }).strict()).max(2).optional(),
  plan: str(200).nullable().optional(),
  planMonths: z.number().int().min(1).max(36).nullable().optional(),
  estimatedHours: z.number().int().min(1).max(5000).optional(),
}).strict();

/** Creation workflow answers. Stored as given for the curriculum generator; dates and numbers checked. */
const requirements = z.object({
  /** The learner's own words (step 1 of city creation). */
  brief: str(4000).optional(),
  understood: understood.optional(),
  focus: str(60).optional(),
  answers: z.array(z.object({ question: str(200), answer: str(120) }).strict()).max(2).optional(),
  outcome: str(1000).optional(),
  currentLevel: z.enum(["NONE", "BEGINNER", "INTERMEDIATE", "ADVANCED"]).optional(),
  targetLevel: z.enum(["FOUNDATIONS", "WORKING", "PROFESSIONAL", "EXPERT"]).optional(),
  subjects: z.array(str(80).min(1)).max(30).optional(),
  resources: z.array(str(300).min(1)).max(20).optional(),
  prerequisites: z.array(str(120).min(1)).max(20).optional(),
}).strict();
const constraints = z.object({
  hoursPerDay: z.number().min(0.25).max(12).optional(),
  daysPerWeek: z.number().int().min(1).max(7).optional(),
  pace: z.enum(["LIGHT", "STEADY", "INTENSIVE"]).optional(),
  startDate: isoDate.optional(),
  targetDate: isoDate.optional(),
  timezone: str(64).optional(),
  /** ISO weekdays the learner studies (1 = Monday). */
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
}).strict().refine((c) => !c.startDate || !c.targetDate || c.startDate <= c.targetDate, { message: "The target date is before the start date", path: ["targetDate"] });

const createBody = z.object({
  name: str(80).min(1), description: str(1000).optional(), goal: str(500).optional(), category: str(60).nullable().optional(),
  requirements: requirements.nullable().optional(), constraints: constraints.nullable().optional(),
}).strict();
const updateBody = createBody.partial().strict().refine((b) => Object.keys(b).length > 0, { message: "Provide at least one field" });
const statusBody = z.object({ action: z.enum(["pause", "resume", "complete", "reopen", "archive", "restore"]) }).strict();
const deleteBody = z.object({ confirmName: z.string().max(80) }).strict();
const proposalBody = z.discriminatedUnion("source", [
  z.object({ source: z.literal("TEMPLATE"), template: z.enum(["engineering"]), start: isoDate.optional() }).strict(),
  z.object({ source: z.literal("IMPORT"), document: z.record(z.unknown()), note: str(300).optional() }).strict(),
]);

const attachmentParam = cityId.extend({ attachmentId: z.coerce.number().int().positive() });
const attachmentQuery = z.object({ name: z.string().trim().min(1).max(200) }).strict();
/** Raw bodies on these routes only (no multipart), so a cross-site page cannot send them as a simple request. */
const rawBody = (limit: number) => express.raw({ type: () => true, limit });
const bodyBuffer = (b: unknown) => (Buffer.isBuffer(b) ? b : Buffer.alloc(0));

export function cityRoutes({ prisma, clock, generation, intake, ai }: Deps) {
  const r = Router();
  const svc = (userId: string) => cityService(prisma, clock, userId);

  /** Whether "Generate from your answers" can be used, and with which model (AI design §10.3). */
  r.get("/curriculum/generation", requireUser, async (req, res) => {
    res.json(await generation.availability(req.user!.id));
  });
  /** Starts generating a curriculum for a draft city in the background; follow it via the version (202). */
  r.post("/cities/:id/curriculum/generate", requireUser, async (req, res) => {
    res.status(202).json(await generation.start(req.user!.id, validate(cityId, req.params).id));
  });

  /* City creation intake (AI design §10.4). */
  r.get("/cities/:id/attachments", requireUser, async (req, res) => {
    res.json(await intake.listAttachments(req.user!.id, validate(cityId, req.params).id));
  });
  r.post("/cities/:id/attachments", requireUser, rawBody(ATTACHMENTS.maxBytes + 1), async (req, res) => {
    const { name } = validate(attachmentQuery, req.query);
    const type = (req.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    res.status(201).json(await intake.addAttachment(req.user!.id, validate(cityId, req.params).id, name, type, bodyBuffer(req.body)));
  });
  r.delete("/cities/:id/attachments/:attachmentId", requireUser, async (req, res) => {
    const p = validate(attachmentParam, req.params);
    await intake.removeAttachment(req.user!.id, p.id, p.attachmentId);
    res.status(204).end();
  });
  r.post("/cities/:id/dictation", requireUser, rawBody(ai.config.maxAudioBytes), async (req, res) => {
    res.json(await intake.dictate(req.user!.id, validate(cityId, req.params).id, bodyBuffer(req.body), req.get("content-type")));
  });
  r.post("/cities/:id/understand", requireUser, async (req, res) => {
    res.json(await intake.understand(req.user!.id, validate(cityId, req.params).id));
  });

  r.get("/curriculum/contract", requireUser, (_req, res) => {
    res.json(curriculumJsonSchema());
  });
  r.get("/curriculum/templates", requireUser, (req, res) => {
    res.json(svc(req.user!.id).templates());
  });

  r.get("/cities", requireUser, async (req, res) => {
    res.json(await svc(req.user!.id).list());
  });
  r.post("/cities", requireUser, async (req, res) => {
    res.status(201).json(await svc(req.user!.id).create(validate(createBody, req.body)));
  });
  r.get("/cities/:id", requireUser, async (req, res) => {
    res.json(await svc(req.user!.id).get(validate(cityId, req.params).id));
  });
  r.patch("/cities/:id", requireUser, async (req, res) => {
    res.json(await svc(req.user!.id).update(validate(cityId, req.params).id, validate(updateBody, req.body)));
  });
  r.post("/cities/:id/status", requireUser, async (req, res) => {
    res.json(await svc(req.user!.id).changeStatus(validate(cityId, req.params).id, validate(statusBody, req.body).action));
  });
  r.delete("/cities/:id", requireUser, async (req, res) => {
    await svc(req.user!.id).remove(validate(cityId, req.params).id, validate(deleteBody, req.body).confirmName);
    res.status(204).end();
  });

  r.get("/cities/:id/curriculum/versions", requireUser, async (req, res) => {
    res.json(await svc(req.user!.id).versions(validate(cityId, req.params).id));
  });
  r.get("/cities/:id/curriculum/versions/:version", requireUser, async (req, res) => {
    const p = validate(versionParam, req.params);
    res.json(await svc(req.user!.id).version(p.id, p.version));
  });
  r.post("/cities/:id/curriculum/proposals", requireUser, async (req, res) => {
    res.status(201).json(await svc(req.user!.id).propose(validate(cityId, req.params).id, validate(proposalBody, req.body)));
  });
  r.post("/cities/:id/curriculum/versions/:version/approve", requireUser, async (req, res) => {
    const p = validate(versionParam, req.params);
    res.json(await svc(req.user!.id).approve(p.id, p.version));
  });
  r.post("/cities/:id/curriculum/versions/:version/reject", requireUser, async (req, res) => {
    const p = validate(versionParam, req.params);
    await svc(req.user!.id).reject(p.id, p.version);
    res.status(204).end();
  });
  return r;
}
