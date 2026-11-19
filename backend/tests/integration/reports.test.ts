/**
 * Reports on revision questions and AI checks (Revision v2 plan §3.4, phase 0) against a real database: stored per
 * city, references checked against the city, nothing else changes, and part of the data export.
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../prisma/seed.js";
import { createApp } from "../../src/app.js";
import { TestClock } from "../../src/lib/clock.js";
import { asUser, signIn } from "../helpers/auth.js";

const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const schema = `it_rep_${Date.now()}`;
const url = base ? `${base}${base.includes("?") ? "&" : "?"}schema=${schema}` : "";

suite("revision reports", () => {
  let prisma: PrismaClient;
  const clock = new TestClock("2026-11-18");
  let app: ReturnType<typeof createApp>;
  const H: Record<string, string> = {};
  const B: Record<string, string> = {};
  let scheduleId = 0;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = new PrismaClient({ datasourceUrl: url });
    await seed(prisma, () => {}, clock.date, { createEngineeringCity: true });
    Object.assign(H, (await signIn(prisma)).headers);
    app = createApp({ prisma, clock });
    // A learned sub-topic gets a revision unit to report on.
    const sub = await prisma.subtopic.findFirstOrThrow({ where: { topicId: "fe.ts", position: 0 } });
    await asUser(app, H).patch(`/api/subtopics/${sub.id}`).send({ completed: true }).expect(200);
    const rev = (await asUser(app, H).get("/api/topics/fe.ts/revision").expect(200)).body as { units: { schedule: { id: number } | null }[] };
    scheduleId = rev.units.find((u) => u.schedule)!.schedule!.id;
    // A second account with its own active city.
    const other = await signIn(prisma, { email: "other@example.test", cityId: "none" });
    await prisma.city.create({ data: { id: "cother", idPrefix: "cother-", name: "Other", ownerId: other.user.id, status: "ACTIVE" } });
    Object.assign(B, { ...other.headers, "X-City-Id": "cother" });
  }, 120_000);
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  it("stores a report on a question in the learner's city, and changes nothing else", async () => {
    const before = await prisma.revisionAttempt.count();
    const r = await asUser(app, H).post("/api/revision/reports").send({
      reason: "OUT_OF_SYLLABUS", promptText: "Explain generics.", note: "Not covered yet", topicId: "fe.ts", scheduleId,
    }).expect(201);
    expect(r.body).toMatchObject({ reason: "OUT_OF_SYLLABUS" });
    const row = await prisma.revisionReport.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(row).toMatchObject({ cityId: "engineering", topicId: "fe.ts", scheduleId, note: "Not covered yet", promptText: "Explain generics." });
    expect(await prisma.revisionAttempt.count()).toBe(before);
  });

  it("refuses references from another city and bad input", async () => {
    expect((await asUser(app, B).post("/api/revision/reports").send({ reason: "UNCLEAR", promptText: "x", scheduleId }).expect(404)).body.error.code).toBe("NOT_FOUND");
    await asUser(app, B).post("/api/revision/reports").send({ reason: "UNCLEAR", promptText: "x", topicId: "fe.ts" }).expect(404);
    await asUser(app, H).post("/api/revision/reports").send({ reason: "LOUD", promptText: "x" }).expect(400);
    await asUser(app, H).post("/api/revision/reports").send({ reason: "UNCLEAR", promptText: "" }).expect(400);
    await asUser(app, H).post("/api/revision/reports").send({ reason: "UNCLEAR", promptText: "x", extra: 1 }).expect(400);
  });

  it("is part of the city's data in the export, and only there", async () => {
    await asUser(app, H).post("/api/revision/reports").send({ reason: "UNFAIR_CHECK", promptText: "Explain generics.", note: "I covered the fix" }).expect(201);
    const mine = (await asUser(app, H).get("/api/account/export").expect(200)).body;
    const reasons = mine.cities.find((c: { id: string }) => c.id === "engineering").revisionReports.map((x: { reason: string }) => x.reason);
    expect(reasons).toEqual(expect.arrayContaining(["OUT_OF_SYLLABUS", "UNFAIR_CHECK"]));
    const theirs = (await asUser(app, B).get("/api/account/export").expect(200)).body;
    expect(theirs.cities.flatMap((c: { revisionReports: unknown[] }) => c.revisionReports)).toEqual([]);
  });
});
