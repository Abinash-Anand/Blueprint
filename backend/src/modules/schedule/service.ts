import type { Prisma, PrismaClient } from "@prisma/client";
import { d2i, i2d } from "../../db.js";
import { HttpError, notFound } from "../../lib/http.js";
import type { ISODate } from "../../domain/dates.js";
import { BULK_TX, replanIn } from "./replan.js";

export const stageInclude = { districts: { select: { id: true } } } satisfies Prisma.StageInclude;
type StageRow = Prisma.StageGetPayload<{ include: typeof stageInclude }>;

export const stageDTO = (s: StageRow) => ({
  id: s.id,
  position: s.position,
  name: s.name,
  kind: s.kind,
  startDate: d2i(s.startDate),
  endDate: d2i(s.endDate),
  districtIds: s.districts.map((d) => d.id),
});
export type StageDTO = ReturnType<typeof stageDTO>;

type Db = PrismaClient | Prisma.TransactionClient;

export async function loadTargets(prisma: Db): Promise<Record<number, number>> {
  const rows = await prisma.weeklyTarget.findMany();
  const t: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  for (const r of rows) t[r.weekday] = r.targetMinutes;
  return t;
}

/**
 * The learner's week (Blueprint relationship model): per ISO weekday the minutes they can study (availability) and the
 * new-material minutes the plan fills (allocation); what is left is revision time. Rows from before availability was
 * kept read their target as their availability.
 */
export async function loadWeek(prisma: Db): Promise<Record<number, { available: number; newTarget: number }>> {
  const rows = await prisma.weeklyTarget.findMany();
  const w: Record<number, { available: number; newTarget: number }> = {};
  for (const d of [1, 2, 3, 4, 5, 6, 7]) w[d] = { available: 0, newTarget: 0 };
  for (const r of rows) w[r.weekday] = { available: Math.max(r.availableMinutes ?? r.targetMinutes, r.targetMinutes), newTarget: r.targetMinutes };
  return w;
}

/**
 * Records a new city's availability from its creation answers (hours a day; the study days are the plan's): a study
 * day is available for those hours, never less than its target; a rest day stays 0. Also its target date. Only fills
 * what is not recorded yet, so approving a later curriculum version changes nothing the learner set.
 */
export async function recordAvailability(prisma: Db, constraints: unknown) {
  const c = (constraints ?? {}) as { hoursPerDay?: unknown; targetDate?: unknown; studyStart?: unknown };
  const perDay = typeof c.hoursPerDay === "number" && c.hoursPerDay > 0 ? Math.round(c.hoursPerDay * 60) : null;
  for (const r of await prisma.weeklyTarget.findMany({ where: { availableMinutes: null } })) {
    const available = r.targetMinutes === 0 ? 0 : Math.max(r.targetMinutes, perDay ?? r.targetMinutes);
    await prisma.weeklyTarget.updateMany({ where: { weekday: r.weekday }, data: { availableMinutes: available } });
  }
  // When study starts, as chosen at creation (docs/Google-Calendar-MVP-Plan.md §9).
  if (typeof c.studyStart === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(c.studyStart)) {
    const [h, m] = c.studyStart.split(":").map(Number);
    await prisma.settings.updateMany({ where: { studyStartMinute: null }, data: { studyStartMinute: h * 60 + m } });
  }
  if (typeof c.targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.targetDate)) {
    await prisma.settings.updateMany({ where: { targetDate: null }, data: { targetDate: i2d(c.targetDate) } });
  }
}

export async function loadSettings(prisma: Db) {
  const s = await prisma.settings.findFirst();
  if (!s) throw new HttpError(500, "NOT_SEEDED", "Settings missing: the database has not been seeded");
  return {
    journeyStart: d2i(s.journeyStart), journeyEnd: d2i(s.journeyEnd), timezone: s.timezone,
    revisionDailyMinutes: s.revisionDailyMinutes, revisionWeeklyOvertimeMinutes: s.revisionWeeklyOvertimeMinutes,
    targetDate: s.targetDate ? d2i(s.targetDate) : null,
  };
}

export function scheduleService(prisma: PrismaClient, today?: () => ISODate) {
  return {
    /** The latest re-plans that moved tasks, newest first. */
    async planChanges(limit = 5) {
      const rows = await prisma.planChange.findMany({ orderBy: { at: "desc" }, take: limit });
      return rows.map((r) => ({
        at: r.at.toISOString(), reason: r.reason, moved: r.moved,
        finishBefore: r.finishBefore ? d2i(r.finishBefore) : null, finishAfter: r.finishAfter ? d2i(r.finishAfter) : null,
      }));
    },

    async listStages() {
      const rows = await prisma.stage.findMany({ orderBy: { position: "asc" }, include: stageInclude });
      return rows.map(stageDTO);
    },

    async patchStage(id: string, body: { startDate?: string; endDate?: string }) {
      const s = await prisma.stage.findUnique({ where: { id } });
      if (!s) throw notFound("Stage");
      const settings = await loadSettings(prisma);
      const start = body.startDate ?? d2i(s.startDate);
      const end = body.endDate ?? d2i(s.endDate);
      if (start > end) throw new HttpError(400, "VALIDATION_ERROR", "startDate must not be after endDate");
      if (start < settings.journeyStart || end > settings.journeyEnd)
        throw new HttpError(400, "VALIDATION_ERROR", `Stage dates must lie within ${settings.journeyStart} – ${settings.journeyEnd}`);
      const u = await prisma.$transaction(async (tx) => {
        const row = await tx.stage.update({ where: { id }, data: { startDate: i2d(start), endDate: i2d(end) }, include: stageInclude });
        // The stage's work may start on other days now.
        if (today) await replanIn(tx, s.cityId, today(), "STAGES");
        return row;
      }, BULK_TX);
      return stageDTO(u);
    },

    async getSettings() {
      const [settings, targets] = await Promise.all([loadSettings(prisma), loadTargets(prisma)]);
      return {
        ...settings,
        weeklyTargets: Object.entries(targets).map(([weekday, targetMinutes]) => ({ weekday: Number(weekday), targetMinutes })),
      };
    },

    async patchSettings(body: { weeklyTargets?: { weekday: number; targetMinutes: number }[]; revisionDailyMinutes?: number; revisionWeeklyOvertimeMinutes?: number }) {
      await prisma.$transaction([
        ...(body.weeklyTargets ?? []).map((t) =>
          // Every city has all seven rows (created with its curriculum); the scoped client limits this to the city.
          prisma.weeklyTarget.updateMany({ where: { weekday: t.weekday }, data: { targetMinutes: t.targetMinutes } }),
        ),
        ...(body.revisionDailyMinutes !== undefined || body.revisionWeeklyOvertimeMinutes !== undefined
          ? [prisma.settings.updateMany({
              data: {
                ...(body.revisionDailyMinutes !== undefined && { revisionDailyMinutes: body.revisionDailyMinutes }),
                ...(body.revisionWeeklyOvertimeMinutes !== undefined && { revisionWeeklyOvertimeMinutes: body.revisionWeeklyOvertimeMinutes }),
              },
            })]
          : []),
      ]);
      // Study time decides where new material and recalls go: the plan is re-planned from today.
      if (today && body.weeklyTargets) {
        const city = await prisma.settings.findFirst({ select: { cityId: true } });
        if (city) await prisma.$transaction((tx) => replanIn(tx, city.cityId, today(), "AVAILABILITY"), BULK_TX);
      }
      return this.getSettings();
    },
  };
}
