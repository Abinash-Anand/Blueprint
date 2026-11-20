/**
 * Revision material and packs (Revision v2 plan §3.2, §5, phase 1). Per topic: the learner's material (text only), a
 * pack built from it in the background, and the concepts and questions in it, which the learner can correct.
 *
 * - Everything goes through a city-scoped client, so no request can reach another city's topics, packs or questions.
 * - Building needs AI switched on and the learner's AI_PROCESSING consent at the current version, which names revision
 *   material. The material is sent to the generation provider only while a pack is built.
 * - A build never changes the pack in use until it has finished: a rebuild that fails leaves the previous pack as it was.
 * - Nothing here touches learning, demonstration, tasks or revision schedules.
 */
import type { Prisma, PrismaClient, RevisionConcept, RevisionItem, RevisionMaterial, RevisionPack } from "@prisma/client";
import type { Clock } from "../../lib/clock.js";
import { cityScoped } from "../../lib/cityScope.js";
import { HttpError, notFound } from "../../lib/http.js";
import { AttachmentError } from "../ai/curriculum/intake.js";
import type { AiConfig } from "../ai/config.js";
import { jobCaller } from "../ai/jobCaller.js";
import { ProviderError, asProviderError, type AiProviders } from "../ai/providers/types.js";
import type { UsageService } from "../ai/usage.js";
import type { AuthService } from "../auth/service.js";
import type { RateLimiter } from "../auth/security.js";
import { MATERIAL, MATERIAL_TYPES, extractMaterial, materialText } from "./material.js";
import {
  type BuiltConcept, type CheckedItem, ITEM_KINDS, type ItemKind, PACK_LIMITS, PACK_PROMPT_VERSION, PackError, type PackProgress,
  type PackRequest, basisOf, buildPack, maxLevel, writeConceptItems,
} from "./pack.js";

export interface PackDeps {
  prisma: PrismaClient;
  clock: Clock;
  ai: { config: AiConfig; providers: AiProviders };
  usage: UsageService;
  auth: AuthService;
  limiter: RateLimiter;
}

const HOUR = 3_600_000;
export const PACK_RATE = { buildsPerHour: 10, conceptsPerHour: 20, uploadsPerHour: 40 } as const;
/** Calls one build makes at most: concepts (with repair) + two level groups per concept (each with repair). */
const MAX_BUILD_CALLS = 2 + PACK_LIMITS.maxConcepts * 2 * 2;

const strings = (v: Prisma.JsonValue | null): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/* ---------------- what the learner sees ---------------- */

export const materialDTO = (m: RevisionMaterial) => ({
  id: m.id, name: m.name, mimeType: m.mimeType, size: m.size, pages: m.pages, chars: m.chars,
  hasText: m.chars >= MATERIAL.minChars, preview: m.text.slice(0, 200), createdAt: m.createdAt.toISOString(),
});

type ConceptRow = RevisionConcept & { items: Pick<RevisionItem, "level" | "format" | "removedAt">[]; subtopic: { name: string } | null };

export function conceptDTO(c: ConceptRow) {
  const live = c.items.filter((i) => !i.removedAt);
  const levels: Record<number, number> = {};
  for (const i of live) levels[i.level] = (levels[i.level] ?? 0) + 1;
  return {
    id: c.id, position: c.position, title: c.title, summary: c.summary,
    subtopicId: c.subtopicId, subtopicName: c.subtopic?.name ?? null,
    keyPoints: strings(c.keyPoints), misconceptions: strings(c.misconceptions),
    source: c.source, status: c.status, removed: !!c.removedAt,
    questions: { total: live.length, open: live.filter((i) => i.format === "OPEN").length, choice: live.filter((i) => i.format !== "OPEN").length, levels },
  };
}

export function itemDTO(i: RevisionItem) {
  return {
    id: i.id, conceptId: i.conceptId, level: i.level, kind: i.kind, format: i.format,
    situation: i.situation, code: i.code, question: i.question, answerSize: i.answerSize,
    expected: strings(i.expected), modelAnswer: i.modelAnswer, hints: strings(i.hints),
    options: Array.isArray(i.options) ? (i.options as { text: string; correct: boolean; explanation: string }[]) : null,
    source: i.source, removed: !!i.removedAt,
  };
}

