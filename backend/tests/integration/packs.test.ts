/**
 * Revision v2, phase 1 end to end on a real database with the fake provider: material upload (text only kept),
 * consent, building a pack in the background, the concepts and questions, corrections, city isolation, rebuilding,
 * restart recovery, the export, and that nothing in learning or revision schedules changes.
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../prisma/seed.js";
import { createApp } from "../../src/app.js";
import { loadAuthConfig } from "../../src/config.js";
import { TestClock } from "../../src/lib/clock.js";
import { loadAiConfig } from "../../src/modules/ai/config.js";
import { createProviders } from "../../src/modules/ai/providers/factory.js";
import { memoryMailer } from "../../src/modules/auth/mailer.js";
import { recoverPacks } from "../../src/modules/revision/packService.js";
import { asUser, signIn } from "../helpers/auth.js";
import { docxWithParagraphs } from "../helpers/docx.js";

const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const schema = `it_pack_${Date.now()}`;
const url = base ? `${base}${base.includes("?") ? "&" : "?"}schema=${schema}` : "";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const NOTES = "## Generics\nType parameters let one function work for many types.\n## Constraints\nextends limits what a type parameter accepts.\n## Inference\nTypeScript infers type arguments from the call.";

suite("revision packs", () => {
  let prisma: PrismaClient;
  const clock = new TestClock("2026-11-20");
  const config = loadAiConfig({ AI_ENABLED: "true", AI_EVALUATION_PROVIDER: "fake", AI_GENERATION_PROVIDER: "fake", AI_GENERATION_RETRY_DELAYS_MS: "0,0" });
  let app: ReturnType<typeof createApp>;
  const H: Record<string, string> = {};
  const B: Record<string, string> = {};
  const T = "fe.ts";

  /** A real 1×1 PNG. */
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const upload = (name: string, type: string, body: Buffer | string, headers = H, topic = T) =>
    asUser(app, headers).post(`/api/topics/${topic}/revision/material?name=${encodeURIComponent(name)}`).set("Content-Type", type).send(Buffer.isBuffer(body) ? body : Buffer.from(body));
  async function ready(topic = T, headers = H) {
    for (let i = 0; i < 100; i++) {
      const o = (await asUser(app, headers).get(`/api/topics/${topic}/revision/pack`).expect(200)).body;
      if (!o.building) return o;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("pack did not finish");
  }

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = new PrismaClient({ datasourceUrl: url });
    await seed(prisma, () => {}, clock.date, { createEngineeringCity: true });
    app = createApp({ prisma, clock, authConfig: loadAuthConfig({ MAIL_TRANSPORT: "file" }), mailer: memoryMailer(), ai: { config, providers: createProviders(config) } });
    Object.assign(H, (await signIn(prisma)).headers);
    const other = await signIn(prisma, { email: "other@example.test", cityId: "none" });
    await prisma.city.create({ data: { id: "cother", idPrefix: "cother-", name: "Other", ownerId: other.user.id, status: "ACTIVE" } });
    Object.assign(B, { ...other.headers, "X-City-Id": "cother" });
  }, 120_000);
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  it("starts with no material and no pack, and asks for consent that names revision material", async () => {
    const o = (await asUser(app, H).get(`/api/topics/${T}/revision/pack`).expect(200)).body;
    expect(o).toMatchObject({ topicId: T, materials: [], pack: null, building: null, failed: null, ai: { available: false, reason: "CONSENT_REQUIRED" } });
    expect(o.limits.types).toEqual(expect.arrayContaining(["application/pdf", "text/markdown", "text/html", DOCX]));
    expect((await asUser(app, H).get("/api/legal/versions").expect(200)).body.AI_PROCESSING).toBe("2026-11-20.2");
  });

  it("keeps only the text of pasted notes, Word and HTML files, and refuses what it cannot read", async () => {
    const notes = (await upload("Pasted notes", "text/plain; charset=utf-8", NOTES).expect(201)).body;
    expect(notes).toMatchObject({ name: "Pasted notes", mimeType: "text/plain", hasText: true, chars: NOTES.length });
    const word = (await upload("generics.docx", DOCX, docxWithParagraphs(["Generic interfaces describe containers.", "keyof gives the keys of a type."])).expect(201)).body;
    expect(word).toMatchObject({ mimeType: DOCX, hasText: true });
    const html = (await upload("page.html", "text/html", "<h1>Mapped types</h1><script>x()</script><p>They transform every property of a type.</p>").expect(201)).body;
    expect(html.preview).toBe("Mapped types\n\nThey transform every property of a type.");
    const row = await prisma.revisionMaterial.findUniqueOrThrow({ where: { id: html.id } });
    expect(row).toMatchObject({ cityId: "engineering", topicId: T });
    expect(row.text).not.toContain("script");

    // A photo is read by the AI, so without consent nothing is sent and nothing is stored.
    expect((await upload("x.png", "image/png", PNG).expect(403)).body.error.code).toBe("AI_CONSENT_REQUIRED");
    expect((await upload("x.gif", "image/gif", "GIF89a").expect(415)).body.error.code).toBe("FILE_UNSUPPORTED");
    expect((await upload("bad.docx", DOCX, "this is not a word document at all").expect(415)).body.error.code).toBe("FILE_UNREADABLE");
    expect((await upload("tiny.txt", "text/plain", "too short").expect(422)).body.error.code).toBe("FILE_NO_TEXT");
    await upload("empty.txt", "text/plain", "").expect(400);
    await asUser(app, H).delete(`/api/topics/${T}/revision/material/${html.id}`).expect(204);
    await asUser(app, H).delete(`/api/topics/${T}/revision/material/${html.id}`).expect(404);
  });

  it("refuses to build without consent, then builds in the background once allowed", async () => {
    expect((await asUser(app, H).post(`/api/topics/${T}/revision/pack`).send({}).expect(403)).body.error.code).toBe("AI_CONSENT_REQUIRED");
    await asUser(app, H).post("/api/account/consents").send({ purpose: "AI_PROCESSING", granted: true }).expect(200);
    const tasks = await prisma.task.count(), schedules = await prisma.revisionSchedule.count(), done = await prisma.subtopic.count({ where: { completedAt: { not: null } } });

    const started = (await asUser(app, H).post(`/api/topics/${T}/revision/pack`).send({}).expect(202)).body;
    expect(started).toMatchObject({ version: 1, status: "BUILDING", basis: "MATERIAL" });
    const o = await ready();
    expect(o.failed).toBeNull();
    expect(o.pack).toMatchObject({ version: 1, status: "READY", basis: "MATERIAL", provider: "fake", promptVersion: "revision-pack-v1", stale: false });
    expect(o.pack.concepts.map((c: { title: string }) => c.title)).toEqual(["Generics", "Constraints", "Inference"]);
    for (const c of o.pack.concepts) {
      expect(c).toMatchObject({ status: "READY", removed: false, source: "AI", questions: { total: 12, open: 6, choice: 6 } });
      expect(Object.keys(c.questions.levels)).toEqual(["1", "2", "3", "4", "5", "6"]);
    }
    // Building a pack changes nothing in learning, tasks or revision schedules.
    expect([await prisma.task.count(), await prisma.revisionSchedule.count(), await prisma.subtopic.count({ where: { completedAt: { not: null } } })]).toEqual([tasks, schedules, done]);
    // The build was recorded in the usage ledger: concepts + two calls per concept (lower and upper levels).
    expect(await prisma.aiUsage.count({ where: { operation: "REVISION_PACK", outcome: "OK" } })).toBe(7);
  });

  it("shows a concept's questions with answers only when asked, and lets the learner correct them", async () => {
    const o = (await asUser(app, H).get(`/api/topics/${T}/revision/pack`).expect(200)).body;
    expect(JSON.stringify(o)).not.toContain("modelAnswer");
    const c = o.pack.concepts[0];
    const items = (await asUser(app, H).get(`/api/revision/concepts/${c.id}/items`).expect(200)).body;
    expect(items).toHaveLength(12);
    const mc = items.find((i: { kind: string }) => i.kind === "QUICK_CHOICE");
    expect(mc.options.filter((x: { correct: boolean }) => x.correct)).toHaveLength(1);
    expect(mc.options.every((x: { explanation: string }) => x.explanation.length > 0)).toBe(true);

    const q = items.find((i: { format: string }) => i.format === "OPEN");
    const edited = (await asUser(app, H).patch(`/api/revision/items/${q.id}`).send({ question: "In your words: what are generics for?", expected: ["one function, many types", "type safety kept"] }).expect(200)).body;
    expect(edited).toMatchObject({ question: "In your words: what are generics for?", source: "EDITED", expected: ["one function, many types", "type safety kept"] });
    expect((await asUser(app, H).patch(`/api/revision/items/${q.id}`).send({ removed: true }).expect(200)).body.removed).toBe(true);
    await asUser(app, H).patch(`/api/revision/items/${q.id}`).send({ expected: [] }).expect(400);
    await asUser(app, H).patch(`/api/revision/items/${q.id}`).send({}).expect(400);

    const left = (await asUser(app, H).patch(`/api/revision/concepts/${c.id}`).send({ removed: true }).expect(200)).body;
    expect(left).toMatchObject({ removed: true, questions: { total: 11 } });
    const back = (await asUser(app, H).patch(`/api/revision/concepts/${c.id}`).send({ removed: false, title: "Generic functions" }).expect(200)).body;
    expect(back).toMatchObject({ removed: false, title: "Generic functions", source: "EDITED" });
  });

  it("adds a learner's concept and writes its questions in the background", async () => {
    const c = (await asUser(app, H).post(`/api/topics/${T}/revision/concepts`).send({ title: "Utility types", summary: "Partial, Pick and Omit" }).expect(201)).body;
    expect(c).toMatchObject({ title: "Utility types", source: "LEARNER", status: "BUILDING" });
    for (let i = 0; i < 100; i++) {
      const row = await prisma.revisionConcept.findUniqueOrThrow({ where: { id: c.id } });
      if (row.status !== "BUILDING") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const o = (await asUser(app, H).get(`/api/topics/${T}/revision/pack`).expect(200)).body;
    expect(o.pack.concepts.at(-1)).toMatchObject({ title: "Utility types", status: "READY", questions: { total: 12 } });
  });

  it("keeps every city's material and packs to itself", async () => {
    const o = (await asUser(app, H).get(`/api/topics/${T}/revision/pack`).expect(200)).body;
    const c = o.pack.concepts[0];
    const item = (await asUser(app, H).get(`/api/revision/concepts/${c.id}/items`).expect(200)).body[0];
    await asUser(app, B).get(`/api/topics/${T}/revision/pack`).expect(404);
    await asUser(app, B).get(`/api/revision/concepts/${c.id}/items`).expect(404);
    await asUser(app, B).patch(`/api/revision/concepts/${c.id}`).send({ removed: true }).expect(404);
    await asUser(app, B).patch(`/api/revision/items/${item.id}`).send({ removed: true }).expect(404);
    await upload("x.txt", "text/plain", NOTES, B).expect(404);
    await asUser(app, B).delete(`/api/topics/${T}/revision/material/${o.materials[0].id}`).expect(404);
    await asUser(app, B).post(`/api/topics/${T}/revision/pack`).send({}).expect(404);
    await asUser(app, B).delete(`/api/topics/${T}/revision/pack`).expect(404);
    expect((await prisma.revisionConcept.findUniqueOrThrow({ where: { id: c.id } })).removedAt).toBeNull();
  });

  it("marks the pack stale when material changes, and a rebuild keeps the earlier version", async () => {
    await upload("more.md", "text/markdown", "## Conditional types\nT extends U ? X : Y picks a type by a condition.").expect(201);
    const before = (await asUser(app, H).get(`/api/topics/${T}/revision/pack`).expect(200)).body;
    expect(before.pack.stale).toBe(true);
    await asUser(app, H).post(`/api/topics/${T}/revision/pack`).send({}).expect(202);
    await asUser(app, H).post(`/api/topics/${T}/revision/pack`).send({}).expect(409);
    const o = await ready();
    expect(o.pack).toMatchObject({ version: 2, stale: false });
    expect(o.pack.concepts.map((c: { title: string }) => c.title)).toContain("Conditional types");
    expect((await prisma.revisionPack.findMany({ where: { topicId: T }, orderBy: { version: "asc" } })).map((p) => p.status)).toEqual(["SUPERSEDED", "READY"]);
  });

  it("builds from the topic outline when asked, with four levels", async () => {
    await asUser(app, H).post("/api/topics/fe.react/revision/pack").send({}).expect(400);
    await asUser(app, H).post("/api/topics/fe.react/revision/pack").send({ basis: "OUTLINE" }).expect(202);
    const o = await ready("fe.react");
    expect(o.pack.basis).toBe("OUTLINE");
    expect(Object.keys(o.pack.concepts[0].questions.levels)).toEqual(["1", "2", "3", "4"]);
  });

  it("marks builds interrupted by a restart as failed, and keeps the pack in use", async () => {
    const p = await prisma.revisionPack.create({ data: { cityId: "engineering", topicId: T, version: 3, basis: "MATERIAL", language: "en", provider: "fake", model: "fake-1", promptVersion: "revision-pack-v1" } });
    expect((await asUser(app, H).get(`/api/topics/${T}/revision/pack`).expect(200)).body.building.version).toBe(3);
    expect(await recoverPacks(prisma)).toBeGreaterThanOrEqual(1);
    const o = (await asUser(app, H).get(`/api/topics/${T}/revision/pack`).expect(200)).body;
    expect(o).toMatchObject({ building: null, failed: { version: 3 }, pack: { version: 2 } });
    expect((await prisma.revisionPack.findUniqueOrThrow({ where: { id: p.id } })).error).toMatch(/server restart/);
  });

  it("is in the city's data export, and deleting the pack keeps the material", async () => {
    const mine = (await asUser(app, H).get("/api/account/export").expect(200)).body;
    const city = mine.cities.find((c: { id: string }) => c.id === "engineering");
    expect(city.revisionMaterials.length).toBeGreaterThan(0);
    expect(city.revisionPacks.some((p: { concepts: { items: unknown[] }[] }) => p.concepts.some((c) => c.items.length > 0))).toBe(true);
    const theirs = (await asUser(app, B).get("/api/account/export").expect(200)).body;
    expect(theirs.cities.flatMap((c: { revisionMaterials: unknown[] }) => c.revisionMaterials)).toEqual([]);

    expect((await asUser(app, H).delete(`/api/topics/${T}/revision/pack`).expect(200)).body.deleted).toBe(3);
    const o = (await asUser(app, H).get(`/api/topics/${T}/revision/pack`).expect(200)).body;
    expect(o).toMatchObject({ pack: null, failed: null });
    expect(o.materials.length).toBeGreaterThan(0);
    expect(await prisma.revisionItem.count({ where: { concept: { pack: { topicId: T } } } })).toBe(0);
  });

  it("reads a photo of notes into text with the AI once, and keeps only the text (phase 4)", async () => {
    const o = (await asUser(app, H).get("/api/topics/fe.react/revision/pack").expect(200)).body;
    expect(o.limits.types).toEqual(expect.arrayContaining(["image/png", "image/jpeg", "image/webp"]));
    const calls = await prisma.aiUsage.count({ where: { operation: "REVISION_PACK" } });
    const photo = (await upload("notes.png", "image/png", PNG, H, "fe.react").expect(201)).body;
    expect(photo).toMatchObject({ name: "notes.png", mimeType: "image/png", hasText: true, pages: null });
    const row = await prisma.revisionMaterial.findUniqueOrThrow({ where: { id: photo.id } });
    expect(row.text).toBe(`# Notes from a photo\nAn image of ${PNG.length} bytes (image/png).\n- Generics let one function work for many types.\n- extends limits what a type parameter accepts.`);
    expect(JSON.stringify(row)).not.toContain(PNG.toString("base64").slice(0, 20)); // the image itself is not stored
    expect(await prisma.aiUsage.count({ where: { operation: "REVISION_PACK" } })).toBe(calls + 1);
    // The declared type must match the bytes.
    expect((await upload("fake.png", "image/png", "not an image at all", H, "fe.react").expect(415)).body.error.code).toBe("FILE_UNREADABLE");
    expect((await upload("png-as.webp", "image/webp", PNG, H, "fe.react").expect(415)).body.error.code).toBe("FILE_UNREADABLE");
  });
});
