/**
 * Cities and their curriculum versions (docs/Sprint-Multi-User.md §4–§6). Every method is bound to one user and
 * filters by owner, so another user's city id behaves exactly like a missing one.
 */
import { randomBytes } from "node:crypto";
import type { City, CityStatus, Prisma, PrismaClient } from "@prisma/client";
import { cityPresentation } from "../../domain/presentation.js";
import type { Clock } from "../../lib/clock.js";
import { cityScoped } from "../../lib/cityScope.js";
import { HttpError } from "../../lib/http.js";
import { recordAvailability } from "../schedule/service.js";
import { TEMPLATES, type TemplateId, applyCurriculum } from "./apply.js";
import { updatePlanForCurriculum } from "./planUpdate.js";
import { CURRICULUM_CONTRACT_VERSION, type CurriculumDocument, diffCurriculum, shiftDocument, validateCurriculum } from "./contract.js";

export interface CityInput {
  name: string;
  description?: string;
  goal?: string;
  category?: string | null;
  requirements?: Record<string, unknown> | null;
  constraints?: Record<string, unknown> | null;
}
export type StatusAction = "pause" | "resume" | "complete" | "reopen" | "archive" | "restore";
export type ProposalInput = { source: "TEMPLATE"; template: TemplateId; start?: string } | { source: "IMPORT"; document: unknown; note?: string };