function packDTO(p: RevisionPack, concepts: ConceptRow[] | null, materialIds: number[]) {
  const sources = (Array.isArray(p.sources) ? p.sources : []) as { id: number }[];
  const built = new Set(sources.map((x) => x.id));
  return {
    id: p.id, version: p.version, status: p.status, basis: p.basis, language: p.language,
    provider: p.provider, model: p.model, promptVersion: p.promptVersion,
    createdAt: p.createdAt.toISOString(), completedAt: p.completedAt?.toISOString() ?? null,
    progress: p.status === "BUILDING" ? (p.progress as unknown as PackProgress | null) : null,
    error: p.error,
    /** Material was added or removed since this pack was built. */
    stale: materialIds.length !== built.size || materialIds.some((id) => !built.has(id)),
    concepts: concepts?.map(conceptDTO) ?? null,
  };
}

/* ---------------- recovery ---------------- */

/** On start-up: builds that were running when the server stopped cannot finish; mark them so they can be restarted. */
export async function recoverPacks(prisma: PrismaClient) {
  const [packs, concepts] = await Promise.all([
    prisma.revisionPack.updateMany({ where: { status: "BUILDING" }, data: { status: "FAILED", error: "Interrupted by a server restart. Build it again.", progress: undefined } }),
    prisma.revisionConcept.updateMany({ where: { status: "BUILDING" }, data: { status: "NEEDS_QUESTIONS" } }),
  ]);
  return packs.count + concepts.count;
}

/* ---------------- service ---------------- */

const providerText = (e: unknown) => {
  if (e instanceof PackError) return e.message;
  const p = e instanceof ProviderError ? e : asProviderError(e);
  if (p.kind === "RATE_LIMITED") return "The AI provider's limit is reached for now. Try again later.";
  if (p.kind === "TIMEOUT") return "The AI provider took too long. Try again.";
  if (p.kind === "INVALID_OUTPUT") return "The AI provider returned something unusable. Try again.";
  return (p.status ?? 0) >= 500 ? "The AI provider is overloaded right now. Try again in a few minutes." : "The AI provider could not be reached. Try again later.";
};

const itemData = (conceptId: number, x: CheckedItem) => ({
  conceptId, level: x.level, kind: x.kind, format: x.format, situation: x.situation, code: x.code,
  question: x.question, answerSize: x.answerSize, expected: x.expected, modelAnswer: x.modelAnswer, hints: x.hints,
  options: x.options && x.format !== "OPEN" ? (x.options as unknown as Prisma.InputJsonValue) : undefined,
});

