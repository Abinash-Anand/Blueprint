/**
 * Recall end to end (docs/Recall-Plan.md, phase 1) on a real database with the fake provider: a learned sub-topic
 * becomes due, a review is started (its checklist built and hidden), voice parts and typed text are kept, grading runs
 * in the background with the checks in code, the score, depth, result and next date follow the rules, and everything
 * stays inside the city.
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../prisma/seed.js";
import { createApp } from "../../src/app.js";
import { cityScoped } from "../../src/lib/cityScope.js";
import { loadAuthConfig } from "../../src/config.js";
import { TestClock } from "../../src/lib/clock.js";
import { loadAiConfig } from "../../src/modules/ai/config.js";
import { createProviders } from "../../src/modules/ai/providers/factory.js";
import { fakeProvider } from "../../src/modules/ai/providers/fake.js";
import { type AiProviders, ProviderError } from "../../src/modules/ai/providers/types.js";
import { memoryMailer } from "../../src/modules/auth/mailer.js";
import type { RecallService } from "../../src/modules/recall/service.js";
import { asUser, signIn } from "../helpers/auth.js";
import { wav } from "../helpers/wav.js";

const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const schema = `it_recall_${Date.now()}`;
const url = base ? `${base}${base.includes("?") ? "&" : "?"}schema=${schema}` : "";

type Review = {
  id: number; status: string; attempt: number; spokenParts: string[]; typed: string; waitReason: string | null;
  result: null | {
    score: number; depth: string; outcome: string; stageBefore: number; stageAfter: number; nextDueDate: string;
    misconceptions: { claim: string; correction: string }[];
    points: { id: number; code: string; label: string; tier: number; status: string | null; evidence: string | null; leftOut: boolean }[];
  };
};

suite("recall", () => {
  let prisma: PrismaClient;
  const clock = new TestClock("2026-11-20");
  const config = loadAiConfig({ AI_ENABLED: "true", AI_EVALUATION_PROVIDER: "fake", AI_TRANSCRIPTION_PROVIDER: "fake", AI_GENERATION_PROVIDER: "fake", AI_GENERATION_RETRY_DELAYS_MS: "0,0" });
  // A generation provider that can be made busy for a test.
  let busy = 0;
  const fake = fakeProvider("Definition and purpose of the thing, said out loud.");
  const providers: AiProviders = {
    ...createProviders(config),
    transcription: fake,
    generation: {
      name: "fake",
      images: true,
      generate: async (i) => {
        if (busy > 0 && i.name === "recall_grade") {
          busy--;
          throw Object.assign(new ProviderError("PROVIDER_ERROR", "busy"), { status: 503 });
        }
        return fake.generate(i);
      },
    },
  };
  let app: ReturnType<typeof createApp>;
  const H: Record<string, string> = {};
  const B: Record<string, string> = {};
  let subA = 0, subB = 0;

  const home = async () => (await asUser(app, H).get("/api/recall/home").expect(200)).body;
  async function checked(id: number): Promise<Review> {
    for (let i = 0; i < 200; i++) {
      const r = (await asUser(app, H).get(`/api/recall/reviews/${id}`).expect(200)).body as Review;
      if (r.status === "CHECKED" || r.status === "COMPLETE") return r;
      await new Promise((ok) => setTimeout(ok, 20));
    }
    throw new Error("not checked");
  }

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = new PrismaClient({ datasourceUrl: url });
    await seed(prisma, () => {}, clock.date, { createEngineeringCity: true });
    app = createApp({ prisma, clock, authConfig: loadAuthConfig({ MAIL_TRANSPORT: "file" }), mailer: memoryMailer(), ai: { config, providers }, recallRetryDelaysMs: [30, 30] });
    Object.assign(H, (await signIn(prisma)).headers);
    const other = await signIn(prisma, { email: "other@example.test", cityId: "none" });
    await prisma.city.create({ data: { id: "cother", idPrefix: "cother-", name: "Other", ownerId: other.user.id, status: "ACTIVE" } });
    Object.assign(B, { ...other.headers, "X-City-Id": "cother" });
    subA = (await prisma.subtopic.findFirstOrThrow({ where: { topicId: "fe.ts", position: 0 } })).id;
    subB = (await prisma.subtopic.findFirstOrThrow({ where: { topicId: "fe.ts", position: 1 } })).id;
  }, 120_000);
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  it("puts a sub-topic into recall when it is ticked learned, due the next day", async () => {
    expect((await home()).due).toEqual([]);
    // The tick answers with the date, so the learner sees it was scheduled.
    expect((await asUser(app, H).patch(`/api/subtopics/${subA}`).send({ completed: true }).expect(200)).body.recallDue).toBe("2026-11-21");
    const h = await home();
    expect(h.due).toEqual([]);
    expect(h.upcoming).toEqual([expect.objectContaining({ subtopicId: subA, stage: 0, nextDueDate: "2026-11-21", topic: "TypeScript" })]);
    expect(h.ai).toMatchObject({ available: false, reason: "CONSENT_REQUIRED" });
    // No more old-style revision tasks; the Week view shows the recall on its day.
    expect(await prisma.task.count({ where: { source: "REVISION", recallStateId: null } })).toBe(0);
    const week = (await asUser(app, H).get("/api/week?date=2026-11-20").expect(200)).body;
    expect(week.days.find((d: { date: string }) => d.date === "2026-11-21").recall).toHaveLength(1);
    expect(week.days.find((d: { date: string }) => d.date === "2026-11-20").recall).toEqual([]);
    // A recall task is planned into that day, and Today says one is due tomorrow.
    const task = await prisma.task.findFirstOrThrow({ where: { subtopicId: subA, recallStateId: { not: null } } });
    expect(task).toMatchObject({ kind: "REVISION", source: "REVISION", status: "TODO", estimatedMinutes: 8 });
    expect(task.scheduledDate.toISOString().slice(0, 10)).toBe("2026-11-21");
    const today = (await asUser(app, H).get("/api/today").expect(200)).body;
    expect(today.recall).toMatchObject({ dueCount: 0, overdueCount: 0, tomorrowCount: 1 });
    const tomorrow = (await asUser(app, H).get("/api/today?date=2026-11-21").expect(200)).body;
    expect(tomorrow.tasks.find((t: { id: number }) => t.id === task.id)).toMatchObject({ title: expect.stringMatching(/^Recall: /), recall: { dueDate: "2026-11-21", overdueDays: 0 } });
    // It cannot be ticked or skipped by hand: it is done by its recall.
    expect((await asUser(app, H).patch(`/api/tasks/${task.id}`).send({ status: "DONE" }).expect(409)).body.error.code).toBe("ATTEMPT_REQUIRED");
    // The topic shows the date on the sub-topic.
    const cur = (await asUser(app, H).get("/api/curriculum").expect(200)).body;
    const sub = cur.districts.flatMap((d: { topics: { subtopics: { id: number; recall: unknown }[] }[] }) => d.topics).flatMap((t: { subtopics: { id: number; recall: unknown }[] }) => t.subtopics).find((x: { id: number }) => x.id === subA);
    expect(sub.recall).toEqual({ nextDueDate: "2026-11-21", stage: 0, last: null });
  });

  it("needs the AI notice accepted, and a learned sub-topic", async () => {
    clock.date = "2026-11-21";
    expect((await asUser(app, H).post("/api/recall/reviews").send({ subtopicId: subA }).expect(403)).body.error.code).toBe("AI_CONSENT_REQUIRED");
    await asUser(app, H).post("/api/account/consents").send({ purpose: "AI_PROCESSING", granted: true }).expect(200);
    expect((await asUser(app, H).post("/api/recall/reviews").send({ subtopicId: subB }).expect(409)).body.error.code).toBe("NOT_LEARNED");
    expect((await home()).due.map((x: { subtopicId: number }) => x.subtopicId)).toEqual([subA]);
  });

  let reviewId = 0;
  it("starts a review: builds and locks the checklist once, and keeps it hidden", async () => {
    const r = (await asUser(app, H).post("/api/recall/reviews").send({ subtopicId: subA }).expect(201)).body as Review;
    reviewId = r.id;
    expect(r).toMatchObject({ status: "DRAFT", attempt: 1, spokenParts: [], typed: "", result: null });
    expect(JSON.stringify(r)).not.toMatch(/definition|mechanism|pitfalls/i);
    const c = await prisma.recallChecklist.findFirstOrThrow({ where: { subtopicId: subA }, include: { points: { orderBy: { position: "asc" } } } });
    expect(c).toMatchObject({ version: 1, provider: "fake", language: "en", promptVersion: "recall-checklist-v4" });
    expect(c.points.map((p) => [p.code, p.tier, p.weight])).toEqual([["c1", 1, 1], ["c2", 1, 1], ["c3", 2, 2], ["c4", 2, 2], ["c5", 2, 2], ["c6", 3, 3]]);
    // Starting again returns the same open review; no second checklist.
    expect((await asUser(app, H).post("/api/recall/reviews").send({ subtopicId: subA }).expect(201)).body.id).toBe(r.id);
    expect(await prisma.recallChecklist.count({ where: { subtopicId: subA } })).toBe(1);
  });

  it("keeps the text of recorded parts (never the audio) and what was typed", async () => {
    let r = (await asUser(app, H).post(`/api/recall/reviews/${reviewId}/parts`).set("Content-Type", "audio/wav").send(wav(3)).expect(201)).body as Review;
    expect(r.spokenParts).toEqual(["Definition and purpose of the thing, said out loud."]);
    r = (await asUser(app, H).post(`/api/recall/reviews/${reviewId}/parts`).set("Content-Type", "audio/wav").send(wav(2)).expect(201)).body;
    r = (await asUser(app, H).delete(`/api/recall/reviews/${reviewId}/parts/1`).expect(200)).body;
    expect(r.spokenParts).toHaveLength(1);
    await asUser(app, H).post(`/api/recall/reviews/${reviewId}/parts`).set("Content-Type", "text/plain").send("not audio").expect(415);
    r = (await asUser(app, H).patch(`/api/recall/reviews/${reviewId}`).send({ typed: "The mechanism is the core. Wrong: it runs on a web worker." }).expect(200)).body;
    expect(r.typed).toMatch(/mechanism/);
    expect(JSON.stringify(await prisma.recallReview.findUniqueOrThrow({ where: { id: reviewId } }))).not.toMatch(/RIFF|WAVE/);
  });

  it("grades in the background: quotes checked, score, depth, result and next date by the rules", async () => {
    let r = (await asUser(app, H).post(`/api/recall/reviews/${reviewId}/submit`).expect(202)).body as Review;
    expect(r.status).toBe("WAITING");
    r = await checked(reviewId);
    const status = Object.fromEntries(r.result!.points.map((p) => [p.code, p.status]));
    // definition, purpose (tier 1) and mechanism (tier 2) were said; usage, syntax (tier 2) and pitfalls (tier 3) not.
    expect(status).toEqual({ c1: "ACCURATE", c2: "ACCURATE", c3: "ACCURATE", c4: "MISSED", c5: "MISSED", c6: "MISSED" });
    expect(r.result!.points.find((p) => p.code === "c1")!.evidence).toBe("Definition");
    expect(r.result!.misconceptions).toEqual([{ claim: "Wrong: it runs on a web worker.", correction: "That is not right." }]);
    // Tiers 1–2 only (tier 3 decides depth): 4 of 8 weight = 0.5, minus 0.15 for the misconception: a lapse; stage 0 → 1, due the next day.
    expect(r.result!.score).toBeCloseTo(4 / 8 - 0.15, 3);
    expect(r.result).toMatchObject({ depth: "FOUNDATIONAL", outcome: "LAPSE", stageBefore: 0, stageAfter: 1, nextDueDate: "2026-11-22" });
    // After checking, the checklist is shown: what each point was.
    expect(r.result!.points[0].label).toMatch(/ definition$/);
    expect((await prisma.recallState.findUniqueOrThrow({ where: { subtopicId: subA } }))).toMatchObject({ stage: 1, lastGapDays: 1 });
    // The recall task is done by the check, and the next one is planned on the new date.
    const tasks = await prisma.task.findMany({ where: { subtopicId: subA, recallStateId: { not: null } }, orderBy: { id: "asc" } });
    // Due on Sunday the 22nd (a rest day), so it is planned on Monday the 23rd.
    expect(tasks.map((t) => [t.status, t.originalDate.toISOString().slice(0, 10), t.scheduledDate.toISOString().slice(0, 10)])).toEqual([["DONE", "2026-11-21", "2026-11-21"], ["TODO", "2026-11-22", "2026-11-23"]]);
    const hist = (await asUser(app, H).get("/api/recall/history").expect(200)).body;
    expect(hist[0]).toMatchObject({ subtopicId: subA, attempt: 1, outcome: "LAPSE", nextDueDate: "2026-11-22" });
    const progress = (await asUser(app, H).get("/api/progress").expect(200)).body;
    expect(progress.recall).toMatchObject({ reviews: 1, depth: { FOUNDATIONAL: 1 }, outcomes: { LAPSE: 1 } });
    const used = await prisma.aiUsage.findMany({ where: { operation: "RECALL" }, select: { model: true, outcome: true } });
    expect(used.length).toBe(2); // checklist + grade
  });

  it("works the result out again when a point is left out, while the results are open", async () => {
    const c6 = (await checked(reviewId)).result!.points.find((p) => p.code === "c6")!;
    const r = (await asUser(app, H).patch(`/api/recall/points/${c6.id}`).send({ leftOut: true }).expect(200)).body.review as Review;
    expect(r.result!.points.find((p) => p.code === "c6")!.leftOut).toBe(true);
    expect(r.result!.score).toBeCloseTo(4 / 8 - 0.15, 3); // without the tier-3 point: 4 of 8
    expect(r.result).toMatchObject({ outcome: "LAPSE", stageAfter: 1 });
    await asUser(app, H).patch(`/api/recall/points/${c6.id}`).send({ leftOut: false }).expect(200);
  });

  it("asks the senior engineer's follow-up about the gaps; an answer marks points recalled when asked, never the score", async () => {
    const before = (await asUser(app, H).get(`/api/recall/reviews/${reviewId}`).expect(200)).body;
    // Nothing to answer before there is a question.
    expect((await asUser(app, H).post(`/api/recall/reviews/${reviewId}/followup`).send({ answer: "anything" }).expect(409)).body.error.code).toBe("NO_FOLLOWUP");
    const probed = (await asUser(app, H).post(`/api/recall/reviews/${reviewId}/probe`).expect(200)).body;
    expect(probed.followupQuestion).toMatch(/pitfalls\?$/); // the highest-tier missed point first
    // Asking again keeps the same question.
    expect((await asUser(app, H).post(`/api/recall/reviews/${reviewId}/probe`).expect(200)).body.followupQuestion).toBe(probed.followupQuestion);
    expect((await asUser(app, H).post(`/api/recall/reviews/${reviewId}/followup`).send({ answer: "ok" }).expect(400)).body.error.code).toBe("ANSWER_TOO_SHORT");
    const after = (await asUser(app, H).post(`/api/recall/reviews/${reviewId}/followup`).send({ answer: "In usage you call it with a type; the pitfalls are runtime checks." }).expect(200)).body;
    const pt = (code: string) => after.result.points.find((x: { code: string }) => x.code === code);
    expect([pt("c4"), pt("c5"), pt("c6")].map((x) => [x.status, x.recalledWhenAsked])).toEqual([["MISSED", true], ["MISSED", false], ["MISSED", true]]);
    // The unprompted result is untouched.
    expect(after.result).toMatchObject({ score: before.result.score, outcome: before.result.outcome, stageAfter: before.result.stageAfter, nextDueDate: before.result.nextDueDate });
    expect(after.followupAnswer).toMatch(/runtime checks/);
    // Answered once.
    expect((await asUser(app, H).post(`/api/recall/reviews/${reviewId}/followup`).send({ answer: "a second answer here" }).expect(200)).body.followupAnswer).toMatch(/runtime checks/);
  });

  it("completes the review; the next one is attempt 2 when due again", async () => {
    const done = (await asUser(app, H).post(`/api/recall/reviews/${reviewId}/complete`).expect(200)).body;
    expect(done.status).toBe("COMPLETE");
    // The senior engineer's verdict: written from the results; the rating is worked out in code (2 of 3 missed points shown when asked).
    expect(done.seniorVerdict).toMatchObject({ cuedReasoningRating: "Strong", recalledWhenAsked: [expect.stringMatching(/usage$/), expect.stringMatching(/pitfalls$/)], promptVersion: "recall-verdict-v1" });
    expect(done.seniorVerdict.foundationsSummary).toMatch(/definition/);
    expect(done.seniorVerdict.architectureAndEdgeCasesSummary).toMatch(/pitfalls/);
    expect((await home()).doneToday).toBe(1);
    clock.date = "2026-11-22";
    const r = (await asUser(app, H).post("/api/recall/reviews").send({ subtopicId: subA }).expect(201)).body as Review;
    expect(r).toMatchObject({ attempt: 2, status: "DRAFT" });
    reviewId = r.id;
  });

  it("waits while the grading model is busy and checks as soon as it answers, never with another model", async () => {
    busy = 1;
    await asUser(app, H).patch(`/api/recall/reviews/${reviewId}`).send({ typed: "definition purpose mechanism usage syntax pitfalls all explained" }).expect(200);
    await asUser(app, H).post(`/api/recall/reviews/${reviewId}/submit`).expect(202);
    const r = await checked(reviewId);
    expect(r.result).toMatchObject({ outcome: "PASS", stageBefore: 1, stageAfter: 2, nextDueDate: "2026-11-24", depth: "MASTERY" });
    expect(r.result!.score).toBe(1);
    const models = await prisma.aiUsage.findMany({ where: { operation: "RECALL" }, select: { model: true, outcome: true }, orderBy: { id: "asc" } });
    expect(models.slice(-2).map((m) => m.outcome)).toEqual(["PROVIDER_ERROR", "OK"]);
    expect(new Set(models.slice(-2).map((m) => m.model)).size).toBe(1);
  });

  it("refuses an explanation that is too short, and edits after sending", async () => {
    await asUser(app, H).post(`/api/recall/reviews/${reviewId}/complete`).expect(200);
    await asUser(app, H).patch(`/api/recall/reviews/${reviewId}`).send({ typed: "x" }).expect(409);
    clock.date = "2026-11-24";
    const r = (await asUser(app, H).post("/api/recall/reviews").send({ subtopicId: subA }).expect(201)).body as Review;
    await asUser(app, H).patch(`/api/recall/reviews/${r.id}`).send({ typed: "too short" }).expect(200);
    expect((await asUser(app, H).post(`/api/recall/reviews/${r.id}/submit`).expect(400)).body.error.code).toBe("EXPLANATION_TOO_SHORT");
  });

  it("compares a completed review with the earlier ones in code, and shows the points × reviews grid", async () => {
    let analysis = null;
    for (let i = 0; i < 100 && !analysis; i++) {
      analysis = await prisma.recallAnalysis.findFirst({ where: { subtopicId: subA, attempt: 2 } });
      if (!analysis) await new Promise((ok) => setTimeout(ok, 20));
    }
    const diff = analysis!.diffPayload as { newlyMastered: { label: string }[]; retained: unknown[]; regressed: unknown[]; scoreTrajectory: { score: number }[]; previousAttempt: number };
    expect(diff.previousAttempt).toBe(1);
    expect(diff.newlyMastered.map((x) => x.label.split(" ").pop())).toEqual(["usage", "syntax", "pitfalls"]);
    expect(diff.retained).toHaveLength(3);
    expect(diff.regressed).toEqual([]);
    expect(diff.scoreTrajectory.map((x) => x.score)).toEqual([expect.closeTo(4 / 8 - 0.15, 3), 1]);
    expect(analysis!.narrative).toMatch(/changed since last time/);
    // No analysis for a first review.
    expect(await prisma.recallAnalysis.count({ where: { subtopicId: subA, attempt: 1 } })).toBe(0);
    const m = (await asUser(app, H).get(`/api/recall/subtopics/${subA}/matrix`).expect(200)).body;
    expect(m).toMatchObject({ subtopicId: subA, version: 1 });
    expect(m.points).toHaveLength(6);
    expect(m.attempts.map((a: { attempt: number }) => a.attempt)).toEqual([1, 2]);
    const c4 = m.points.find((x: { code: string }) => x.code === "c4").id;
    expect([m.attempts[0].cells[c4], m.attempts[1].cells[c4]]).toEqual([{ status: "MISSED", recalledWhenAsked: true }, { status: "ACCURATE", recalledWhenAsked: false }]);
    expect(m.analyses).toEqual([expect.objectContaining({ attempt: 2 })]);
    // The Progress tab's coaching: the same comparison in code, with the note written after the review.
    const coaching = (await asUser(app, H).get("/api/progress").expect(200)).body.recall.coaching;
    const a = coaching.subtopics.find((x: { subtopicId: number }) => x.subtopicId === subA);
    expect(a).toMatchObject({ reviews: 2, lastScore: 1, slipped: [], blindSpots: [], recurringMisconceptions: [] });
    expect(a.newlyMastered.map((x: string) => x.split(" ").pop())).toEqual(["usage", "syntax", "pitfalls"]);
    expect(a.scoreDelta).toBeCloseTo(1 - (4 / 8 - 0.15), 3);
    expect(a.narrative).toMatch(/changed since last time/);
  });

  it("plans recall tasks within the daily limit, carries missed ones over, and moves one to tomorrow on request", async () => {
    await prisma.settings.updateMany({ where: { cityId: "engineering" }, data: { revisionDailyMinutes: 8 } }); // one a day
    const subC = (await prisma.subtopic.findFirstOrThrow({ where: { topicId: "fe.ts", position: 2 } })).id;
    await asUser(app, H).patch(`/api/subtopics/${subB}`).send({ completed: true }).expect(200);
    await asUser(app, H).patch(`/api/subtopics/${subC}`).send({ completed: true }).expect(200);
    const day = async (id: number) => (await prisma.task.findFirstOrThrow({ where: { subtopicId: id, status: "TODO", recallStateId: { not: null } } })).scheduledDate.toISOString().slice(0, 10);
    expect([await day(subB), await day(subC)]).toEqual(["2026-11-25", "2026-11-26"]); // both due on the 25th; one moves on
    clock.date = "2026-11-25";
    const h = await home();
    expect(h.limit).toBe(1);
    // subA's task from the 24th is carried over, subB is today's, subC waits for the next day.
    expect(h.due.map((x: { subtopicId: number }) => x.subtopicId)).toEqual([subA, subB]);
    expect(h.due[0]).toMatchObject({ overdueDays: 1 });
    expect(h.later.map((x: { subtopicId: number }) => x.subtopicId)).toEqual([subC]);
    expect((await asUser(app, H).get("/api/today").expect(200)).body.recall).toMatchObject({ dueCount: 2, overdueCount: 1 });
    expect((await asUser(app, H).post(`/api/recall/subtopics/${subB}/postpone`).expect(200)).body.nextDueDate).toBe("2026-11-26");
    expect(await day(subB)).toBe("2026-11-27"); // the 26th already has subC
    await prisma.settings.updateMany({ where: { cityId: "engineering" }, data: { revisionDailyMinutes: 30 } });
    await asUser(app, H).patch(`/api/subtopics/${subC}`).send({ completed: false }).expect(200);
  });

  it("never plans a recall on a rest day: one due on Sunday moves to Monday", async () => {
    const subD = (await prisma.subtopic.findFirstOrThrow({ where: { topicId: "fe.ts", position: 3 } })).id;
    clock.date = "2026-11-28"; // Saturday: ticked today, due Sunday the 29th
    await asUser(app, H).patch(`/api/subtopics/${subD}`).send({ completed: true }).expect(200);
    const t = await prisma.task.findFirstOrThrow({ where: { subtopicId: subD, status: "TODO", recallStateId: { not: null } } });
    expect([t.originalDate.toISOString().slice(0, 10), t.scheduledDate.toISOString().slice(0, 10)]).toEqual(["2026-11-29", "2026-11-30"]);
    await asUser(app, H).patch(`/api/subtopics/${subD}`).send({ completed: false }).expect(200);
    clock.date = "2026-11-25";
  });

  it("stops scheduling a sub-topic that is unticked, and resumes when it is learned again", async () => {
    await asUser(app, H).patch(`/api/subtopics/${subB}`).send({ completed: false }).expect(200);
    expect((await prisma.recallState.findUniqueOrThrow({ where: { subtopicId: subB } })).nextDueDate).toBeNull();
    expect(await prisma.task.count({ where: { subtopicId: subB, status: "TODO", recallStateId: { not: null } } })).toBe(0);
    await asUser(app, H).patch(`/api/subtopics/${subB}`).send({ completed: true }).expect(200);
    expect((await prisma.recallState.findUniqueOrThrow({ where: { subtopicId: subB } })).nextDueDate?.toISOString().slice(0, 10)).toBe("2026-11-26");
    expect(await prisma.task.count({ where: { subtopicId: subB, status: "TODO", recallStateId: { not: null } } })).toBe(1);
  });

  it("gives two starts at the same moment one review and one checklist", async () => {
    clock.date = "2026-11-26";
    const [x, y] = await Promise.all([
      asUser(app, H).post("/api/recall/reviews").send({ subtopicId: subB }).expect(201),
      asUser(app, H).post("/api/recall/reviews").send({ subtopicId: subB }).expect(201),
    ]);
    expect(x.body.id).toBe(y.body.id);
    expect(await prisma.recallChecklist.count({ where: { subtopicId: subB } })).toBe(1);
    expect(await prisma.recallReview.count({ where: { subtopicId: subB } })).toBe(1);
  });

  it("keeps every city's recall to itself, and puts it in the owner's data export", async () => {
    await asUser(app, B).get(`/api/recall/reviews/${reviewId}`).expect(404);
    await asUser(app, B).post(`/api/recall/reviews/${reviewId}/submit`).expect(404);
    const pointId = (await prisma.recallPoint.findFirstOrThrow()).id;
    await asUser(app, B).patch(`/api/recall/points/${pointId}`).send({ leftOut: true }).expect(404);
    expect((await asUser(app, B).get("/api/recall/home").expect(200)).body).toMatchObject({ due: [], later: [], upcoming: [], open: [] });
    const mine = (await asUser(app, H).get("/api/account/export").expect(200)).body;
    const city = mine.cities.find((c: { id: string }) => c.id === "engineering");
    expect(city.recallReviews.length).toBeGreaterThanOrEqual(3);
    expect(city.recallChecklists[0].points).toHaveLength(6);
    expect(city.recallAnalyses).toEqual(expect.arrayContaining([expect.objectContaining({ subtopicId: subA, attempt: 2 })]));
  });

  it("reads a sketch literally, keeps only its description, and grades it with the explanation", async () => {
    const draft = await prisma.recallReview.findFirstOrThrow({ where: { subtopicId: subB, status: "DRAFT" } });
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await asUser(app, H).post(`/api/recall/reviews/${draft.id}/sketches`).set("Content-Type", "image/png").send(Buffer.from("not an image")).expect(415);
    let r = (await asUser(app, H).post(`/api/recall/reviews/${draft.id}/sketches`).set("Content-Type", "image/png").send(PNG).expect(201)).body;
    expect(r.sketches).toEqual([expect.stringMatching(/^Box: mechanism/)]);
    expect(JSON.stringify(await prisma.recallReview.findUniqueOrThrow({ where: { id: draft.id } }))).not.toContain(PNG.toString("base64").slice(0, 20));
    await asUser(app, H).patch(`/api/recall/reviews/${draft.id}`).send({ typed: "the definition of it" }).expect(200);
    await asUser(app, H).post(`/api/recall/reviews/${draft.id}/submit`).expect(202);
    for (let i = 0; i < 200 && r.status !== "CHECKED"; i++) {
      r = (await asUser(app, H).get(`/api/recall/reviews/${draft.id}`).expect(200)).body;
      if (r.status !== "CHECKED") await new Promise((ok) => setTimeout(ok, 20));
    }
    const saved = await prisma.recallReview.findUniqueOrThrow({ where: { id: draft.id } });
    expect(saved.explanation).toMatch(/the definition of it\n\n\[SKETCH 1\]: Box: mechanism/);
    // What the sketch shows counts like what was said.
    expect(r.result.points.find((x: { code: string }) => x.code === "c3")).toMatchObject({ status: "ACCURATE", evidence: "mechanism" });
    await asUser(app, H).delete(`/api/recall/reviews/${draft.id}/sketches/0`).expect(409); // sent: no more changes
  });

  it("rebuilds a checklist as a new version: graded reviews stay on theirs, an unsent draft moves, the schedule is kept", async () => {
    const recall = app.locals.recall as RecallService;
    const old = await prisma.recallChecklist.findFirstOrThrow({ where: { subtopicId: subA }, orderBy: { version: "desc" }, include: { reviews: true, points: true } });
    const graded = old.reviews.filter((r) => r.status !== "DRAFT").map((r) => r.id);
    expect(graded.length).toBeGreaterThan(0);
    const last = await prisma.recallReview.findFirstOrThrow({ where: { subtopicId: subA }, orderBy: { attempt: "desc" } });
    const draft = last.status === "DRAFT" ? last
      : await prisma.recallReview.create({ data: { cityId: old.cityId, subtopicId: subA, checklistId: old.id, attempt: last.attempt + 1, date: last.date, typed: "kept as typed" } });
    const state = await prisma.recallState.findUniqueOrThrow({ where: { subtopicId: subA } });

    const out = await recall.rebuildChecklist(cityScoped(prisma, old.cityId), old.cityId, subA);
    expect(out).toMatchObject({ from: { id: old.id, version: old.version }, to: { version: old.version + 1, promptVersion: "recall-checklist-v4" }, movedDrafts: 1 });
    // Graded reviews and the old points stay exactly as they were.
    expect((await prisma.recallReview.findMany({ where: { id: { in: graded } } })).every((r) => r.checklistId === old.id)).toBe(true);
    expect(await prisma.recallPoint.count({ where: { checklistId: old.id } })).toBe(old.points.length);
    // The unsent draft moves to the new version with what was typed; the schedule is untouched.
    expect(await prisma.recallReview.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ checklistId: out.to.id, typed: draft.typed });
    expect(await prisma.recallState.findUniqueOrThrow({ where: { subtopicId: subA } })).toMatchObject({ stage: state.stage, nextDueDate: state.nextDueDate });
    // Recall over time starts again on the new version.
    expect((await asUser(app, H).get(`/api/recall/subtopics/${subA}/matrix`).expect(200)).body).toMatchObject({ version: old.version + 1, attempts: [] });
    // A review waiting for its grade stops a rebuild.
    await prisma.recallReview.update({ where: { id: draft.id }, data: { status: "WAITING" } });
    await expect(recall.rebuildChecklist(cityScoped(prisma, old.cityId), old.cityId, subA)).rejects.toMatchObject({ code: "REVIEW_WAITING" });
    await prisma.recallReview.update({ where: { id: draft.id }, data: { status: "DRAFT" } });
  });
});