/** Allowed transitions; anything else is a 409. */
const TRANSITIONS: Record<StatusAction, { from: CityStatus[]; to: (c: City) => CityStatus }> = {
  pause: { from: ["ACTIVE"], to: () => "PAUSED" },
  resume: { from: ["PAUSED"], to: () => "ACTIVE" },
  complete: { from: ["ACTIVE", "PAUSED"], to: () => "COMPLETED" },
  reopen: { from: ["COMPLETED"], to: () => "ACTIVE" },
  archive: { from: ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"], to: () => "ARCHIVED" },
  // A restored city comes back active if it has a curriculum, otherwise as a draft.
  restore: { from: ["ARCHIVED"], to: (c) => (c.template || c.status === "ARCHIVED" ? "ACTIVE" : "DRAFT") },
};

export const cityDTO = (c: City & { _count?: { topics: number; versions: number } }) => ({
  id: c.id, name: c.name, description: c.description, goal: c.goal, category: c.category, status: c.status, presentation: cityPresentation(c.status), template: c.template,
  requirements: c.requirements, constraints: c.constraints,
  createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
  pausedAt: c.pausedAt?.toISOString() ?? null, archivedAt: c.archivedAt?.toISOString() ?? null, completedAt: c.completedAt?.toISOString() ?? null,
  topics: c._count?.topics ?? null, versions: c._count?.versions ?? null,
});

const versionDTO = (v: Prisma.CurriculumVersionGetPayload<object>, withContent = false) => {
  // A version that is still being generated, or failed, has no curriculum yet.
  const doc = v.status === "GENERATING" || v.status === "FAILED" ? null : (v.content as unknown as CurriculumDocument);
  const all = doc?.districts.flatMap((d) => d.topics) ?? [];
  return {
    version: v.version, status: v.status, source: v.source, contractVersion: v.contractVersion, note: v.note,
    createdAt: v.createdAt.toISOString(), appliedAt: v.appliedAt?.toISOString() ?? null, changes: v.changes,
    progress: v.status === "GENERATING" ? v.progress : null,
    error: v.status === "FAILED" ? v.error : null,
    summary: doc ? { title: doc.title, districts: doc.districts.length, topics: all.length, hours: all.reduce((a, t) => a + t.hours, 0), start: doc.journey.start, end: doc.journey.end } : null,
    ...(withContent && doc && { content: doc }),
  };
};

export function cityService(prisma: PrismaClient, clock: Clock, userId: string) {
  async function own(id: string) {
    const c = await prisma.city.findFirst({ where: { id, ownerId: userId } });
    if (!c) throw new HttpError(404, "CITY_NOT_FOUND", "City not found");
    return c;
  }

  /** Topics a new version would remove that carry learning history (never deleted silently). */
  async function removalsWithHistory(city: City, keys: string[]) {
    if (!keys.length) return [];
    const ids = keys.map((k) => `${city.idPrefix}${k}`);
    const db = cityScoped(prisma, city.id);
    const [tasks, subs, schedules, sessions, topics] = await Promise.all([
      db.task.findMany({ where: { topicId: { in: ids }, OR: [{ status: "DONE" }, { sessions: { some: {} } }] }, select: { topicId: true } }),
      db.subtopic.findMany({ where: { topicId: { in: ids }, completedAt: { not: null } }, select: { topicId: true } }),
      db.revisionSchedule.findMany({ where: { topicId: { in: ids } }, select: { topicId: true } }),
      db.studySession.findMany({ where: { topicId: { in: ids } }, select: { topicId: true } }),
      db.topic.findMany({ where: { id: { in: ids }, demonstratedAt: { not: null } }, select: { id: true } }),
    ]);
    const hit = new Set([...tasks, ...subs, ...schedules, ...sessions].map((x) => x.topicId).concat(topics.map((t) => t.id)));
    return keys.filter((k) => hit.has(`${city.idPrefix}${k}`));
  }

  return {
    async list() {
      const rows = await prisma.city.findMany({
        where: { ownerId: userId },
        orderBy: [{ updatedAt: "desc" }],
        include: { _count: { select: { topics: true, versions: true } } },
      });
      return rows.map(cityDTO);
    },

    async get(id: string) {
      await own(id);
      const c = await prisma.city.findUniqueOrThrow({ where: { id }, include: { _count: { select: { topics: true, versions: true } } } });
      return cityDTO(c);
    },

    async create(b: CityInput) {
      const id = `c${randomBytes(6).toString("hex")}`; // opaque, not guessable from another user's ids
      const c = await prisma.city.create({
        data: {
          id, idPrefix: `${id}.`, ownerId: userId, name: b.name.trim(), description: b.description?.trim() ?? "", goal: b.goal?.trim() ?? "",
          category: b.category?.trim() || null, status: "DRAFT",
          requirements: (b.requirements ?? undefined) as Prisma.InputJsonValue | undefined,
          constraints: (b.constraints ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      return cityDTO(c);
    },

    async update(id: string, b: Partial<CityInput>) {
      const c = await own(id);
      if (c.status === "ARCHIVED") throw new HttpError(409, "CITY_ARCHIVED", "This city is archived. Restore it to make changes.");
      const u = await prisma.city.update({
        where: { id },
        data: {
          ...(b.name !== undefined && { name: b.name.trim() }),
          ...(b.description !== undefined && { description: b.description.trim() }),
          ...(b.goal !== undefined && { goal: b.goal.trim() }),
          ...(b.category !== undefined && { category: b.category?.trim() || null }),
          ...(b.requirements !== undefined && { requirements: (b.requirements ?? undefined) as Prisma.InputJsonValue }),
          ...(b.constraints !== undefined && { constraints: (b.constraints ?? undefined) as Prisma.InputJsonValue }),
        },
      });
      return cityDTO(u);
    },

    async changeStatus(id: string, action: StatusAction) {
      const c = await own(id);
      const t = TRANSITIONS[action];
      if (!t.from.includes(c.status)) throw new HttpError(409, "INVALID_STATUS_CHANGE", `A ${c.status.toLowerCase()} city cannot be ${action === "restore" ? "restored" : `${action}d`}.`);
      const hasCurriculum = (await prisma.curriculumVersion.count({ where: { cityId: id, status: "APPLIED" } })) > 0 || !!c.template;
      const to = action === "restore" ? (hasCurriculum ? "ACTIVE" : "DRAFT") : t.to(c);
      const now = new Date();
      const u = await prisma.city.update({
        where: { id },
        data: {
          status: to,
          pausedAt: to === "PAUSED" ? now : null,
          archivedAt: to === "ARCHIVED" ? now : null,
          completedAt: to === "COMPLETED" ? now : to === "ARCHIVED" ? c.completedAt : null,
        },
      });
      return cityDTO(u);
    },

    /** Only an archived or draft city can be deleted, and only with its exact name typed. Removes all its data. */
    async remove(id: string, confirmName: string) {
      const c = await own(id);
      if (c.status !== "ARCHIVED" && c.status !== "DRAFT") throw new HttpError(409, "ARCHIVE_FIRST", "Archive the city before deleting it.");
      if (confirmName.trim() !== c.name) throw new HttpError(400, "CONFIRMATION_MISMATCH", "Type the city's name exactly to delete it.");
      await prisma.city.delete({ where: { id } });
    },

    templates() {
      return Object.values(TEMPLATES).map((t) => {
        const doc = t.build();
        const all = doc.districts.flatMap((d) => d.topics);
        return { id: t.id, name: t.name, description: t.description, districts: doc.districts.length, topics: all.length, hours: all.reduce((a, x) => a + x.hours, 0), weeks: Math.round((Date.parse(doc.journey.end) - Date.parse(doc.journey.start)) / 604_800_000) };
      });
    },

    async versions(id: string) {
      await own(id);
      const rows = await prisma.curriculumVersion.findMany({ where: { cityId: id }, orderBy: { version: "desc" } });
      return rows.map((v) => versionDTO(v));
    },

    async version(id: string, version: number) {
      await own(id);
      const v = await prisma.curriculumVersion.findUnique({ where: { cityId_version: { cityId: id, version } } });
      if (!v) throw new HttpError(404, "NOT_FOUND", "Curriculum version not found");
      return versionDTO(v, true);
    },

    /** Validates a curriculum and stores it as a proposal (nothing changes in the city until it is approved). */
    async propose(id: string, input: ProposalInput) {
      const c = await own(id);
      if (c.status === "ARCHIVED") throw new HttpError(409, "CITY_ARCHIVED", "This city is archived. Restore it to make changes.");
      let raw: unknown;
      let source: "TEMPLATE" | "IMPORT";
      if (input.source === "TEMPLATE") {
        const t = TEMPLATES[input.template];
        if (!t) throw new HttpError(400, "UNKNOWN_TEMPLATE", "Unknown template");
        const start = input.start ?? ((c.constraints as { startDate?: string } | null)?.startDate || clock.today());
        raw = shiftDocument(t.build(), start);
        source = "TEMPLATE";
      } else {
        raw = input.document;
        source = "IMPORT";
      }
      const v = validateCurriculum(raw);
      if (!v.ok) throw new HttpError(422, "CURRICULUM_INVALID", "The curriculum does not match the Blueprint curriculum contract.", v.issues);
      const applied = await prisma.curriculumVersion.findFirst({ where: { cityId: id, status: "APPLIED" }, orderBy: { version: "desc" } });
      const changes = diffCurriculum(applied ? (applied.content as unknown as CurriculumDocument) : null, v.document);
      const last = await prisma.curriculumVersion.findFirst({ where: { cityId: id }, orderBy: { version: "desc" }, select: { version: true } });
      // Older open proposals are superseded by this one.
      await prisma.curriculumVersion.updateMany({ where: { cityId: id, status: "PROPOSED" }, data: { status: "REJECTED" } });
      const row = await prisma.curriculumVersion.create({
        data: {
          cityId: id, version: (last?.version ?? 0) + 1, status: "PROPOSED", source, contractVersion: CURRICULUM_CONTRACT_VERSION,
          content: v.document as unknown as Prisma.InputJsonValue, changes: changes as unknown as Prisma.InputJsonValue,
          note: input.source === "IMPORT" ? (input.note ?? "") : `Template: ${input.template}`,
        },
      });
      return { ...versionDTO(row), blockedRemovals: await removalsWithHistory(c, changes.removed.topics) };
    },

    async reject(id: string, version: number) {
      await own(id);
      const r = await prisma.curriculumVersion.updateMany({ where: { cityId: id, version, status: "PROPOSED" }, data: { status: "REJECTED" } });
      if (!r.count) throw new HttpError(409, "NOT_PROPOSED", "Only an open proposal can be rejected.");
    },

    /**
     * Applies a proposal. A draft city gets its whole curriculum, calendar and plan and becomes active. An active city
     * gets added and changed topics; removing a topic that has any learning history is refused (409), others go.
     * Idempotent: if writing fails half-way, approving again completes it.
     */
    async approve(id: string, version: number) {
      const c = await own(id);
      if (c.status === "ARCHIVED") throw new HttpError(409, "CITY_ARCHIVED", "This city is archived. Restore it to make changes.");
      const v = await prisma.curriculumVersion.findUnique({ where: { cityId_version: { cityId: id, version } } });
      if (!v || v.status !== "PROPOSED") throw new HttpError(409, "NOT_PROPOSED", "Only an open proposal can be approved.");
      const doc = v.content as unknown as CurriculumDocument;
      const prev = ((await prisma.curriculumVersion.findFirst({ where: { cityId: id, status: "APPLIED" }, orderBy: { version: "desc" } }))?.content ?? null) as unknown as CurriculumDocument | null;
      const changes = diffCurriculum(prev, doc);
      const blocked = await removalsWithHistory(c, changes.removed.topics);
      if (blocked.length) throw new HttpError(409, "CURRICULUM_REMOVAL_BLOCKED", "This version removes topics that have learning history. Keep them in the curriculum.", { topics: blocked });
      const db = cityScoped(prisma, id);
      if (changes.removed.topics.length) {
        const ids = changes.removed.topics.map((k) => `${c.idPrefix}${k}`);
        await db.task.deleteMany({ where: { topicId: { in: ids }, status: "TODO", source: "PLAN" } });
        await db.topic.deleteMany({ where: { id: { in: ids } } });
      }
      await applyCurriculum(db, doc, c.idPrefix, clock.today());
      await recordAvailability(db, c.constraints);
      // An active city's plan follows the new version: new topics get tasks, changed hours resize, then it is re-planned.
      // (A draft city's whole plan was just built from it.)
      if (c.status !== "DRAFT") await updatePlanForCurriculum(db, id, c.idPrefix, prev, doc, clock.today());
      for (const k of changes.removed.districts) await db.district.deleteMany({ where: { id: `${c.idPrefix}${k}`, topics: { none: {} } } });
      const appliedAt = new Date();
      await prisma.$transaction([
        prisma.curriculumVersion.update({ where: { id: v.id }, data: { status: "APPLIED", appliedAt, changes: changes as unknown as Prisma.InputJsonValue } }),
        prisma.city.update({ where: { id }, data: { status: c.status === "DRAFT" ? "ACTIVE" : c.status } }),
      ]);
      return this.get(id);
    },
  };
}
