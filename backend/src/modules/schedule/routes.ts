import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../../app.js";
import { validate } from "../../lib/http.js";
import { isoDate, slugParam } from "../../lib/schemas.js";
import { scheduleService } from "./service.js";

const stageBody = z
  .object({ startDate: isoDate.optional(), endDate: isoDate.optional() })
  .strict()
  .refine((b) => b.startDate || b.endDate, { message: "Provide startDate and/or endDate" });

const settingsBody = z
  .object({
    weeklyTargets: z
      .array(
        z.object({
          weekday: z.number().int().min(1).max(7),
          targetMinutes: z.number().int().min(0).max(960).multipleOf(15),
        }).strict(),
      )
      .min(1)
      .max(7)
      .refine((a) => new Set(a.map((t) => t.weekday)).size === a.length, { message: "Duplicate weekday" }),
  })
  .strict();

export function scheduleRoutes({ prisma }: Deps) {
  const svc = scheduleService(prisma);
  const r = Router();
  r.get("/stages", async (_req, res) => {
    res.json(await svc.listStages());
  });
  r.patch("/stages/:id", async (req, res) => {
    const { id } = validate(slugParam, req.params);
    res.json(await svc.patchStage(id, validate(stageBody, req.body)));
  });
  r.get("/settings", async (_req, res) => {
    res.json(await svc.getSettings());
  });
  r.patch("/settings", async (req, res) => {
    res.json(await svc.patchSettings(validate(settingsBody, req.body)));
  });
  return r;
}
