/**
 * Multi-user isolation, city management, curriculum versioning and data rights (docs/Sprint-Multi-User.md) against a
 * real database. User A owns the original Engineering City; user B builds a second city from the template and tries
 * to reach A's data with manipulated ids. Fresh schema per run, dropped after.
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { loadAuthConfig } from "../../src/config.js";
import { TestClock } from "../../src/lib/clock.js";
import { cityScoped } from "../../src/lib/cityScope.js";
import { engineeringTemplate } from "../../src/modules/cities/apply.js";
import { memoryMailer } from "../../src/modules/auth/mailer.js";
import { seed } from "../../prisma/seed.js";
import { TEST_PASSWORD, asUser, signIn } from "../helpers/auth.js";

const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const schema = `it_multi_${Date.now()}`;
const url = base ? `${base}${base.includes("?") ? "&" : "?"}schema=${schema}` : "";

suite("multi-user foundation", () => {
  let prisma: PrismaClient;
  const clock = new TestClock("2026-11-18");
  let app: ReturnType<typeof createApp>;
  const A: Record<string, string> = {};
  const B: Record<string, string> = {};
  let bCity = "";
  let aPlan = 0;
  const bWith = (city: string) => ({ ...B, "X-City-Id": city });

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = new PrismaClient({ datasourceUrl: url });
    await seed(prisma, () => {}, clock.date, { createEngineeringCity: true });
    app = createApp({ prisma, clock, authConfig: loadAuthConfig({ MAIL_TRANSPORT: "file" }), mailer: memoryMailer() });
    Object.assign(A, (await signIn(prisma, { email: "a@example.test", name: "A" })).headers);
    const b = await signIn(prisma, { email: "b@example.test", name: "B", cityId: "none-yet" });
    Object.assign(B, b.headers);
    // A learns something and records history in their city.
    const sub = await prisma.subtopic.findFirstOrThrow({ where: { topicId: "fe.ts", position: 0 } });
    await asUser(app, A).patch(`/api/subtopics/${sub.id}`).send({ completed: true }).expect(200);
    aPlan = await prisma.task.count({ where: { cityId: "engineering", source: "PLAN" } });
  }, 120_000);
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  describe("city management", () => {
    it("creates a draft city with the creation answers, and refuses learning views until a curriculum is approved", async () => {
      const r = await asUser(app, B).post("/api/cities").send({
        name: "Engineering again", description: "Second run", goal: "Practise", category: "Software",
        requirements: { outcome: "Ship a product", currentLevel: "BEGINNER", targetLevel: "WORKING", subjects: ["TypeScript"] },
        constraints: { hoursPerDay: 2, daysPerWeek: 5, pace: "STEADY", startDate: "2026-11-23", timezone: "Europe/Berlin" },
      }).expect(201);
      bCity = r.body.id;
      expect(r.body).toMatchObject({ status: "DRAFT", name: "Engineering again", requirements: { currentLevel: "BEGINNER" } });
      expect(bCity).toMatch(/^c[0-9a-f]{12}$/);
      expect((await asUser(app, bWith(bCity)).get("/api/today").expect(409)).body.error.code).toBe("CITY_NOT_READY");
      await asUser(app, B).post("/api/cities").send({ name: "" }).expect(400);
      await asUser(app, B).post("/api/cities").send({ name: "x", constraints: { startDate: "2026-12-01", targetDate: "2026-11-01" } }).expect(400);
    });

    it("validates an imported curriculum against the contract and reports every problem", async () => {
      const doc = engineeringTemplate();
      const broken = { ...doc, districts: doc.districts.map((d, i) => (i === 0 ? { ...d, topics: d.topics.map((t, j) => (j === 0 ? { ...t, dependsOn: ["no.such.topic"] } : t)) } : d)) };
      const r = await asUser(app, B).post(`/api/cities/${bCity}/curriculum/proposals`).send({ source: "IMPORT", document: broken }).expect(422);
      expect(r.body.error.code).toBe("CURRICULUM_INVALID");
      expect(r.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ message: 'unknown topic "no.such.topic"' })]));
      const shape = await asUser(app, B).post(`/api/cities/${bCity}/curriculum/proposals`).send({ source: "IMPORT", document: { contractVersion: 1, title: "x" } }).expect(422);
      expect(shape.body.error.details.length).toBeGreaterThan(0);
      expect((await asUser(app, B).get("/api/curriculum/contract").expect(200)).body.type).toBe("object");
    });

    it("proposes the template from the chosen start date and builds the whole city on approval", async () => {
      const p = await asUser(app, B).post(`/api/cities/${bCity}/curriculum/proposals`).send({ source: "TEMPLATE", template: "engineering" }).expect(201);
      expect(p.body).toMatchObject({ version: 1, status: "PROPOSED", source: "TEMPLATE", summary: { districts: 7, topics: 83, start: "2026-11-23" } });
      expect(p.body.changes.added.topics).toHaveLength(83);
      const a = await asUser(app, B).post(`/api/cities/${bCity}/curriculum/versions/1/approve`).send({}).expect(200);
      expect(a.body.status).toBe("ACTIVE");
      const cur = (await asUser(app, bWith(bCity)).get("/api/curriculum").expect(200)).body;
      expect(cur.districts).toHaveLength(7);
      expect(cur.districts[0].topics[0].id).toBe(`${bCity}.fe.ts`);
      expect(await prisma.task.count({ where: { cityId: bCity, source: "PLAN" } })).toBeGreaterThan(500);
      expect((await prisma.settings.findUniqueOrThrow({ where: { cityId: bCity } })).journeyStart.toISOString().slice(0, 10)).toBe("2026-11-23");
      // A's original city is untouched.
      expect(await prisma.task.count({ where: { cityId: "engineering", source: "PLAN" } })).toBe(aPlan);
    }, 60_000);

    it("lists only the user's own cities and switches context by city", async () => {
      const mine = (await asUser(app, B).get("/api/cities").expect(200)).body;
      expect(mine.map((c: { id: string }) => c.id)).toEqual([bCity]);
      const aToday = (await asUser(app, A).get("/api/today?date=2026-11-23").expect(200)).body;
      const bToday = (await asUser(app, bWith(bCity)).get("/api/today?date=2026-11-23").expect(200)).body;
      expect(aToday.tasks.every((t: { topic: { id: string } | null }) => !t.topic || !t.topic.id.startsWith("c"))).toBe(true);
      expect(bToday.tasks.every((t: { topic: { id: string } | null }) => !t.topic || t.topic.id.startsWith(`${bCity}.`))).toBe(true);
      expect(bToday.journey.day).toBe(1);
    });

    it("pauses, resumes, archives (read-only), restores and deletes only an archived city with its exact name", async () => {
      const s = (action: string) => asUser(app, B).post(`/api/cities/${bCity}/status`).send({ action });
      expect((await s("pause").expect(200)).body.status).toBe("PAUSED");
      expect((await s("pause").expect(409)).body.error.code).toBe("INVALID_STATUS_CHANGE");
      expect((await s("resume").expect(200)).body.status).toBe("ACTIVE");
      expect((await s("archive").expect(200)).body.status).toBe("ARCHIVED");
      await asUser(app, bWith(bCity)).get("/api/today").expect(200); // still readable
      expect((await asUser(app, bWith(bCity)).post("/api/tasks/reschedule-overdue").send({}).expect(409)).body.error.code).toBe("CITY_ARCHIVED");
      expect((await asUser(app, B).patch(`/api/cities/${bCity}`).send({ name: "Renamed" }).expect(409)).body.error.code).toBe("CITY_ARCHIVED");
      expect((await asUser(app, B).delete(`/api/cities/${bCity}`).send({ confirmName: "wrong" }).expect(400)).body.error.code).toBe("CONFIRMATION_MISMATCH");
      expect((await s("restore").expect(200)).body.status).toBe("ACTIVE");
      expect((await asUser(app, B).delete(`/api/cities/${bCity}`).send({ confirmName: "Engineering again" }).expect(409)).body.error.code).toBe("ARCHIVE_FIRST");
      expect((await asUser(app, B).patch(`/api/cities/${bCity}`).send({ name: "Engineering B", description: "Renamed" }).expect(200)).body.name).toBe("Engineering B");
    });
  });

  describe("data isolation", () => {
    it("never shows or changes another user's city, whatever id is sent", async () => {
      const aTask = await prisma.task.findFirstOrThrow({ where: { cityId: "engineering", source: "PLAN" } });
      const aSub = await prisma.subtopic.findFirstOrThrow({ where: { topicId: "fe.ts", position: 1 } });
      const aSchedule = await prisma.revisionSchedule.findFirstOrThrow({ where: { cityId: "engineering" } });
      // B names A's city: exactly like a missing city.
      expect((await asUser(app, bWith("engineering")).get("/api/today").expect(404)).body.error.code).toBe("CITY_NOT_FOUND");
      expect((await asUser(app, B).get("/api/cities/engineering").expect(404)).body.error.code).toBe("CITY_NOT_FOUND");
      await asUser(app, B).get("/api/cities/engineering/curriculum/versions").expect(404);
      await asUser(app, B).post("/api/cities/engineering/status").send({ action: "archive" }).expect(404);
      await asUser(app, B).delete("/api/cities/engineering").send({ confirmName: "Engineering City" }).expect(404);
      // B works in their own city but sends A's record ids.
      const own = bWith(bCity);
      await asUser(app, own).get("/api/topics/fe.ts").expect(404);
      await asUser(app, own).get("/api/topics/fe.ts/revision").expect(404);
      await asUser(app, own).patch("/api/topics/fe.ts").send({ needsReview: true }).expect(404);
      await asUser(app, own).patch(`/api/subtopics/${aSub.id}`).send({ completed: true }).expect(404);
      await asUser(app, own).get(`/api/tasks/${aTask.id}`).expect(404);
      await asUser(app, own).patch(`/api/tasks/${aTask.id}`).send({ title: "hijacked" }).expect(404);
      await asUser(app, own).post("/api/tasks").send({ title: "x", scheduledDate: "2026-11-24", estimatedMinutes: 30, topicId: "fe.ts" }).expect(404);
      await asUser(app, own).post("/api/sessions").send({ date: "2026-11-18", minutes: 10, topicId: "fe.ts" }).expect(404);
      await asUser(app, own).post("/api/sessions").send({ date: "2026-11-18", minutes: 10, taskId: aTask.id }).expect(404);
      // A's revision unit answers exactly like a unit that does not exist at all (no existence oracle).
      const attempt = (subtopicId: number) => asUser(app, own).post("/api/revision/attempts").send({ topicId: "fe.ts", subtopicId, templateKey: "explain", retrievalMethod: "CONCEPTUAL", score: 3, usedHints: false, usedNotes: false });
      const theirs = await attempt(aSub.id).expect(409);
      expect(theirs.body).toEqual((await attempt(99_999_999).expect(409)).body);
      await asUser(app, own).post("/api/revision/evaluations").send({ scheduleId: aSchedule.id, templateKey: "explain", transcript: "x" }).expect(403); // AI off here; with AI on the schedule lookup is scoped too
      // Nothing of A's changed, and B's views contain nothing of A's.
      expect((await prisma.task.findUniqueOrThrow({ where: { id: aTask.id } })).title).toBe(aTask.title);
      expect((await prisma.subtopic.findUniqueOrThrow({ where: { id: aSub.id } })).completedAt).toBeNull();
      expect((await prisma.topic.findUniqueOrThrow({ where: { id: "fe.ts" } })).needsReview).toBe(false);
      const overview = (await asUser(app, own).get("/api/revision/overview").expect(200)).body;
      expect([...overview.due, ...overview.upcoming, ...overview.overdue].some((u: { topicId: string }) => !u.topicId.startsWith(bCity))).toBe(false);
      expect((await asUser(app, own).get("/api/tasks?from=2026-11-01&to=2027-11-30").expect(200)).body.every((t: { id: number }) => t.id !== aTask.id)).toBe(true);
    });

    it("scopes every query of a city client, and refuses account data through it", async () => {
      const db = cityScoped(prisma, bCity);
      expect(await db.topic.findUnique({ where: { id: "fe.ts" } })).toBeNull();
      expect(await db.task.count({ where: { cityId: "engineering" } })).toBe(0); // the caller's filter AND the city: nothing
      expect(await db.task.findUnique({ where: { id: (await prisma.task.findFirstOrThrow({ where: { cityId: "engineering" } })).id } })).toBeNull();
      expect(await db.task.count()).toBe(await prisma.task.count({ where: { cityId: bCity } }));
      expect(await db.subtopic.count({ where: { topicId: "fe.ts" } })).toBe(0);
      await expect(db.user.findMany()).rejects.toThrow(/not city data/);
      await expect(db.city.findMany()).rejects.toThrow(/not city data/);
      // A create outside any scope fails closed on the foreign key.
      await expect(prisma.task.create({ data: { title: "orphan", kind: "STUDY", estimatedMinutes: 30, originalDate: new Date(), scheduledDate: new Date(), source: "MANUAL" } })).rejects.toThrow(/foreign key/i);
    });
  });

  describe("curriculum versioning", () => {
    it("records versions, refuses to remove topics with history, and removes untouched ones", async () => {
      // Some history in B's city: a ticked floor on its first TypeScript sub-topic.
      const own = bWith(bCity);
      const sub = await prisma.subtopic.findFirstOrThrow({ where: { topicId: `${bCity}.fe.ts`, position: 0 } });
      await asUser(app, own).patch(`/api/subtopics/${sub.id}`).send({ completed: true }).expect(200);
      const doc = engineeringTemplate();
      const without = (key: string) => ({
        ...doc,
        districts: doc.districts.map((d) => ({ ...d, topics: d.topics.filter((t) => t.key !== key).map((t) => ({ ...t, dependsOn: t.dependsOn.filter((k) => k !== key) })) })),
        queues: Object.fromEntries(Object.entries(doc.queues).map(([q, ks]) => [q, ks.filter((k) => k !== key)])),
      });
      // Removing a topic with history is refused at approval, and the proposal says so up front.
      const p2 = await asUser(app, B).post(`/api/cities/${bCity}/curriculum/proposals`).send({ source: "IMPORT", document: without("fe.ts"), note: "drop TypeScript" }).expect(201);
      expect(p2.body.blockedRemovals).toEqual(["fe.ts"]);
      const blocked = await asUser(app, B).post(`/api/cities/${bCity}/curriculum/versions/${p2.body.version}/approve`).send({}).expect(409);
      expect(blocked.body.error).toMatchObject({ code: "CURRICULUM_REMOVAL_BLOCKED", details: { topics: ["fe.ts"] } });
      expect(await prisma.subtopic.count({ where: { id: sub.id, completedAt: { not: null } } })).toBe(1);
      // An optional topic without history can go; the rest stays, history included.
      const optional = doc.districts.flatMap((d) => d.topics).find((t) => t.priority === "OPTIONAL" && !doc.districts.flatMap((d) => d.topics).some((x) => x.dependsOn.includes(t.key)))!;
      const p3 = await asUser(app, B).post(`/api/cities/${bCity}/curriculum/proposals`).send({ source: "IMPORT", document: without(optional.key) }).expect(201);
      expect(p3.body.changes.removed.topics).toEqual([optional.key]);
      expect(p3.body.blockedRemovals).toEqual([]);
      await asUser(app, B).post(`/api/cities/${bCity}/curriculum/versions/${p3.body.version}/approve`).send({}).expect(200);
      expect(await prisma.topic.count({ where: { id: `${bCity}.${optional.key}` } })).toBe(0);
      expect(await prisma.subtopic.count({ where: { id: sub.id, completedAt: { not: null } } })).toBe(1);
      const versions = (await asUser(app, B).get(`/api/cities/${bCity}/curriculum/versions`).expect(200)).body;
      expect(versions.map((v: { version: number; status: string }) => [v.version, v.status])).toEqual([[3, "APPLIED"], [2, "REJECTED"], [1, "APPLIED"]]);
    }, 60_000);
  });

  describe("data rights", () => {
    it("exports everything the user owns, without secrets", async () => {
      const r = await asUser(app, B).get("/api/account/export").expect(200);
      expect(r.headers["content-disposition"]).toMatch(/attachment; filename="blueprint-export-/);
      expect(r.body).toMatchObject({ format: "blueprint-export", account: { email: "b@example.test" } });
      expect(r.body.cities.map((c: { id: string }) => c.id)).toEqual([bCity]);
      const text = JSON.stringify(r.body);
      expect(text).not.toContain("passwordHash");
      expect(text).not.toMatch(/\$argon2id\$/);
      expect(r.body.sessions.every((s: Record<string, unknown>) => !("id" in s))).toBe(true); // no session tokens or hashes
      expect(r.body.cities.flatMap((c: { tasks: { cityId: string }[] }) => c.tasks).every((t: { cityId: string }) => t.cityId === bCity)).toBe(true);
    });

    it("records optional consent, lets it be withdrawn, and keeps required ones fixed", async () => {
      await asUser(app, B).post("/api/account/consents").send({ purpose: "AI_PROCESSING", granted: true }).expect(200);
      const w = await asUser(app, B).post("/api/account/consents").send({ purpose: "AI_PROCESSING", granted: false }).expect(200);
      expect(w.body.current.find((c: { purpose: string }) => c.purpose === "AI_PROCESSING")).toMatchObject({ granted: false, optional: true, policyVersion: "2026-11-20" });
      expect(w.body.history.filter((h: { purpose: string }) => h.purpose === "AI_PROCESSING")).toHaveLength(2);
      await asUser(app, B).post("/api/account/consents").send({ purpose: "TERMS", granted: false }).expect(400);
    });

    it("asks again for AI consent given under an older notice (revision material is now sent too)", async () => {
      const a = await prisma.user.findUniqueOrThrow({ where: { email: "a@example.test" } });
      await prisma.consentRecord.create({ data: { userId: a.id, purpose: "AI_PROCESSING", policyVersion: "2026-11-19", granted: true } });
      expect((await asUser(app, A).get("/api/ai/status").expect(200)).body.consented).toBe(false);
      const c = (await asUser(app, A).get("/api/account/consents").expect(200)).body.current.find((x: { purpose: string }) => x.purpose === "AI_PROCESSING");
      expect(c).toMatchObject({ granted: true, policyVersion: "2026-11-19", currentVersion: "2026-11-20" });
      await asUser(app, A).post("/api/ai/consent").send({}).expect(200);
      expect((await asUser(app, A).get("/api/ai/status").expect(200)).body.consented).toBe(true);
    });

    it("deletes the account with its password, removes all its data and keeps only the id", async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { email: "b@example.test" } });
      await asUser(app, B).delete("/api/account").send({ password: "wrong", confirm: "DELETE" }).expect(400);
      await asUser(app, B).delete("/api/account").send({ password: TEST_PASSWORD }).expect(400);
      await asUser(app, B).delete("/api/account").send({ password: TEST_PASSWORD, confirm: "DELETE" }).expect(204);
      expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
      expect(await prisma.city.count({ where: { id: bCity } })).toBe(0);
      expect(await prisma.task.count({ where: { cityId: bCity } })).toBe(0);
      expect(await prisma.topic.count({ where: { cityId: bCity } })).toBe(0);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.deletedAccount.count({ where: { userId: user.id } })).toBe(1);
      await asUser(app, B).get("/api/auth/me").expect(401);
      // A is unaffected.
      expect(await prisma.task.count({ where: { cityId: "engineering", source: "PLAN" } })).toBe(aPlan);
      await asUser(app, A).get("/api/today").expect(200);
    });
  });
});
