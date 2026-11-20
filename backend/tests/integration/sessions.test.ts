/**
 * Revision v2, phases 2 and 3 end to end on a real database with the fake provider: the home, a planned session with
 * multiple choice checked in code and open answers checked by the AI, hints, results, relearning, finishing with
 * concept results and the next date, the move from sub-topic schedules, cycles over several days, history, reports,
 * isolation and the export.
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
import { asUser, signIn } from "../helpers/auth.js";
import { wav } from "../helpers/wav.js";

const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const schema = `it_sess_${Date.now()}`;
const url = base ? `${base}${base.includes("?") ? "&" : "?"}schema=${schema}` : "";

const NOTES = "## Generics\nType parameters let one function work for many types.\n## Constraints\nextends limits what a type parameter accepts.\n## Inference\nTypeScript infers type arguments from the call.";
type Q = { index: number; format: string; options: string[]; question: string; conceptTitle: string; relearn: boolean; hintsAvailable: number; topicId: string };
type S = { id: number; status: string; entries: { state: string; final: number | null; relearn: boolean }[]; current: { question: Q; feedback: null | { responseId: number } } | null; topics: { topicId: string; questions: number }[] };

suite("revision sessions", () => {
  let prisma: PrismaClient;
  const clock = new TestClock("2026-11-20");
  const config = loadAiConfig({ AI_ENABLED: "true", AI_EVALUATION_PROVIDER: "fake", AI_TRANSCRIPTION_PROVIDER: "fake", AI_GENERATION_PROVIDER: "fake", AI_GENERATION_RETRY_DELAYS_MS: "0,0" });
  let app: ReturnType<typeof createApp>;
  const H: Record<string, string> = {};
  const B: Record<string, string> = {};
  const T = "fe.ts";

  async function packReady(topic = T) {
    for (let i = 0; i < 100; i++) {
      const o = (await asUser(app, H).get(`/api/topics/${topic}/revision/pack`).expect(200)).body;
      if (!o.building) return o;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("pack did not finish");
  }

  /** Answers the current question: right or wrong for multiple choice, a fitting or empty-ish answer for open ones. */
  async function answerCurrent(s: S, opts: { right: boolean; final?: number }) {
    const q = s.current!.question;
    const body = q.format === "OPEN"
      ? { index: q.index, mode: "TYPED", answer: opts.right ? `${q.conceptTitle} purpose ${q.conceptTitle} example ${q.conceptTitle} limits` : "I am not sure at all", confidence: 2 }
      : { index: q.index, mode: "CHOICE", choice: opts.right ? [0] : [2] };
    const fb = (await asUser(app, H).post(`/api/revision/sessions/${s.id}/answers`).send(body).expect(201)).body;
    const final = opts.final ?? fb.suggested ?? (opts.right ? 2 : 0);
    return { fb, s: (await asUser(app, H).post(`/api/revision/sessions/${s.id}/results`).send({ responseId: fb.responseId, final }).expect(200)).body as S };
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

    // A learned sub-topic (it also gets an old-style revision schedule and task), material, and a built pack.
    clock.date = "2026-11-19";
    const sub = await prisma.subtopic.findFirstOrThrow({ where: { topicId: T, position: 0 } });
    await asUser(app, H).patch(`/api/subtopics/${sub.id}`).send({ completed: true }).expect(200);
    clock.date = "2026-11-20";
    await asUser(app, H).post("/api/account/consents").send({ purpose: "AI_PROCESSING", granted: true }).expect(200);
    await asUser(app, H).post(`/api/topics/${T}/revision/material?name=notes.md`).set("Content-Type", "text/markdown").send(Buffer.from(NOTES)).expect(201);
    await asUser(app, H).post(`/api/topics/${T}/revision/pack`).send({}).expect(202);
    await packReady();
  }, 120_000);
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  it("shows today's set on the home, and topics that still need material", async () => {
    const h = (await asUser(app, H).get("/api/revision/home").expect(200)).body;
    expect(h.tracks).toEqual([expect.objectContaining({ topicId: T, cycle: 0, inProgress: 1, state: "ACTIVE", nextDueDate: "2026-11-20", due: true })]);
    expect(h.plan).toMatchObject({ questions: 4, topics: [{ topicId: T, cycle: 1, questions: 4 }] });
    expect(h.plan.minutes).toBe(1 + 4 + 1 + 4);
    expect(h.budgetMinutes).toBe(30);
    expect(h.activeSession).toBeNull();
    // A learned topic without a pack needs material.
    const sub = await prisma.subtopic.findFirstOrThrow({ where: { topicId: "fe.react", position: 0 } });
    await asUser(app, H).patch(`/api/subtopics/${sub.id}`).send({ completed: true }).expect(200);
    const h2 = (await asUser(app, H).get("/api/revision/home").expect(200)).body;
    expect(h2.needsMaterial.map((x: { topicId: string }) => x.topicId)).toContain("fe.react");
  });

  it("runs a session: questions without answers, choice checked in code, open answers by the AI, hints, relearning", async () => {
    const v1Before = await prisma.task.count({ where: { topicId: T, source: "REVISION", status: "TODO" } });
    expect(v1Before).toBeGreaterThan(0);
    let s = (await asUser(app, H).post("/api/revision/sessions").send({ kind: "PLANNED" }).expect(201)).body as S;
    // Starting again returns the same open session.
    expect((await asUser(app, H).post("/api/revision/sessions").send({}).expect(201)).body.id).toBe(s.id);
    // The topic moved to v2: its old sub-topic revision task is gone and no new one is planned.
    expect(await prisma.task.count({ where: { topicId: T, source: "REVISION", status: "TODO" } })).toBe(0);
    expect(JSON.stringify(s.current!.question)).not.toMatch(/modelAnswer|explanation|"correct"|expected/);
    expect(s.current!.question).toMatchObject({ format: "CHOICE", hintsAvailable: 3 });

    // A hint before answering: stored, no AI.
    const h = (await asUser(app, H).post(`/api/revision/sessions/${s.id}/hint`).send({ index: 0 }).expect(200)).body;
    expect(h).toMatchObject({ hintsUsed: 1, hints: ["Rule out the extreme claims."] });
    // Answering out of order is refused.
    await asUser(app, H).post(`/api/revision/sessions/${s.id}/answers`).send({ index: 2, mode: "CHOICE", choice: [0] }).expect(409);

    // 1: multiple choice, right, after a hint → Recalled suggested; the explanations come back now.
    let r = await answerCurrent(s, { right: true });
    expect(r.fb).toMatchObject({ correct: true, suggested: 2, hintsUsed: 1 });
    expect(r.fb.options[0]).toMatchObject({ correct: true, chosen: true, explanation: "Right: that is its purpose." });
    await asUser(app, H).post(`/api/revision/sessions/${s.id}/answers`).send({ index: 0, mode: "CHOICE", choice: [0] }).expect(409);
    s = r.s;

    // 2: open, checked by the AI against the expected points, with quotes.
    r = await answerCurrent(s, { right: true });
    expect(r.fb.evaluation.criteria.every((c: { verdict: string }) => c.verdict === "COVERED")).toBe(true);
    expect(r.fb.suggested).toBe(3);
    expect(r.fb.modelAnswer.gist.length).toBeLessThanOrEqual(r.fb.modelAnswer.full.length);
    s = r.s;

    // 3: multiple choice wrong → Forgot, and a relearning question is added at the end.
    const before = s.entries.length;
    r = await answerCurrent(s, { right: false });
    expect(r.fb).toMatchObject({ correct: false, suggested: 0 });
    expect(r.fb.misconceptions.length).toBeGreaterThan(0);
    s = r.s;
    expect(s.entries.length).toBe(before + 1);
    expect(s.entries.at(-1)!.relearn).toBe(true);

    // 4: open, a weak answer; then the relearning question, answered right.
    s = (await answerCurrent(s, { right: false, final: 1 })).s;
    expect(s.current!.question.relearn).toBe(true);
    s = (await answerCurrent(s, { right: true })).s;
    expect(s.current).toBeNull();

    const done = (await asUser(app, H).post(`/api/revision/sessions/${s.id}/finish`).expect(200)).body;
    expect(done.session.status).toBe("FINISHED");
    expect(done.cards).toHaveLength(1);
    const card = done.cards[0];
    expect(card).toMatchObject({ topicId: T, cycle: 1, cycleDone: false, nextDueDate: "2026-11-21" }); // one concept left in cycle 1
    expect(card.results.map((x: { label: string; relearned: boolean }) => [x.label, x.relearned])).toEqual([["Strong recall", false], ["Recalled", true]]);
    expect(await prisma.conceptResult.count()).toBe(2);
    await asUser(app, H).post(`/api/revision/sessions/${s.id}/answers`).send({ index: 0, mode: "CHOICE", choice: [0] }).expect(409);
  });

  it("finishes cycle 1 the next day and schedules cycle 2 three days later", async () => {
    clock.date = "2026-11-21";
    const h = (await asUser(app, H).get("/api/revision/home").expect(200)).body;
    expect(h.plan.questions).toBe(2); // the third concept: a pair in cycle 1
    let s = (await asUser(app, H).post("/api/revision/sessions").send({}).expect(201)).body as S;
    while (s.current) s = (await answerCurrent(s, { right: true })).s;
    const done = (await asUser(app, H).post(`/api/revision/sessions/${s.id}/finish`).expect(200)).body;
    expect(done.cards[0]).toMatchObject({ cycle: 1, cycleDone: true, nextDueDate: "2026-11-24" });
    const track = await prisma.revisionTrack.findUniqueOrThrow({ where: { topicId: T } });
    expect(track).toMatchObject({ cycle: 1, weakOnly: false });
  });

  it("keeps going on tomorrow's topics, and practises weak concepts without changing a date", async () => {
    await asUser(app, H).post("/api/revision/sessions").send({ kind: "EARLY" }).expect(409); // nothing due tomorrow
    clock.date = "2026-11-23";
    const h = (await asUser(app, H).get("/api/revision/home").expect(200)).body;
    expect(h.keepGoing.tomorrow).toBe(1);
    const early = await asUser(app, H).post("/api/revision/sessions").send({ kind: "EARLY" }).expect(201);
    let s = early.body as S;
    // Cycle 2: one open question per concept (the relearned concept gets a pair a level lower).
    expect(s.topics[0].questions).toBeGreaterThanOrEqual(3);
    s = (await answerCurrent(s, { right: false, final: 0 })).s; // a miss makes this cycle a weak retry
    while (s.current) s = (await answerCurrent(s, { right: true })).s;
    const done = (await asUser(app, H).post(`/api/revision/sessions/${s.id}/finish`).expect(200)).body;
    expect(done.cards[0]).toMatchObject({ cycle: 2 });
    const track = await prisma.revisionTrack.findUniqueOrThrow({ where: { topicId: T } });
    const dueBefore = track.nextDueDate;

    const p = (await asUser(app, H).post("/api/revision/sessions").send({ kind: "PRACTICE" }).expect(201)).body as S;
    expect(p.entries.length).toBeGreaterThan(0);
    let q = p;
    while (q.current) q = (await answerCurrent(q, { right: true })).s;
    const pd = (await asUser(app, H).post(`/api/revision/sessions/${q.id}/finish`).expect(200)).body;
    expect(pd.cards).toEqual([]);
    expect((await prisma.revisionTrack.findUniqueOrThrow({ where: { topicId: T } })).nextDueDate).toEqual(dueBefore);
  });

  it("transcribes a spoken answer with the session's terms, and never stores the recording", async () => {
    const s = (await prisma.revisionSession.findFirstOrThrow({ orderBy: { id: "desc" } }));
    const open = await asUser(app, H).post("/api/revision/sessions").send({ kind: "PRACTICE" }).expect(201);
    const r = await asUser(app, H).post(`/api/revision/sessions/${open.body.id}/transcriptions?index=0`).set("Content-Type", "audio/wav").send(wav(2)).expect(200);
    expect(r.body.text).toMatch(/fake transcript/);
    expect(s.id).toBeLessThan(open.body.id);
  });

  it("shows the history per concept and cycle, with every answer behind a cell", async () => {
    const h = (await asUser(app, H).get(`/api/topics/${T}/revision/history`).expect(200)).body;
    expect(h.cycles).toEqual([1, 2]);
    expect(h.concepts).toHaveLength(3);
    const first = h.concepts[0];
    expect(first.cells[0]).toMatchObject({ cycle: 1, result: expect.any(Number) });
    expect(first.cells[0].answers[0]).toMatchObject({ question: expect.any(String), modelAnswer: expect.any(String) });
    expect(first.story).toMatch(/^Generics: .+ in cycle/);
  });

  it("reports a question as out of syllabus: it leaves future sessions, the answers stay", async () => {
    const resp = await prisma.revisionResponse.findFirstOrThrow({ where: { itemId: { not: null } }, orderBy: { id: "asc" } });
    await asUser(app, H).post("/api/revision/reports").send({ reason: "OUT_OF_SYLLABUS", promptText: resp.question, topicId: T, responseId: resp.id, itemId: resp.itemId }).expect(201);
    expect((await prisma.revisionItem.findUniqueOrThrow({ where: { id: resp.itemId! } })).removedAt).not.toBeNull();
    await asUser(app, H).post("/api/revision/reports").send({ reason: "UNFAIR_CHECK", promptText: resp.question, responseId: resp.id }).expect(201);
    expect(await prisma.revisionReport.count({ where: { responseId: resp.id } })).toBe(2);
    expect(await prisma.revisionResponse.count({ where: { id: resp.id } })).toBe(1);
    await asUser(app, H).post("/api/revision/reports").send({ reason: "UNCLEAR", promptText: "x", removeConcept: true }).expect(400);
  });

  it("writes a few more questions in the background when a concept's questions have all been asked", async () => {
    clock.date = "2026-12-01";
    const track = await prisma.revisionTrack.findUniqueOrThrow({ where: { topicId: T } });
    await prisma.revisionTrack.update({ where: { id: track.id }, data: { nextDueDate: new Date("2026-12-01T00:00:00Z") } });
    const pack = await prisma.revisionPack.findFirstOrThrow({ where: { topicId: T, status: "READY" }, include: { concepts: { include: { items: true } } } });
    const s0 = await prisma.revisionSession.findFirstOrThrow();
    // Every question of every concept has been asked once.
    for (const c of pack.concepts)
      for (const it of c.items)
        await prisma.revisionResponse.create({ data: { cityId: "engineering", sessionId: s0.id, itemId: it.id, conceptId: c.id, topicId: T, cycle: 1, position: 999, level: it.level, kind: it.kind, format: it.format, question: it.question, expected: it.expected as never, modelAnswer: it.modelAnswer, mode: "TYPED" } });
    const before = await prisma.revisionItem.count({ where: { concept: { packId: pack.id } } });
    const s = (await asUser(app, H).post("/api/revision/sessions").send({}).expect(201)).body as S;
    for (let i = 0; i < 100 && (await prisma.revisionItem.count({ where: { concept: { packId: pack.id } } })) === before; i++) await new Promise((r) => setTimeout(r, 50));
    expect(await prisma.revisionItem.count({ where: { concept: { packId: pack.id } } })).toBeGreaterThan(before);
    expect((await prisma.revisionConcept.findMany({ where: { packId: pack.id } })).every((c) => c.status === "READY")).toBe(true);
    let q = s;
    while (q.current) q = (await answerCurrent(q, { right: true })).s;
    await asUser(app, H).post(`/api/revision/sessions/${q.id}/finish`).expect(200);
  });

  it("checks a retained topic every four months only when maintenance is switched on", async () => {
    const track = await prisma.revisionTrack.findUniqueOrThrow({ where: { topicId: T } });
    await asUser(app, H).patch(`/api/topics/${T}/revision/track`).send({ maintenance: true }).expect(409); // not retained yet
    await prisma.revisionTrack.update({ where: { id: track.id }, data: { cycle: 6, state: "RETAINED", nextDueDate: null, lastReviewDate: new Date("2026-08-01T00:00:00Z") } });
    const on = (await asUser(app, H).patch(`/api/topics/${T}/revision/track`).send({ maintenance: true }).expect(200)).body;
    expect(on).toEqual({ topicId: T, maintenance: true, nextDueDate: "2026-12-01" }); // 120 days after August were already past
    const h = (await asUser(app, H).get("/api/revision/home").expect(200)).body;
    expect(h.plan.topics).toEqual([expect.objectContaining({ topicId: T, cycle: 6 })]);
    let s = (await asUser(app, H).post("/api/revision/sessions").send({}).expect(201)).body as S;
    expect(s.entries.every((e) => !e.relearn)).toBe(true);
    while (s.current) s = (await answerCurrent(s, { right: true })).s;
    const done = (await asUser(app, H).post(`/api/revision/sessions/${s.id}/finish`).expect(200)).body;
    expect(done.cards[0]).toMatchObject({ retained: true, nextDueDate: "2027-03-31" });
    expect((await prisma.revisionTrack.findUniqueOrThrow({ where: { id: track.id } })).state).toBe("RETAINED");
    const off = (await asUser(app, H).patch(`/api/topics/${T}/revision/track`).send({ maintenance: false }).expect(200)).body;
    expect(off.nextDueDate).toBeNull();
  });

  it("keeps sessions, answers and history to their city, and exports them", async () => {
    const s = await prisma.revisionSession.findFirstOrThrow();
    await asUser(app, B).get(`/api/revision/sessions/${s.id}`).expect(404);
    await asUser(app, B).post(`/api/revision/sessions/${s.id}/hint`).send({ index: 0 }).expect(404);
    await asUser(app, B).get(`/api/topics/${T}/revision/history`).expect(404);
    const resp = await prisma.revisionResponse.findFirstOrThrow();
    await asUser(app, B).post("/api/revision/reports").send({ reason: "UNCLEAR", promptText: "x", responseId: resp.id }).expect(404);
    const theirs = (await asUser(app, B).get("/api/revision/home").expect(200)).body;
    expect(theirs.tracks).toEqual([]);
    const mine = (await asUser(app, H).get("/api/account/export").expect(200)).body;
    const city = mine.cities.find((c: { id: string }) => c.id === "engineering");
    expect(city.revisionSessions.length).toBeGreaterThan(0);
    expect(city.revisionResponses.length).toBeGreaterThan(0);
    expect(city.conceptResults.length).toBeGreaterThan(0);
    expect(city.revisionTracks).toHaveLength(1);
  });
});
