/**
 * "Your time" (docs/Availability-Phase3-Plan.md): the learner's hours, study days, pace, target date and time zone,
 * described for the sheet, previewed without saving, and saved with a re-plan.
 *
 * The preview loads the city exactly as a re-plan does, runs the pure scheduler on the proposed week, and the forecast
 * on the result: no write and no lock. The save writes the week and re-plans in one transaction under the city's lock,
 * with the same loader and week, so it moves what the preview said (unless the plan changed in between).
 */
import type { PrismaClient } from "@prisma/client";
import { d2i, i2d } from "../../db.js";
import { type ISODate, addDays } from "../../domain/dates.js";
import { forecast } from "../../domain/forecast.js";
import { replan } from "../../domain/scheduler.js";
import { PACES, type Pace, type Week, describeWeek, weekFromChoice } from "../../domain/week.js";
import { HttpError } from "../../lib/http.js";
import { validTimeZone } from "../../lib/zone.js";
import { RULES, gapFor } from "../recall/rules.js";
import { BULK_TX, loadInput, lockPlan, replanIn } from "./replan.js";
import { loadWeek } from "./service.js";

export interface TimeBody {
  minutesPerDay: number;
  studyDays: number[];
  pace: Pace;
  /** A date to set, null to clear, absent to keep. */
  targetDate?: string | null;
  /** Absent: keep. */
  timezone?: string;
}

/** The longest journey Blueprint plans (the contract's limit): a target date beyond it is refused. */
const MAX_DAYS = 3 * 366;

async function settingsOf(db: PrismaClient) {
  const s = await db.settings.findFirst();
  if (!s) throw new HttpError(500, "NOT_SEEDED", "Settings missing");
  return s;
}

function check(body: TimeBody, today: ISODate) {
  if (body.targetDate && (body.targetDate <= today || body.targetDate > addDays(today, MAX_DAYS)))
    throw new HttpError(400, "VALIDATION_ERROR", "The target date must be after today and within three years.");
  if (body.timezone !== undefined && validTimeZone(body.timezone) !== body.timezone)
    throw new HttpError(400, "VALIDATION_ERROR", "Unknown time zone.");
}

/** The sheet's starting point: the current week as a choice, the target date and time zone, and the paces. */
export async function describeTime(db: PrismaClient) {
  const [week, s] = await Promise.all([loadWeek(db), settingsOf(db)]);
  return { ...describeWeek(week), targetDate: s.targetDate ? d2i(s.targetDate) : null, timezone: s.timezone, paces: PACES, week };
}

/** The last day with open new material, with some tasks moved. */
async function finishWith(db: PrismaClient, to: Map<number, ISODate>) {
  const open = await db.task.findMany({ where: { status: "TODO", kind: { not: "REVISION" } }, select: { id: true, scheduledDate: true, estimatedMinutes: true } });
  const days = open.map((t) => to.get(t.id) ?? d2i(t.scheduledDate)).sort();
  return { finish: days.at(-1) ?? null, remaining: open.reduce((a, t) => a + t.estimatedMinutes, 0) };
}

/** What a choice would do, saving nothing. */
export async function previewTime(db: PrismaClient, today: ISODate, body: TimeBody) {
  check(body, today);
  const [input, s, recalls] = await Promise.all([
    loadInput(db, today), settingsOf(db),
    db.recallState.findMany({ where: { nextDueDate: { not: null } }, select: { stage: true, nextDueDate: true } }),
  ]);
  const week: Week = weekFromChoice(body, input.week);
  const targetDate = body.targetDate === undefined ? (s.targetDate ? d2i(s.targetDate) : null) : body.targetDate;
  const { moves } = replan({ ...input, week });
  const before = await finishWith(db, new Map());
  const after = await finishWith(db, new Map(moves.map((m) => [m.id, m.to])));
  const f = forecast({
    today, planEnd: d2i(s.journeyEnd), targetDate, week, remainingNewMinutes: after.remaining,
    recalls: recalls.map((r) => ({ stage: r.stage, nextDueDate: d2i(r.nextDueDate!) })), recallMinutes: RULES.minutesPerReview, gapFor,
    plannedFinish: after.finish,
  });
  const sameWeek = [1, 2, 3, 4, 5, 6, 7].every((d) => week[d].available === input.week[d].available && week[d].newTarget === input.week[d].newTarget);
  return {
    week,
    split: f.week,
    finish: { before: before.finish, after: after.finish },
    target: { date: targetDate, meets: f.meetsTarget, neededNewMinutesPerWeek: f.neededNewMinutesPerWeek },
    revisionLoad: f.revisionLoad,
    moved: moves.length,
    movedToday: moves.filter((m) => m.from === today || m.to === today).length,
    unchanged: sameWeek && moves.length === 0 && (body.targetDate === undefined || targetDate === (s.targetDate ? d2i(s.targetDate) : null))
      && (body.timezone === undefined || body.timezone === s.timezone),
  };
}

/** Saves a choice and re-plans, in one transaction under the city's lock. */
export async function saveTime(db: PrismaClient, today: ISODate, body: TimeBody) {
  check(body, today);
  await db.$transaction(async (tx) => {
    const s = await tx.settings.findFirst({ select: { cityId: true } });
    if (!s) throw new HttpError(500, "NOT_SEEDED", "Settings missing");
    await lockPlan(tx, s.cityId);
    const week = weekFromChoice(body, await loadWeek(tx));
    for (const d of [1, 2, 3, 4, 5, 6, 7]) {
      // Every city has all seven rows (created with its curriculum); the scoped client limits this to the city.
      await tx.weeklyTarget.updateMany({ where: { weekday: d }, data: { availableMinutes: week[d].available, targetMinutes: week[d].newTarget } });
    }
    await tx.settings.updateMany({
      data: {
        ...(body.targetDate !== undefined && { targetDate: body.targetDate ? i2d(body.targetDate) : null }),
        ...(body.timezone !== undefined && { timezone: body.timezone }),
      },
    });
    await replanIn(tx, s.cityId, today, "AVAILABILITY");
  }, BULK_TX);
  return describeTime(db);
}
