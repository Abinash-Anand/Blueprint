/**
 * AI status, consent and housekeeping (AI design §9.4) against a real database with the fake provider. The earlier
 * revision answer checks were retired (docs/Recall-Plan.md §9); recall grading has its own suite.
 * Same setup as the other integration suites: a fresh schema per run, migrated with `migrate deploy`, dropped after.
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { TestClock } from "../../src/lib/clock.js";
import { type AiConfig, loadAiConfig } from "../../src/modules/ai/config.js";
import { aiService } from "../../src/modules/ai/service.js";
import { fakeProvider } from "../../src/modules/ai/providers/fake.js";
import type { AiProviders } from "../../src/modules/ai/providers/types.js";
import { seed } from "../../prisma/seed.js";
import { asUser, signIn } from "../helpers/auth.js";

/** Session cookie and city for every request (filled in beforeAll). */
const H: Record<string, string> = {};

const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const schema = `it_ai_${Date.now()}`;
const url = base ? `${base}${base.includes("?") ? "&" : "?"}schema=${schema}` : "";

suite("AI status and consent", () => {
  let prisma: PrismaClient;
  const clock = new TestClock("2026-11-18");
  const config: AiConfig = { ...loadAiConfig({ AI_ENABLED: "true", AI_EVALUATION_PROVIDER: "fake", AI_TRANSCRIPTION_PROVIDER: "fake", AI_MAX_RECORDING_SECONDS: "30" }) };
  const providers: AiProviders = { transcription: fakeProvider(), evaluation: fakeProvider() };
  let app: ReturnType<typeof createApp>;
  let off: ReturnType<typeof createApp>;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = new PrismaClient({ datasourceUrl: url });
    await seed(prisma, () => {}, clock.date, { createEngineeringCity: true });
    Object.assign(H, (await signIn(prisma)).headers);
    app = createApp({ prisma, clock, ai: { config, providers } });
    off = createApp({ prisma, clock });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  it("is off by default, and on it needs consent", async () => {
    expect((await asUser(off, H).get("/api/ai/status").expect(200)).body).toMatchObject({ enabled: false });
    expect((await asUser(app, H).get("/api/ai/status").expect(200)).body).toMatchObject({ enabled: true, consented: false });
    await asUser(app, H).post("/api/ai/consent").send({}).expect(200);
    expect((await asUser(app, H).get("/api/ai/status").expect(200)).body).toMatchObject({ enabled: true, consented: true });
  });

  it("no longer offers the retired answer checks or unit transcriptions", async () => {
    await asUser(app, H).post("/api/revision/evaluations").send({ scheduleId: 1, transcript: "x" }).expect(404);
    await asUser(app, H).post("/api/ai/transcriptions?scheduleId=1").set("Content-Type", "audio/wav").send(Buffer.alloc(10)).expect(404);
  });

  it("rejects cross-site browser requests and accepts its own pages", async () => {
    const r = await asUser(app, H).post("/api/ai/consent").set("Origin", "https://evil.example").set("X-Blueprint", "1").send({}).expect(403);
    expect(r.body.error.code).toBe("FORBIDDEN_ORIGIN");
    await asUser(app, H).post("/api/ai/consent").set("Sec-Fetch-Site", "cross-site").send({}).expect(403);
    const host = "127.0.0.1:8091";
    await asUser(app, H).post("/api/ai/consent").set("Host", host).set("Origin", `http://${host}`).send({}).expect(403); // header missing
    await asUser(app, H).post("/api/ai/consent").set("Host", host).set("Origin", `http://${host}`).set("X-Blueprint", "1").set("Sec-Fetch-Site", "same-origin").send({}).expect(200);
    await asUser(app, H).get("/api/ai/status").set("Origin", "https://evil.example").expect(200); // reads are not state changes
  });

  it("housekeeping removes only old usage rows and leaves the earlier answer checks alone", async () => {
    const old = new Date(clock.now().getTime() - 500 * 86_400_000);
    await prisma.aiUsage.create({ data: { operation: "EVALUATE", provider: "fake", model: "m", at: old, latencyMs: 1, outcome: "OK" } });
    const r = await aiService(prisma, clock, config, providers).cleanup();
    expect(r).toEqual({ usage: 1 });
  });
});
