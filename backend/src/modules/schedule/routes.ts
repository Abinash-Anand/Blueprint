import { type Request, Router } from "express";
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
      .refine((a) => new Set(a.map((t) => t.weekday)).size === a.length, { message: "Duplicate weekday" })
      .optional(),
    /** Revision minutes each study day accepts on top of planned learning (SRS FR-REV-12). */
    revisionDailyMinutes: z.number().int().min(0).max(240).multipleOf(5).optional(),
    /** Over-target revision minutes per week (SRS BR-18). */
    revisionWeeklyOvertimeMinutes: z.number().int().min(0).max(720).multipleOf(5).optional(),
  })
  .strict()
  .refine((b) => b.weeklyTargets || b.revisionDailyMinutes !== undefined || b.revisionWeeklyOvertimeMinutes !== undefined, {
    message: "Provide weeklyTargets, revisionDailyMinutes and/or revisionWeeklyOvertimeMinutes",
  });

export function scheduleRoutes(_deps: Deps) {
  const svc = (req: Request) => scheduleService(req.db);
  const r = Router();
  r.get("/stages", async (req, res) => {
    res.json(await svc(req).listStages());
  });
  r.patch("/stages/:id", async (req, res) => {
    const { id } = validate(slugParam, req.params);
    res.json(await svc(req).patchStage(id, validate(stageBody, req.body)));
  });
  r.get("/settings", async (req, res) => {
    res.json(await svc(req).getSettings());
  });
  r.patch("/settings", async (req, res) => {
    res.json(await svc(req).patchSettings(validate(settingsBody, req.body)));
  });
  return r;
}
