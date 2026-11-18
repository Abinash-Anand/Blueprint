import type { Prisma, PrismaClient } from "@prisma/client";
import { d2i, i2d } from "../../db.js";
import { HttpError, notFound } from "../../lib/http.js";

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

export async function loadSettings(prisma: Db) {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!s) throw new HttpError(500, "NOT_SEEDED", "Settings missing: the database has not been seeded");
  return { journeyStart: d2i(s.journeyStart), journeyEnd: d2i(s.journeyEnd), timezone: s.timezone, revisionDailyMinutes: s.revisionDailyMinutes };
}

export function scheduleService(prisma: PrismaClient) {
  return {
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
      const u = await prisma.stage.update({ where: { id }, data: { startDate: i2d(start), endDate: i2d(end) }, include: stageInclude });
      return stageDTO(u);
    },

    async getSettings() {
      const [settings, targets] = await Promise.all([loadSettings(prisma), loadTargets(prisma)]);
      return {
        ...settings,
        weeklyTargets: Object.entries(targets).map(([weekday, targetMinutes]) => ({ weekday: Number(weekday), targetMinutes })),
      };
    },

    async patchSettings(body: { weeklyTargets?: { weekday: number; targetMinutes: number }[]; revisionDailyMinutes?: number }) {
      await prisma.$transaction([
        ...(body.weeklyTargets ?? []).map((t) =>
          prisma.weeklyTarget.upsert({
            where: { weekday: t.weekday },
            update: { targetMinutes: t.targetMinutes },
            create: { weekday: t.weekday, targetMinutes: t.targetMinutes },
          }),
        ),
        ...(body.revisionDailyMinutes !== undefined
          ? [prisma.settings.update({ where: { id: 1 }, data: { revisionDailyMinutes: body.revisionDailyMinutes } })]
          : []),
      ]);
      return this.getSettings();
    },
  };
}
