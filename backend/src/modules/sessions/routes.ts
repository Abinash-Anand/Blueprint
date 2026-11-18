import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { Deps } from "../../app.js";
import { d2i, i2d } from "../../db.js";
import type { Clock } from "../../lib/clock.js";
import { HttpError, notFound, validate } from "../../lib/http.js";
import { idParam, isoDate, slug } from "../../lib/schemas.js";

const listQuery = z
  .object({ from: isoDate, to: isoDate })
  .strict()
  .refine((q) => q.from <= q.to, { message: "from must not be after to" });

const createBody = z
  .object({
    date: isoDate,
    minutes: z.number().int().min(1).max(720),
    taskId: z.number().int().positive().optional(),
    topicId: slug.optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

type SessionRow = { id: number; date: Date; minutes: number; taskId: number | null; topicId: string | null; note: string };
export const sessionDTO = (s: SessionRow) => ({
  id: s.id, date: d2i(s.date), minutes: s.minutes, taskId: s.taskId, topicId: s.topicId, note: s.note,
});

export function sessionService(prisma: PrismaClient, clock: Clock) {
  return {
    async list(from: string, to: string) {
      const rows = await prisma.studySession.findMany({
        where: { date: { gte: i2d(from), lte: i2d(to) } },
        orderBy: [{ date: "asc" }, { id: "asc" }],
      });
      return rows.map(sessionDTO);
    },
    async create(b: z.infer<typeof createBody>) {
      if (b.date > clock.today()) throw new HttpError(400, "VALIDATION_ERROR", "Study time cannot be recorded for a future date");
      let topicId = b.topicId ?? null;
      if (b.taskId) {
        const t = await prisma.task.findUnique({ where: { id: b.taskId } });
        if (!t) throw notFound("Task");
        topicId ??= t.topicId; // keep time attributed to the topic (LLD §2.2)
      }
      if (topicId && !(await prisma.topic.findUnique({ where: { id: topicId } }))) throw notFound("Topic");
      const s = await prisma.studySession.create({
        data: { date: i2d(b.date), minutes: b.minutes, taskId: b.taskId ?? null, topicId, note: b.note ?? "" },
      });
      return sessionDTO(s);
    },
    async remove(id: number) {
      const s = await prisma.studySession.findUnique({ where: { id } });
      if (!s) throw notFound("Session");
      await prisma.studySession.delete({ where: { id } });
    },
  };
}

export function sessionRoutes({ prisma, clock }: Deps) {
  const svc = sessionService(prisma, clock);
  const r = Router();
  r.get("/sessions", async (req, res) => {
    const { from, to } = validate(listQuery, req.query);
    res.json(await svc.list(from, to));
  });
  r.post("/sessions", async (req, res) => {
    res.status(201).json(await svc.create(validate(createBody, req.body)));
  });
  r.delete("/sessions/:id", async (req, res) => {
    await svc.remove(validate(idParam, req.params).id);
    res.status(204).end();
  });
  return r;
}
