import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../../app.js";
import { diffDays } from "../../domain/dates.js";
import { validate } from "../../lib/http.js";
import { idParam, isoDate, slug } from "../../lib/schemas.js";
import { taskService } from "./service.js";

const status = z.enum(["TODO", "DONE", "SKIPPED"]);
const title = z.string().trim().min(1).max(200);
const minutes = z.number().int().min(5).max(720);

const listQuery = z
  .object({ from: isoDate.optional(), to: isoDate.optional(), status: status.optional(), topicId: slug.optional() })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from must not be after to" })
  .refine((q) => !q.from || !q.to || diffDays(q.from, q.to) <= 400, { message: "Range must be at most 400 days" });

const createBody = z
  .object({
    title,
    scheduledDate: isoDate,
    estimatedMinutes: minutes,
    kind: z.enum(["STUDY", "PRACTICE", "REVISION"]).optional(),
    topicId: slug.optional(),
    subtopicId: z.number().int().positive().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const patchBody = z
  .object({
    title: title.optional(),
    notes: z.string().max(2000).optional(),
    estimatedMinutes: minutes.optional(),
    scheduledDate: isoDate.optional(),
    status: status.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Provide at least one field" });

export function taskRoutes({ prisma, clock }: Deps) {
  const svc = taskService(prisma, clock);
  const r = Router();
  r.get("/tasks", async (req, res) => {
    res.json(await svc.list(validate(listQuery, req.query)));
  });
  r.post("/tasks/reschedule-overdue", async (_req, res) => {
    res.json(await svc.rescheduleOverdue());
  });
  r.post("/tasks", async (req, res) => {
    res.status(201).json(await svc.create(validate(createBody, req.body)));
  });
  r.get("/tasks/:id", async (req, res) => {
    res.json(await svc.get(validate(idParam, req.params).id));
  });
  r.patch("/tasks/:id", async (req, res) => {
    const { id } = validate(idParam, req.params);
    res.json(await svc.patch(id, validate(patchBody, req.body)));
  });
  r.delete("/tasks/:id", async (req, res) => {
    await svc.remove(validate(idParam, req.params).id);
    res.status(204).end();
  });
  return r;
}

