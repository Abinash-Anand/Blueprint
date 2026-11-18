/**
 * AI check and voice (AI design §9.4) against a real database with the deterministic fake provider.
 * Same setup as the other integration suites: a fresh schema per run, migrated with `migrate deploy`, dropped after.
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { TestClock } from "../../src/lib/clock.js";
import { type AiConfig, loadAiConfig } from "../../src/modules/ai/config.js";
import { aiService } from "../../src/modules/ai/service.js";
import { fakeProvider } from "../../src/modules/ai/providers/fake.js";
import { ProviderError, type AiProviders, type EvaluationProvider } from "../../src/modules/ai/providers/types.js";
import { seed } from "../../prisma/seed.js";
import { wav } from "../helpers/wav.js";

const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const schema = `it_ai_${Date.now()}`;
const url = base ? `${base}${base.includes("?") ? "&" : "?"}schema=${schema}` : "";

const ANSWER = "Generics let a function keep the type of its argument: the type parameter flows from the call site to the result. Constraints with extends limit which types are allowed.";

suite("AI check and voice", () => {
  let prisma: PrismaClient;
  const clock = new TestClock("2026-11-18");
  const config: AiConfig = { ...loadAiConfig({ AI_ENABLED: "true", AI_EVALUATION_PROVIDER: "fake", AI_TRANSCRIPTION_PROVIDER: "fake", AI_MAX_RECORDING_SECONDS: "30" }) };
  // A switchable evaluation provider: the fake by default, or a failing / lying one for a test.
  let evalImpl: EvaluationProvider = fakeProvider("I said generics keep the type parameter from the call site.");
  const providers: AiProviders = {
    transcription: fakeProvider("Generics keep the type parameter from the call site."),
    evaluation: { name: "fake", evaluate: (i) => evalImpl.evaluate(i) },
  };
  let app: ReturnType<typeof createApp>;
  let off: ReturnType<typeof createApp>;
  let scheduleId: number;
  let subId: number;

  const evaluate = (body: Record<string, unknown>) => request(app).post("/api/revision/evaluations").send({ scheduleId, templateKey: "explain", ...body });
  const attempt = (body: Record<string, unknown>) =>
    request(app).post("/api/revision/attempts").send({ topicId: "fe.ts", subtopicId: subId, templateKey: "explain", retrievalMethod: "CONCEPTUAL", usedHints: false, usedNotes: false, ...body });

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = new PrismaClient({ datasourceUrl: url });
    await seed(prisma, () => {}, clock.date);
    app = createApp({ prisma, clock, ai: { config, providers } });
    off = createApp({ prisma, clock });
    subId = (await prisma.subtopic.findFirstOrThrow({ where: { topicId: "fe.ts", position: 0 } })).id;
    await request(app).patch(`/api/subtopics/${subId}`).send({ completed: true }).expect(200);
    scheduleId = (await prisma.revisionSchedule.findUniqueOrThrow({ where: { unit: `s:${subId}` } })).id;
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  it("is off by default and needs consent when on", async () => {
    expect((await request(off).get("/api/ai/status").expect(200)).body).toMatchObject({ enabled: false });
    expect((await request(off).post("/api/revision/evaluations").send({ scheduleId, templateKey: "explain", transcript: "x" }).expect(403)).body.error.code).toBe("AI_DISABLED");
    expect((await evaluate({ transcript: ANSWER }).expect(403)).body.error.code).toBe("AI_CONSENT_REQUIRED");
    await request(app).post("/api/ai/consent").send({}).expect(200);
    expect((await request(app).get("/api/ai/status").expect(200)).body).toMatchObject({ enabled: true, consented: true, maxFollowUps: 1 });
  });

  it("rejects cross-site browser requests and accepts its own pages", async () => {
    const r = await request(app).post("/api/ai/consent").set("Origin", "https://evil.example").set("X-Blueprint", "1").send({}).expect(403);
    expect(r.body.error.code).toBe("FORBIDDEN_ORIGIN");
    await request(app).post("/api/ai/consent").set("Sec-Fetch-Site", "cross-site").send({}).expect(403);
    const host = "127.0.0.1:8091";
    await request(app).post("/api/ai/consent").set("Host", host).set("Origin", `http://${host}`).send({}).expect(403); // header missing
    await request(app).post("/api/ai/consent").set("Host", host).set("Origin", `http://${host}`).set("X-Blueprint", "1").set("Sec-Fetch-Site", "same-origin").send({}).expect(200);
    await request(app).get("/api/ai/status").set("Origin", "https://evil.example").expect(200); // reads are not state changes
  });

  it("checks an answer against the prompt's own criteria and never changes learning state", async () => {
    const before = await prisma.subtopic.findUniqueOrThrow({ where: { id: subId } });
    const tasksBefore = await prisma.task.count({ where: { status: "DONE" } });
    const r = await evaluate({ transcript: ANSWER }).expect(201);
    expect(r.body.status).toBe("SUCCEEDED");
    expect(r.body.criteria.length).toBeGreaterThanOrEqual(3);
    expect(r.body.criteria.every((c: { evidence: string | null; verdict: string }) => c.verdict === "MISSING" || ANSWER.toLowerCase().includes(c.evidence!.toLowerCase()))).toBe(true);
    expect([0, 1, 2, 3]).toContain(r.body.suggestedScore);
    expect(r.body.rootId).toBe(r.body.id);
    expect((await prisma.subtopic.findUniqueOrThrow({ where: { id: subId } })).completedAt).toEqual(before.completedAt);
    expect(await prisma.task.count({ where: { status: "DONE" } })).toBe(tasksBefore);
    const sched = await prisma.revisionSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
    expect(sched.lastAttemptDate).toBeNull();
  });

  it("returns the stored result for the same answer without calling the provider again", async () => {
    const a = await evaluate({ transcript: ANSWER }).expect(201);
    const usage = await prisma.aiUsage.count();
    const b = await evaluate({ transcript: `  ${ANSWER}  ` }).expect(201);
    expect(b.body.id).toBe(a.body.id);
    expect(await prisma.aiUsage.count()).toBe(usage);
  });

  it("refuses a rubric-less prompt and a missing answer", async () => {
    const p = await request(app).post("/api/prompts").send({ topicId: "fe.ts", subtopicId: subId, content: "Say anything about it", retrievalMethod: "CONCEPTUAL", expectedAnswer: "-" }).expect(201);
    expect((await evaluate({ templateKey: undefined, promptId: p.body.id, transcript: "x" }).expect(409)).body.error.code).toBe("AI_NO_CRITERIA");
    expect((await evaluate({ transcript: "   " }).expect(400)).body.error.code).toBe("VALIDATION_ERROR");
  });

  it("asks one follow-up; points recovered there count as assisted; no second follow-up", async () => {
    const root = (await evaluate({ transcript: "Generics keep types." }).expect(201)).body;
    expect(root.followUpQuestion).toBeTruthy();
    const fu = (await evaluate({ parentId: root.id, templateKey: undefined, transcript: "It solves the problem of losing the type; a concrete example is a fetchJson helper that keeps T." }).expect(201)).body;
    expect(fu.parentId).toBe(root.id);
    expect(fu.rootId).toBe(root.id);
    expect(fu.assisted).toBe(true);
    expect(fu.suggestedScore).toBe(root.suggestedScore);
    expect(fu.criteria.some((c: { recoveredInFollowUp: boolean }) => c.recoveredInFollowUp)).toBe(true);
    expect(fu.followUpQuestion).toBeNull();
    expect(fu.suggestedMistakes).toMatch(/Recalled only after the follow-up question/);
    const again = await evaluate({ parentId: fu.id, templateKey: undefined, transcript: "more" }).expect(409);
    expect(again.body.error.code).toBe("AI_FOLLOW_UP_LIMIT");
  });

  it("stores a failure, shows it as retryable, and runs again on retry", async () => {
    evalImpl = { name: "fake", evaluate: async () => { throw new ProviderError("TIMEOUT", "slow"); } };
    const r = await evaluate({ transcript: "Generics with a timeout." }).expect(504);
    expect(r.body.error).toMatchObject({ code: "AI_TIMEOUT", details: { retryable: true } });
    const row = await prisma.revisionEvaluation.findFirstOrThrow({ where: { transcript: "Generics with a timeout." } });
    expect(row).toMatchObject({ status: "FAILED", errorCode: "AI_TIMEOUT" });
    evalImpl = fakeProvider();
    const ok = await evaluate({ transcript: "Generics with a timeout." }).expect(201);
    expect(ok.body).toMatchObject({ id: row.id, status: "SUCCEEDED" });
  });

  it("rejects invented evidence instead of showing it", async () => {
    evalImpl = {
      name: "fake",
      evaluate: async () => ({
        output: { relevant: true, criteria: [0, 1, 2, 3].map((index) => ({ index, verdict: "COVERED", evidence: "words never said" })), misconceptions: [], feedback: "Great", followUpQuestion: null },
        usage: {},
      }),
    };
    const r = await evaluate({ transcript: "Short answer about generics." }).expect(502);
    expect(r.body.error.code).toBe("AI_INVALID_OUTPUT");
    evalImpl = fakeProvider();
  });

  it("gives a sub-topic revision its topic's curriculum terms as spelling hints", async () => {
    const terms = await aiService(prisma, clock, config, providers).unitTerms(scheduleId);
    expect(terms).toContain("fetchJson<T>"); // from the fe.ts curriculum question, not the sub-topic's own prompts
    expect(terms.length).toBeLessThanOrEqual(40);
  });

  it("transcribes a WAV recording without storing it, and refuses other uploads", async () => {
    const r = await request(app).post(`/api/ai/transcriptions?scheduleId=${scheduleId}`).set("Content-Type", "audio/wav").send(wav(2)).expect(200);
    expect(r.body).toEqual({ text: "Generics keep the type parameter from the call site.", audioSeconds: 2 });
    const usage = await prisma.aiUsage.findFirstOrThrow({ where: { operation: "TRANSCRIBE" }, orderBy: { id: "desc" } });
    expect(usage).toMatchObject({ outcome: "OK", audioSeconds: 2 });
    expect((await request(app).post(`/api/ai/transcriptions?scheduleId=${scheduleId}`).set("Content-Type", "audio/webm").send(Buffer.alloc(100)).expect(415)).body.error.code).toBe("AUDIO_UNSUPPORTED");
    expect((await request(app).post(`/api/ai/transcriptions?scheduleId=${scheduleId}`).set("Content-Type", "audio/wav").send(wav(40)).expect(413)).body.error.code).toBe("AUDIO_TOO_LARGE");
    expect((await request(app).post(`/api/ai/transcriptions?scheduleId=${scheduleId}`).set("Content-Type", "audio/wav").send(wav(0.2)).expect(400)).body.error.code).toBe("AUDIO_TOO_SHORT");
  });

  it("links the check to the attempt only for the same answer, and saves the learner's own score", async () => {
    const e = (await evaluate({ transcript: ANSWER }).expect(201)).body;
    const stale = await attempt({ score: 3, response: `${ANSWER} (edited)`, evaluationId: e.id, selfScore: 2, inputMode: "SPOKEN" }).expect(409);
    expect(stale.body.error.code).toBe("EVALUATION_STALE");
    const sub2 = (await prisma.subtopic.findFirstOrThrow({ where: { topicId: "fe.ts", position: 1 } })).id;
    await request(app).patch(`/api/subtopics/${sub2}`).send({ completed: true }).expect(200);
    const otherSchedule = (await prisma.revisionSchedule.findUniqueOrThrow({ where: { unit: `s:${sub2}` } })).id;
    const other = await prisma.revisionEvaluation.create({
      data: { scheduleId: otherSchedule, inputHash: "x", promptText: "p", criteriaText: "a · b", transcript: ANSWER, provider: "fake", model: "m", promptVersion: "v", status: "FAILED", errorCode: "AI_TIMEOUT" },
    });
    expect((await attempt({ score: 3, response: ANSWER, evaluationId: other.id }).expect(409)).body.error.code).toBe("EVALUATION_STALE");
    const learnerScore = e.suggestedScore === 3 ? 2 : 3;
    const ok = await attempt({ score: learnerScore, response: ANSWER, evaluationId: e.id, selfScore: 1, inputMode: "SPOKEN" }).expect(201);
    expect(ok.body.attempt).toMatchObject({ score: learnerScore, evaluationId: e.id, selfScore: 1, inputMode: "SPOKEN" });
    const p = (await request(app).get("/api/progress").expect(200)).body.revision.ai;
    expect(p).toMatchObject({ selfScored: 1, selfMatches: 0, checked: 1, agreed: 0, spoken: { attempts: 1, averageScore: learnerScore }, typed: { attempts: 0 } });
    expect(p.selfMeanDifference).toBe(1 - learnerScore);
  });

  it("limits checks per hour and per day", async () => {
    const tight = createApp({ prisma, clock, ai: { config: { ...config, maxEvaluationsPerHour: 1 }, providers } });
    await request(tight).post("/api/revision/evaluations").send({ scheduleId, templateKey: "explain", transcript: "rate limit one" }).expect(201);
    const r = await request(tight).post("/api/revision/evaluations").send({ scheduleId, templateKey: "explain", transcript: "rate limit two" }).expect(429);
    expect(r.body.error.code).toBe("AI_RATE_LIMITED");
    const daily = createApp({ prisma, clock, ai: { config: { ...config, dailyRequestLimit: 1 }, providers } });
    expect((await request(daily).post("/api/revision/evaluations").send({ scheduleId, templateKey: "explain", transcript: "daily" }).expect(429)).body.error.code).toBe("AI_RATE_LIMITED");
  });

  it("housekeeping removes old unlinked checks and keeps linked ones", async () => {
    const old = new Date(clock.now().getTime() - 40 * 86_400_000);
    const unlinked = await prisma.revisionEvaluation.create({
      data: { scheduleId, inputHash: "old", promptText: "p", criteriaText: "a · b", transcript: "t", provider: "fake", model: "m", promptVersion: "v", status: "FAILED", errorCode: "AI_TIMEOUT", createdAt: old },
    });
    const linked = await prisma.revisionAttempt.findFirstOrThrow({ where: { evaluationId: { not: null } } });
    await prisma.revisionEvaluation.update({ where: { id: linked.evaluationId! }, data: { createdAt: old } });
    const r = await aiService(prisma, clock, config, providers).cleanup();
    expect(r.evaluations).toBeGreaterThanOrEqual(1);
    expect(await prisma.revisionEvaluation.findUnique({ where: { id: unlinked.id } })).toBeNull();
    expect(await prisma.revisionEvaluation.findUnique({ where: { id: linked.evaluationId! } })).not.toBeNull();
  });
});