export function packService(d: PackDeps) {
  const { config, providers } = d.ai;
  const running = new Set<string>();

  async function availability(userId: string) {
    const consented = !!(await d.auth.hasConsent(userId, "AI_PROCESSING"));
    const reason = !config.enabled ? "AI_DISABLED" : !providers.generation ? "NO_PROVIDER" : !consented ? "CONSENT_REQUIRED" : null;
    return { available: reason === null, reason, consented, provider: config.generationProvider, model: config.generationModel };
  }

  async function requireAi(userId: string) {
    const a = await availability(userId);
    if (a.reason === "AI_DISABLED" || a.reason === "NO_PROVIDER") throw new HttpError(403, "AI_DISABLED", "Building a revision pack needs AI, which is switched off on this server.");
    if (a.reason === "CONSENT_REQUIRED") throw new HttpError(403, "AI_CONSENT_REQUIRED", "Allow sending your revision material to the AI provider first.");
  }

  async function topicOf(db: PrismaClient, topicId: string) {
    const t = await db.topic.findUnique({ where: { id: topicId }, include: { district: { select: { name: true } }, subtopics: { orderBy: { position: "asc" } } } });
    if (!t) throw notFound("Topic");
    return t;
  }

  const current = (db: PrismaClient, topicId: string) => db.revisionPack.findFirst({ where: { topicId, status: "READY" }, orderBy: { version: "desc" } });

  async function request(db: PrismaClient, userId: string, topicId: string): Promise<{ req: PackRequest; materials: RevisionMaterial[] }> {
    const [t, materials, user] = await Promise.all([
      topicOf(db, topicId),
      db.revisionMaterial.findMany({ where: { topicId }, orderBy: { id: "asc" } }),
      d.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { language: true } }),
    ]);
    return {
      materials,
      req: {
        topic: { name: t.name, description: t.description, district: t.district.name },
        subtopics: t.subtopics.map((x) => ({ name: x.name, learned: !!x.completedAt })),
        material: materialText(materials),
        language: user.language === "de" ? "de" : "en",
      },
    };
  }

  /**
   * Stores a finished build as the pack in use; the previous one is kept as SUPERSEDED. One transaction on the unscoped
   * client (an interactive transaction cannot be city-scoped), so every row names the pack's own city explicitly.
   */
  async function store(pack: RevisionPack, built: BuiltConcept[], subtopics: { id: number; name: string }[], models: string[]) {
    const byName = new Map(subtopics.map((x) => [x.name, x.id]));
    const cityId = pack.cityId;
    await d.prisma.$transaction(async (tx) => {
      for (const [position, c] of built.entries()) {
        const concept = await tx.revisionConcept.create({
          data: {
            cityId, packId: pack.id, position, title: c.title, summary: c.summary, subtopicId: c.subtopic ? (byName.get(c.subtopic) ?? null) : null,
            keyPoints: c.keyPoints, misconceptions: c.misconceptions, status: c.complete ? "READY" : "NEEDS_QUESTIONS",
          },
        });
        if (c.items.length) await tx.revisionItem.createMany({ data: c.items.map((x) => ({ cityId, ...itemData(concept.id, x) })) });
      }
      await tx.revisionPack.updateMany({ where: { cityId, topicId: pack.topicId, status: "READY", id: { not: pack.id } }, data: { status: "SUPERSEDED" } });
      await tx.revisionPack.update({
        where: { id: pack.id, cityId },
        data: { status: "READY", progress: undefined, completedAt: d.clock.now(), model: models.join(" + ") || pack.model },
      });
    }, { timeout: 30_000 });
  }

  async function run(cityId: string, pack: RevisionPack, req: PackRequest, subtopics: { id: number; name: string }[]) {
    const db = cityScoped(d.prisma, cityId);
    const key = `${cityId}/${pack.topicId}`;
    const report = async (p: PackProgress) => {
      await db.revisionPack.update({ where: { id: pack.id }, data: { progress: p as unknown as Prisma.InputJsonValue } });
    };
    const caller = jobCaller({ config, provider: providers.generation!, usage: d.usage, op: "REVISION_PACK", notice: (step, label) => report({ step, label, done: 0, total: 1 }) });
    try {
      const built = await buildPack(req, caller.call, report, config.generationConcurrency);
      await store(pack, built, subtopics, caller.used());
      console.log(JSON.stringify({ level: "info", msg: "Revision pack built", concepts: built.length, items: built.reduce((a, c) => a + c.items.length, 0), incomplete: built.filter((c) => !c.complete).length }));
    } catch (e) {
      await db.revisionPack.update({ where: { id: pack.id }, data: { status: "FAILED", error: providerText(e), progress: undefined } }).catch(() => undefined);
      if (!(e instanceof PackError) && !(e instanceof ProviderError))
        console.error(JSON.stringify({ level: "error", msg: "Revision pack failed", error: String((e as Error)?.message ?? e).slice(0, 300) }));
    } finally {
      running.delete(key);
    }
  }

  /** Writes a concept's questions. A top-up only adds questions: the concept keeps its status, and nothing fails loudly. */
  async function runConcept(cityId: string, conceptId: number, req: PackRequest, topUp = false) {
    const db = cityScoped(d.prisma, cityId);
    const c = await db.revisionConcept.findUniqueOrThrow({ where: { id: conceptId } });
    const caller = jobCaller({ config, provider: providers.generation!, usage: d.usage, op: "REVISION_PACK", notice: async () => {} });
    try {
      const r = await writeConceptItems(req, { title: c.title, summary: c.summary, keyPoints: strings(c.keyPoints), misconceptions: strings(c.misconceptions) }, caller.call);
      if (r.items.length) await db.revisionItem.createMany({ data: r.items.map((x) => itemData(c.id, x)) });
      if (!topUp) await db.revisionConcept.update({ where: { id: c.id }, data: { status: r.complete ? "READY" : "NEEDS_QUESTIONS" } });
      else console.log(JSON.stringify({ level: "info", msg: "Revision questions topped up", items: r.items.length }));
    } catch (e) {
      if (!topUp) await db.revisionConcept.update({ where: { id: c.id }, data: { status: "NEEDS_QUESTIONS" } }).catch(() => undefined);
      if (!(e instanceof ProviderError)) console.error(JSON.stringify({ level: "error", msg: "Concept questions failed", error: String((e as Error)?.message ?? e).slice(0, 300) }));
    }
  }

  const conceptInclude = { items: { select: { level: true, format: true, removedAt: true } }, subtopic: { select: { name: true } } } as const;

  async function conceptFor(db: PrismaClient, conceptId: number) {
    const c = await db.revisionConcept.findUnique({ where: { id: conceptId }, include: { pack: true } });
    if (!c) throw notFound("Concept");
    return c;
  }

  return {
    availability,

    /** Everything about a topic's revision preparation: material, the pack in use, a build in progress or failed. */
    async overview(db: PrismaClient, userId: string, topicId: string) {
      await topicOf(db, topicId);
      const [materials, packs, ai] = await Promise.all([
        db.revisionMaterial.findMany({ where: { topicId }, orderBy: { id: "asc" } }),
        db.revisionPack.findMany({ where: { topicId, status: { in: ["READY", "BUILDING", "FAILED"] } }, orderBy: { version: "desc" } }),
        availability(userId),
      ]);
      const ids = materials.map((m) => m.id);
      const inUse = packs.find((p) => p.status === "READY") ?? null;
      const building = packs.find((p) => p.status === "BUILDING") ?? null;
      const failed = packs.find((p) => p.status === "FAILED" && (!inUse || p.version > inUse.version) && (!building || p.version > building.version)) ?? null;
      const concepts = inUse ? await db.revisionConcept.findMany({ where: { packId: inUse.id }, orderBy: { position: "asc" }, include: conceptInclude }) : null;
      return {
        topicId,
        ai,
        limits: { maxFiles: MATERIAL.maxFiles, maxBytes: MATERIAL.maxBytes, maxChars: MATERIAL.maxChars, types: Object.keys(MATERIAL_TYPES) },
        materials: materials.map(materialDTO),
        pack: inUse ? packDTO(inUse, concepts, ids) : null,
        building: building ? packDTO(building, null, ids) : null,
        failed: failed ? { version: failed.version, error: failed.error, createdAt: failed.createdAt.toISOString() } : null,
      };
    },

    /** Reads a file (or pasted notes, sent as text/plain) and keeps only its text. */
    async addMaterial(db: PrismaClient, userId: string, topicId: string, name: string, mimeType: string, body: Buffer) {
      await topicOf(db, topicId);
      if (!MATERIAL_TYPES[mimeType]) throw new HttpError(415, "FILE_UNSUPPORTED", "Add a PDF, Word (.docx), Markdown, HTML or text file.");
      if (body.length === 0) throw new HttpError(400, "FILE_EMPTY", "The file is empty.");
      if (body.length > MATERIAL.maxBytes) throw new HttpError(413, "FILE_TOO_LARGE", "Files can be at most 5 MB.");
      if ((await db.revisionMaterial.count({ where: { topicId } })) >= MATERIAL.maxFiles)
        throw new HttpError(409, "TOO_MANY_FILES", `A topic can have at most ${MATERIAL.maxFiles} files or notes. Remove one first.`);
      d.limiter.take(`material:${userId}`, PACK_RATE.uploadsPerHour, HOUR);
      let extracted: { text: string; pages: number | null };
      try {
        extracted = await extractMaterial(body, mimeType);
      } catch (e) {
        if (e instanceof AttachmentError) {
          const what = MATERIAL_TYPES[mimeType] === "pdf" ? "This PDF" : MATERIAL_TYPES[mimeType] === "docx" ? "This Word file" : "This file";
          throw new HttpError(415, "FILE_UNREADABLE", `${what} couldn't be read. Save it again (Word as .docx, or as PDF), or paste the text instead.`);
        }
        throw e;
      }
      if (extracted.text.length < MATERIAL.minChars)
        throw new HttpError(422, "FILE_NO_TEXT", "No text was found in this file. A scanned PDF has none: paste your notes instead.");
      const row = await db.revisionMaterial.create({
        data: { topicId, name: name.slice(0, 120), mimeType, size: body.length, pages: extracted.pages, chars: extracted.text.length, text: extracted.text },
      });
      return materialDTO(row);
    },

    async removeMaterial(db: PrismaClient, topicId: string, materialId: number) {
      const r = await db.revisionMaterial.deleteMany({ where: { id: materialId, topicId } });
      if (!r.count) throw new HttpError(404, "FILE_NOT_FOUND", "File not found");
    },

    /** Starts building a pack in the background (202). basis OUTLINE builds without material (plan §5.3). */
    async build(db: PrismaClient, cityId: string, userId: string, topicId: string, basis: "MATERIAL" | "OUTLINE") {
      const t = await topicOf(db, topicId);
      await requireAi(userId);
      const key = `${cityId}/${topicId}`;
      if (running.has(key) || (await db.revisionPack.count({ where: { topicId, status: "BUILDING" } })))
        throw new HttpError(409, "PACK_IN_PROGRESS", "This topic's revision pack is already being built.");
      const { req, materials } = await request(db, userId, topicId);
      if (basis === "OUTLINE") req.material = "";
      else if (!req.material) throw new HttpError(400, "MATERIAL_REQUIRED", "Add what you studied first, or build from the topic outline.");
      d.limiter.take(`pack:${userId}`, PACK_RATE.buildsPerHour, HOUR);
      await d.usage.check("REVISION_PACK", providers.generation!.name, config.generationDailyLimit, MAX_BUILD_CALLS);
      const last = await db.revisionPack.findFirst({ where: { topicId }, orderBy: { version: "desc" }, select: { version: true } });
      const pack = await db.revisionPack.create({
        data: {
          topicId, version: (last?.version ?? 0) + 1, status: "BUILDING", basis: basisOf(req), language: req.language,
          provider: config.generationProvider, model: config.generationModel, promptVersion: PACK_PROMPT_VERSION,
          sources: (basis === "OUTLINE" ? [] : materials.filter((m) => m.chars >= MATERIAL.minChars).map((m) => ({ id: m.id, name: m.name, chars: m.chars }))) as Prisma.InputJsonValue,
          progress: { step: "queued", label: "Starting", done: 0, total: 1 } as Prisma.InputJsonValue,
        },
      });
      running.add(key);
      void run(cityId, pack, req, t.subtopics);
      return { version: pack.version, status: pack.status, basis: pack.basis };
    },

    /** Deletes every version of a topic's pack (its concepts and questions with it); the material stays. */
    async deletePacks(db: PrismaClient, topicId: string) {
      await topicOf(db, topicId);
      if (await db.revisionPack.count({ where: { topicId, status: "BUILDING" } })) throw new HttpError(409, "PACK_IN_PROGRESS", "Wait until the pack is built.");
      const r = await db.revisionPack.deleteMany({ where: { topicId } });
      return { deleted: r.count };
    },

    /**
     * A few more questions, in the background, for concepts whose questions near the wanted level have all been asked
     * (plan §5.2). Silent: nothing happens when AI is off or not allowed, the provider's limit is reached, or the concept
     * already has plenty of questions.
     */
    async topUp(db: PrismaClient, cityId: string, userId: string, conceptIds: number[]) {
      if (!(await availability(userId)).available) return 0;
      let started = 0;
      for (const id of conceptIds.slice(0, 3)) {
        const key = `top:${cityId}:${id}`;
        if (running.has(key)) continue;
        const c = await db.revisionConcept.findUnique({ where: { id }, include: { pack: true, _count: { select: { items: true } } } });
        if (!c || c.removedAt || c.status === "BUILDING" || c.pack.status !== "READY" || c._count.items >= PACK_LIMITS.maxItemsPerConcept * 2) continue;
        try {
          await d.usage.check("REVISION_PACK", providers.generation!.name, config.generationDailyLimit, 4);
        } catch {
          return started;
        }
        const { req } = await request(db, userId, c.pack.topicId);
        if (c.pack.basis === "OUTLINE") req.material = "";
        running.add(key);
        started++;
        void runConcept(cityId, id, req, true).finally(() => running.delete(key));
      }
      return started;
    },

    async items(db: PrismaClient, conceptId: number) {
      await conceptFor(db, conceptId);
      const xs = await db.revisionItem.findMany({ where: { conceptId }, orderBy: [{ level: "asc" }, { id: "asc" }] });
      return xs.map(itemDTO);
    },

    async updateConcept(db: PrismaClient, conceptId: number, b: { title?: string; summary?: string; removed?: boolean }) {
      const c = await conceptFor(db, conceptId);
      const text = b.title !== undefined || b.summary !== undefined;
      await db.revisionConcept.update({
        where: { id: c.id },
        data: {
          ...(b.title !== undefined ? { title: b.title } : {}),
          ...(b.summary !== undefined ? { summary: b.summary } : {}),
          ...(text && c.source === "AI" ? { source: "EDITED" } : {}),
          ...(b.removed !== undefined ? { removedAt: b.removed ? (c.removedAt ?? d.clock.now()) : null } : {}),
        },
      });
      return conceptDTO(await db.revisionConcept.findUniqueOrThrow({ where: { id: c.id }, include: conceptInclude }));
    },

    /** A concept the learner adds to the pack in use; its questions are written in the background. */
    async addConcept(db: PrismaClient, cityId: string, userId: string, topicId: string, b: { title: string; summary?: string }) {
      await topicOf(db, topicId);
      await requireAi(userId);
      const pack = await current(db, topicId);
      if (!pack) throw new HttpError(409, "PACK_REQUIRED", "Build the revision pack first.");
      d.limiter.take(`concept:${userId}`, PACK_RATE.conceptsPerHour, HOUR);
      await d.usage.check("REVISION_PACK", providers.generation!.name, config.generationDailyLimit, 4);
      const { req } = await request(db, userId, topicId);
      if (pack.basis === "OUTLINE") req.material = "";
      const last = await db.revisionConcept.findFirst({ where: { packId: pack.id }, orderBy: { position: "desc" }, select: { position: true } });
      const c = await db.revisionConcept.create({
        data: { packId: pack.id, position: (last?.position ?? -1) + 1, title: b.title, summary: b.summary?.trim() || b.title, source: "LEARNER", status: "BUILDING" },
      });
      void runConcept(cityId, c.id, req);
      return conceptDTO(await db.revisionConcept.findUniqueOrThrow({ where: { id: c.id }, include: conceptInclude }));
    },

    async updateItem(db: PrismaClient, itemId: number, b: { question?: string; situation?: string; expected?: string[]; modelAnswer?: string; removed?: boolean }) {
      const it = await db.revisionItem.findUnique({ where: { id: itemId } });
      if (!it) throw notFound("Question");
      const text = b.question !== undefined || b.situation !== undefined || b.expected !== undefined || b.modelAnswer !== undefined;
      if (b.expected !== undefined && it.format === "OPEN" && b.expected.length < 1) throw new HttpError(400, "VALIDATION_FAILED", "Keep at least one expected point.");
      const row = await db.revisionItem.update({
        where: { id: it.id },
        data: {
          ...(b.question !== undefined ? { question: b.question } : {}),
          ...(b.situation !== undefined ? { situation: b.situation } : {}),
          ...(b.expected !== undefined ? { expected: b.expected } : {}),
          ...(b.modelAnswer !== undefined ? { modelAnswer: b.modelAnswer } : {}),
          ...(text ? { source: "EDITED" } : {}),
          ...(b.removed !== undefined ? { removedAt: b.removed ? (it.removedAt ?? d.clock.now()) : null } : {}),
        },
      });
      return itemDTO(row);
    },
  };
}
export type PackService = ReturnType<typeof packService>;

/** Kinds and levels, for the client's labels. */
export const packCatalog = () => ({
  kinds: Object.fromEntries(Object.entries(ITEM_KINDS).map(([k, v]) => [k, { format: v.format, levels: [...v.levels] }])) as Record<ItemKind, { format: string; levels: number[] }>,
  maxLevel: { MATERIAL: maxLevel("MATERIAL"), OUTLINE: maxLevel("OUTLINE") },
});
