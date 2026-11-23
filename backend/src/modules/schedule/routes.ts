import { type Request, Router } from "express";
import { z } from "zod";
import type { Deps } from "../../app.js";
import { validate } from "../../lib/http.js";
import { isoDate, slugParam } from "../../lib/schemas.js";
import { scheduleService } from "./service.js";
import { describeTime, otherSlots, previewTime, saveTime } from "./yourTime.js";

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

/** "Your time" (docs/Availability-Phase3-Plan.md): hours per study day, study days, pace, target date, time zone. */
const timeBody = z
  .object({
    minutesPerDay: z.number().int().min(15).max(960).multipleOf(15),
    studyDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).refine((a) => new Set(a).size === a.length, { message: "Duplicate weekday" }),
    pace: z.enum(["LIGHT", "STEADY", "INTENSIVE", "CURRENT"]),
    targetDate: isoDate.nullable().optional(),
    timezone: z.string().min(1).max(64).optional(),
    studyStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 18:00").nullable().optional(),
  })
  .strict();

export function scheduleRoutes(deps: Deps) {
  const svc = (req: Request) => scheduleService(req.db, () => deps.clock.today());
  /** The study slots of the learner's other cities, for clashes (docs/Google-Calendar-MVP-Plan.md §9). */
  const others = (req: Request) => otherSlots(deps.prisma, req.user!.id, req.city!.id);
  const r = Router();
  r.get("/schedule/availability", async (req, res) => {
    res.json(await describeTime(req.db, await others(req)));
  });
  // What a change would do, saving nothing.
  r.post("/schedule/preview", async (req, res) => {
    res.json(await previewTime(req.db, deps.clock.today(), validate(timeBody, req.body), await others(req)));
  });
  r.put("/schedule/availability", async (req, res) => {
    res.json(await saveTime(req.db, deps.clock.today(), validate(timeBody, req.body), await others(req)));
  });

  // The latest re-plans that moved tasks (docs/Scheduler-Phase2-Plan.md), newest first.
  r.get("/schedule/plan-changes", async (req, res) => {
    res.json(await svc(req).planChanges());
  });

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
