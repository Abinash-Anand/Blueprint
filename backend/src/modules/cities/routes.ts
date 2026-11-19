/** /cities (management, curriculum versions) and /curriculum (templates, contract). Signed-in users, own cities only. */
import { Router } from "express";
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

/** Creation workflow answers (step 2 and 3). Stored as given for the curriculum generator; dates and numbers checked. */
const requirements = z.object({
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

export function cityRoutes({ prisma, clock, generation }: Deps) {
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
