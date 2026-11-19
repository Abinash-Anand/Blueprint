import { type Request, Router } from "express";
import { z } from "zod";
import type { Deps } from "../../app.js";
import { validate } from "../../lib/http.js";
import { idParam, slugParam } from "../../lib/schemas.js";
import { curriculumService } from "./service.js";

const subtopicBody = z.object({ completed: z.boolean() }).strict();
const topicBody = z
  .object({
    demonstrated: z.boolean().optional(),
    demonstrationNote: z.string().max(500).optional(),
    needsReview: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Provide at least one field" });

export function curriculumRoutes({ clock }: Deps) {
  const svc = (req: Request) => curriculumService(req.db, clock);
  const r = Router();
  r.get("/curriculum", async (req, res) => {
    res.json(await svc(req).getCurriculum());
  });
  r.get("/topics/:id", async (req, res) => {
    const { id } = validate(slugParam, req.params);
    res.json(await svc(req).getTopic(id));
  });
  r.patch("/topics/:id", async (req, res) => {
    const { id } = validate(slugParam, req.params);
    res.json(await svc(req).patchTopic(id, validate(topicBody, req.body)));
  });
  r.patch("/subtopics/:id", async (req, res) => {
    const { id } = validate(idParam, req.params);
    const { completed } = validate(subtopicBody, req.body);
    res.json(await svc(req).setSubtopic(id, completed));
  });
  return r;
}
