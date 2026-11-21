/**
 * The retired revision systems' history (docs/Recall-Plan.md §9): earlier recall attempts and study-time checks,
 * read-only. City route: every lookup goes through `req.db`. Nothing here writes.
 */
import { type Request, Router } from "express";
import { d2i } from "../../db.js";

export function revisionArchiveRoutes() {
  const r = Router();
  r.get("/revision/archive", async (req: Request, res) => {
    const db = req.db;
    const [attempts, checkpoints] = await Promise.all([
      db.revisionAttempt.findMany({
        orderBy: [{ attemptedAt: "desc" }, { id: "desc" }],
        include: { schedule: { select: { scope: true, topic: { select: { name: true } }, subtopic: { select: { name: true } } } } },
      }),
      db.learningCheckpoint.findMany({
        orderBy: [{ date: "desc" }, { id: "desc" }],
        include: { topic: { select: { name: true } }, subtopic: { select: { name: true } } },
      }),
    ]);
    res.json({
      attempts: attempts.map((a) => ({
        id: a.id, date: d2i(a.attemptDate), score: a.score, method: a.retrievalMethod, withHelp: a.usedHints || a.usedNotes, gap: a.mistakes,
        label: a.schedule.scope === "TOPIC" ? a.schedule.topic.name : (a.schedule.subtopic?.name ?? a.schedule.topic.name), topicName: a.schedule.topic.name,
      })),
      checkpoints: checkpoints.map((c) => ({
        id: c.id, date: d2i(c.date), result: c.result, gaps: c.gaps, label: c.subtopic?.name ?? c.topic.name, topicName: c.topic.name,
      })),
    });
  });
  return r;
}
