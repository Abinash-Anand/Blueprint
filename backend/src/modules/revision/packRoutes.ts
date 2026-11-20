/**
 * Revision material and packs (Revision v2 plan, phase 1). City routes: every lookup goes through `req.db`, the
 * client scoped to the city in X-City-Id, so another city's topics, packs and questions answer 404.
 */
import express, { Router } from "express";
import { z } from "zod";
import type { Deps } from "../../app.js";
import { validate } from "../../lib/http.js";
import { idParam, slug, slugParam } from "../../lib/schemas.js";
import { MATERIAL } from "./material.js";
import { packCatalog } from "./packService.js";

const materialParam = z.object({ id: slug, materialId: z.coerce.number().int().positive() });
const nameQuery = z.object({ name: z.string().trim().min(1).max(200) }).strict();
const buildBody = z.object({ basis: z.enum(["MATERIAL", "OUTLINE"]).default("MATERIAL") }).strict();
const line = (max: number) => z.string().trim().min(1).max(max);
const conceptPatch = z.object({ title: line(100).optional(), summary: line(600).optional(), removed: z.boolean().optional() }).strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to change" });
const conceptBody = z.object({ title: line(100), summary: z.string().trim().max(600).optional() }).strict();
const itemPatch = z.object({
  question: line(600).optional(),
  situation: z.string().trim().max(800).optional(),
  expected: z.array(line(240)).min(1).max(6).optional(),
  modelAnswer: line(2000).optional(),
  removed: z.boolean().optional(),
}).strict().refine((b) => Object.keys(b).length > 0, { message: "Nothing to change" });

/** Raw bodies on the upload route only (no multipart), so a cross-site page cannot send them as a simple request. */
const rawBody = express.raw({ type: () => true, limit: MATERIAL.maxBytes + 1 });

export function revisionPackRoutes({ packs }: Deps) {
  const r = Router();

  r.get("/revision/pack-catalog", (_req, res) => {
    res.json(packCatalog());
  });
  r.get("/topics/:id/revision/pack", async (req, res) => {
    res.json(await packs.overview(req.db, req.user!.id, validate(slugParam, req.params).id));
  });
  /** A file, or pasted notes sent as text/plain; only the extracted text is kept. */
  r.post("/topics/:id/revision/material", rawBody, async (req, res) => {
    const { name } = validate(nameQuery, req.query);
    const type = (req.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    res.status(201).json(await packs.addMaterial(req.db, req.user!.id, validate(slugParam, req.params).id, name, type, body));
  });
  r.delete("/topics/:id/revision/material/:materialId", async (req, res) => {
    const p = validate(materialParam, req.params);
    await packs.removeMaterial(req.db, p.id, p.materialId);
    res.status(204).end();
  });
  /** Starts building the pack in the background; follow it through GET …/revision/pack (202). */
  r.post("/topics/:id/revision/pack", async (req, res) => {
    const { basis } = validate(buildBody, req.body ?? {});
    res.status(202).json(await packs.build(req.db, req.city!.id, req.user!.id, validate(slugParam, req.params).id, basis));
  });
  r.delete("/topics/:id/revision/pack", async (req, res) => {
    res.json(await packs.deletePacks(req.db, validate(slugParam, req.params).id));
  });
  r.post("/topics/:id/revision/concepts", async (req, res) => {
    res.status(201).json(await packs.addConcept(req.db, req.city!.id, req.user!.id, validate(slugParam, req.params).id, validate(conceptBody, req.body)));
  });
  r.patch("/revision/concepts/:id", async (req, res) => {
    res.json(await packs.updateConcept(req.db, validate(idParam, req.params).id, validate(conceptPatch, req.body)));
  });
  /** A concept's questions with their answers (shown only when the learner asks to see them). */
  r.get("/revision/concepts/:id/items", async (req, res) => {
    res.json(await packs.items(req.db, validate(idParam, req.params).id));
  });
  r.patch("/revision/items/:id", async (req, res) => {
    res.json(await packs.updateItem(req.db, validate(idParam, req.params).id, validate(itemPatch, req.body)));
  });
  return r;
}
