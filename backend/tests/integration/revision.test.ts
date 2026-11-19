/**
 * Revision and active recall: acceptance scenarios A–G of the Revision spec (§17) against a real database.
 * Same setup as api.test.ts: a fresh schema per run, migrated with `migrate deploy`, dropped afterwards.
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { TestClock } from "../../src/lib/clock.js";
import { seed } from "../../prisma/seed.js";
import { asUser, signIn } from "../helpers/auth.js";

/** Session cookie and city for every request (filled in beforeAll). */
const H: Record<string, string> = {};

const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const schema = `it_rev_${Date.now()}`;
const url = base ? `${base}${base.includes("?") ? "&" : "?"}schema=${schema}` : "";

type Unit = {
  unit: string; scope: string; subtopicId: number | null; eligible: boolean;
  schedule: null | { id: number; status: string; nextDueDate: string | null; correctionPending: boolean; pendingAttemptId: number | null;
    consecutiveSuccesses: number; weak: boolean; openTask: { id: number; scheduledDate: string } | null; attempts: number };
  options: { promptId: number | null; templateKey: string | null; source: string; content: string; retrievalMethod: string; isActive: boolean }[];
  suggested: number;
};

suite("Revision and active recall", () => {
  let prisma: PrismaClient;
  const clock = new TestClock("2026-11-18"); // Wednesday
  let app: ReturnType<typeof createApp>;

  const revision = async (topicId: string) => (await asUser(app, H).get(`/api/topics/${topicId}/revision`).expect(200)).body as { units: Unit[]; attempts: { score: number }[]; prompts: { id: number; source: string }[] };
  const unitOf = async (topicId: string, position: number) => (await revision(topicId)).units[position + 1];
  const subId = async (topicId: string, position: number) => (await prisma.subtopic.findFirstOrThrow({ where: { topicId, position } })).id;
  const learn = (id: number, completed = true) => asUser(app, H).patch(`/api/subtopics/${id}`).send({ completed }).expect(200);
  const attempt = (topicId: string, subtopicId: number | undefined, body: Record<string, unknown>) =>
    asUser(app, H).post("/api/revision/attempts").send({
      topicId, subtopicId, templateKey: "explain", retrievalMethod: "CONCEPTUAL", usedHints: false, usedNotes: false, ...body,
    });

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = new PrismaClient({ datasourceUrl: url });
    await seed(prisma, () => {}, clock.date, { createEngineeringCity: true });
    Object.assign(H, (await signIn(prisma)).headers);
    app = createApp({ prisma, clock });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  it("seeds one curriculum prompt per topic and offers templates for every unit", async () => {
    expect(await prisma.revisionPrompt.count({ where: { source: "CURRICULUM" } })).toBe(83);
    const r = await revision("fe.ts");
    expect(r.units[0]).toMatchObject({ scope: "TOPIC", eligible: false, schedule: null });
    expect(r.units[0].options[0]).toMatchObject({ source: "CURRICULUM", retrievalMethod: "PRACTICAL" });
    expect(r.units[1].options.filter((o) => o.source === "TEMPLATE")).toHaveLength(8);
    expect(r.units[1].options[0].content).toContain("Generics (TypeScript)");
  });

  it("A: a learning checkpoint is recorded but never marks the sub-topic learned", async () => {
    const id = await subId("fe.ts", 0);
    const c = await asUser(app, H)
      .post("/api/checkpoints")
      .send({ topicId: "fe.ts", subtopicId: id, templateKey: "explain", result: "PARTIAL", neededAssistance: true, gaps: "Forgot constraints", response: "…" })
      .expect(201);
    expect(c.body).toMatchObject({ result: "PARTIAL", neededAssistance: true, date: "2026-11-18" });
    expect((await prisma.subtopic.findUniqueOrThrow({ where: { id } })).completedAt).toBeNull();
    expect((await unitOf("fe.ts", 0)).eligible).toBe(false);
    const r = await attempt("fe.ts", id, { score: 3 }).expect(409);
    expect(r.body.error.code).toBe("NOT_ELIGIBLE");
  });

  it("B: marking a sub-topic learned schedules a revision for the next study day", async () => {
    const id = await subId("fe.ts", 0);
    await learn(id);
    const u = await unitOf("fe.ts", 0);
    expect(u.schedule).toMatchObject({ status: "SCHEDULED", nextDueDate: "2026-11-19", openTask: { scheduledDate: "2026-11-19" } });
    const task = (await asUser(app, H).get(`/api/tasks/${u.schedule!.openTask!.id}`).expect(200)).body;
    expect(task).toMatchObject({ kind: "REVISION", source: "REVISION", originalDate: "2026-11-19", estimatedMinutes: 10, revision: { scope: "SUBTOPIC", weak: false } });
    // A revision task is completed only through an assessed attempt (spec §9.3).
    expect((await asUser(app, H).patch(`/api/tasks/${task.id}`).send({ status: "DONE" }).expect(409)).body.error.code).toBe("ATTEMPT_REQUIRED");
    await asUser(app, H).patch(`/api/tasks/${task.id}`).send({ status: "SKIPPED" }).expect(409);
    await asUser(app, H).delete(`/api/tasks/${task.id}`).expect(409);

    clock.date = "2026-11-19";
    const today = (await asUser(app, H).get("/api/today").expect(200)).body;
    expect(today.revision).toMatchObject({ plannedMinutes: 10, learningMinutes: 240, competing: true, dueCount: 1 });
    expect(today.revision.sessionTaskIds).toEqual([task.id]);

    const before = (await asUser(app, H).get("/api/progress")).body;
    const r = await attempt("fe.ts", id, { score: 3, durationMinutes: 12 }).expect(201);
    expect(r.body).toMatchObject({ nextDueDate: "2026-11-26", intervalDays: 7, correctionPending: false, nextTaskDate: "2026-11-26" });
    expect((await asUser(app, H).get(`/api/tasks/${task.id}`)).body).toMatchObject({ status: "DONE", loggedMinutes: 12 });

    // G: progress integrity — no learning status, district or car change (REV-15, REV-16).
    const after = (await asUser(app, H).get("/api/progress")).body;
    expect(after.road).toEqual(before.road);
    expect(after.districts[0].subtopicsLearned).toBe(before.districts[0].subtopicsLearned);
    expect(after.revision).toMatchObject({ attempts: 1, successful: 1, distribution: [0, 0, 0, 1] });
    const topic = (await asUser(app, H).get("/api/topics/fe.ts")).body;
    expect(topic.status).toBe("IN_PROGRESS");
    expect(topic.plannedMinutes).toBe(600); // revision tasks never change the topic's plan
  });

  it("C: a score of 0 resets the sequence and waits for the correction before rescheduling", async () => {
    const id = await subId("fe.ts", 0);
    clock.date = "2026-11-26";
    await attempt("fe.ts", id, { score: 0 }).expect(400); // the gap must be named
    const r = await attempt("fe.ts", id, { score: 0, mistakes: "Couldn't explain generic constraints", correctionCompleted: false }).expect(201);
    expect(r.body).toMatchObject({ nextDueDate: null, correctionPending: true, nextTaskDate: null });
    const u = await unitOf("fe.ts", 0);
    expect(u.schedule).toMatchObject({ status: "AWAITING_CORRECTION", consecutiveSuccesses: 0, openTask: null });
    expect((await attempt("fe.ts", id, { score: 3 }).expect(409)).body.error.code).toBe("CORRECTION_REQUIRED");

    const c = await asUser(app, H).post(`/api/revision/attempts/${u.schedule!.pendingAttemptId}/correction`).send({}).expect(200);
    expect(c.body).toMatchObject({ correctionCompleted: true, nextDueDate: "2026-11-27", nextTaskDate: "2026-11-27" });
  });

  it("D: strong recall extends the interval and history keeps every attempt", async () => {
    const id = await subId("fe.ts", 0);
    clock.date = "2026-11-27";
    expect((await attempt("fe.ts", id, { score: 3 }).expect(201)).body).toMatchObject({ intervalDays: 7, nextDueDate: "2026-12-04" });
    clock.date = "2026-12-04";
    expect((await attempt("fe.ts", id, { score: 3 }).expect(201)).body).toMatchObject({ intervalDays: 14, nextDueDate: "2026-12-18" });
    const r = await revision("fe.ts");
    expect(r.attempts.map((a) => a.score)).toEqual([3, 3, 0, 3]);
    expect(r.units[1].schedule).toMatchObject({ consecutiveSuccesses: 2, attempts: 4 });
    // A 3 with notes counts as 2: no extension.
    clock.date = "2026-12-18";
    expect((await attempt("fe.ts", id, { score: 3, usedNotes: true }).expect(201)).body).toMatchObject({ effectiveScore: 2, intervalDays: 3 });
  });

  it("flags repeated failure as weak and reports it in progress", async () => {
    const id = await subId("fe.ts", 1);
    clock.date = "2026-12-01";
    await learn(id);
    clock.date = "2026-12-02";
    await attempt("fe.ts", id, { score: 1, mistakes: "Mixed up Partial and Pick", correctionCompleted: true }).expect(201);
    clock.date = "2026-12-03";
    await attempt("fe.ts", id, { score: 1, mistakes: "Still unsure about Record", correctionCompleted: true }).expect(201);
    const p = (await asUser(app, H).get("/api/progress")).body;
    expect(p.revision.weakUnits).toEqual([expect.objectContaining({ topicId: "fe.ts", subtopicId: id, consecutiveFailures: 2 })]);
    const task = (await asUser(app, H).get(`/api/tasks?from=2026-12-04&to=2026-12-10`)).body.find(
      (t: { revision: unknown; subtopic: { id: number } | null }) => t.revision && t.subtopic?.id === id,
    );
    expect(task.revision.weak).toBe(true);
  });

  it("creates a topic-level schedule once two sub-topics are learned (REV-03)", async () => {
    const u = (await revision("fe.ts")).units[0];
    // fe.ts became topic-eligible on 1 Dec (second learned sub-topic) → first due three days later.
    expect(u).toMatchObject({ scope: "TOPIC", eligible: true, schedule: { nextDueDate: "2026-12-04" } });
    expect(u.options[0].source).toBe("CURRICULUM");
  });

  it("E: a revision due on Sunday is optional there and placed on the next study day", async () => {
    clock.date = "2026-11-28"; // Saturday: learned today → due Sunday
    const id = await subId("fe.reactivity", 0);
    await learn(id);
    const u = await unitOf("fe.reactivity", 0);
    expect(u.schedule).toMatchObject({ nextDueDate: "2026-11-29", openTask: { scheduledDate: "2026-11-30" } });
    clock.date = "2026-11-29";
    const sunday = (await asUser(app, H).get("/api/today").expect(200)).body;
    expect(sunday).toMatchObject({ isRestDay: true, targetMinutes: 0 });
    expect(sunday.revision.optional.map((t: { id: number }) => t.id)).toContain(u.schedule!.openTask!.id);
    // Not attempting it on Sunday leaves it due; it shows as overdue on Monday's task.
    clock.date = "2026-11-30";
    const task = (await asUser(app, H).get(`/api/tasks/${u.schedule!.openTask!.id}`)).body;
    expect(task).toMatchObject({ scheduledDate: "2026-11-30", originalDate: "2026-11-29", revision: { overdueDays: 1 } });
  });

  it("F: many due revisions are spread within the daily allowance without touching learning tasks", async () => {
    clock.date = "2026-12-07"; // Monday
    const planBefore = await prisma.task.findMany({ where: { source: "PLAN" }, select: { id: true, scheduledDate: true, status: true }, orderBy: { id: "asc" } });
    for (const topicId of ["fe.forms", "fe.routing"]) {
      for (const s of await prisma.subtopic.findMany({ where: { topicId } })) await learn(s.id);
    }
    const tasks = (await asUser(app, H).get("/api/tasks?from=2026-12-07&to=2027-01-31")).body as {
      scheduledDate: string; estimatedMinutes: number; status: string; revision: unknown; originalDate: string; topic: { id: string } | null;
    }[];
    const rev = tasks.filter((t) => t.revision && t.status === "TODO" && ["fe.forms", "fe.routing"].includes(t.topic?.id ?? ""));
    expect(rev.length).toBe(7 + 2); // seven sub-topics plus two topic-level units
    const perDay = new Map<string, number>();
    for (const t of tasks.filter((x) => x.revision && x.status !== "SKIPPED")) perDay.set(t.scheduledDate, (perDay.get(t.scheduledDate) ?? 0) + t.estimatedMinutes);
    const learning = new Map<string, number>();
    for (const t of tasks.filter((x) => !x.revision && x.status !== "SKIPPED")) learning.set(t.scheduledDate, (learning.get(t.scheduledDate) ?? 0) + t.estimatedMinutes);
    for (const [d, m] of perDay) {
      expect(new Date(`${d}T12:00:00Z`).getUTCDay()).not.toBe(0); // never Sunday
      expect(m).toBeLessThanOrEqual(Math.max(30, 240 - (learning.get(d) ?? 0)));
    }
    for (const t of rev) expect(t.scheduledDate >= t.originalDate).toBe(true);
    const planAfter = await prisma.task.findMany({ where: { source: "PLAN" }, select: { id: true, scheduledDate: true, status: true }, orderBy: { id: "asc" } });
    expect(planAfter).toEqual(planBefore);
  });

  it("re-places overdue revisions on 'Move all forward' and keeps their due date", async () => {
    clock.date = "2026-12-09"; // revisions due 4 and 8 Dec were not attempted
    const bulk = await asUser(app, H).post("/api/tasks/reschedule-overdue").send({}).expect(200);
    const revMoves = [];
    for (const m of bulk.body.moved) {
      const t = (await asUser(app, H).get(`/api/tasks/${m.id}`)).body;
      if (t.revision) revMoves.push(t);
    }
    expect(revMoves.length).toBeGreaterThan(0);
    for (const t of revMoves) {
      expect(t.scheduledDate >= "2026-12-09").toBe(true);
      expect(t.originalDate < "2026-12-09").toBe(true);
      expect(t.revision.overdueDays).toBeGreaterThan(0);
    }
    expect((await asUser(app, H).get("/api/today")).body.carriedOver).toEqual([]);
  });

  it("suspends a unit whose sub-topic is unticked, and resumes it when ticked again", async () => {
    const id = await subId("fe.reactivity", 0);
    await learn(id, false);
    const u = await unitOf("fe.reactivity", 0);
    expect(u).toMatchObject({ eligible: false, schedule: { status: "SUSPENDED", openTask: null } });
    await learn(id, true);
    expect((await unitOf("fe.reactivity", 0)).schedule!.openTask).not.toBeNull();
  });

  it("manages learner prompts; curriculum prompts can only be switched off", async () => {
    const id = await subId("fe.ts", 2);
    const p = await asUser(app, H)
      .post("/api/prompts")
      .send({ topicId: "fe.ts", subtopicId: id, content: "How does narrowing work with `in`?", retrievalMethod: "WRITTEN", expectedAnswer: "Checks a property; TS narrows the union." })
      .expect(201);
    expect(p.body).toMatchObject({ source: "LEARNER", isActive: true });
    const u = await unitOf("fe.ts", 2);
    expect(u.options[0]).toMatchObject({ promptId: p.body.id, source: "LEARNER" });
    await asUser(app, H).patch(`/api/prompts/${p.body.id}`).send({ expectedAnswer: "in operator narrows" }).expect(200);

    const cur = (await revision("fe.ts")).prompts.find((x) => x.source === "CURRICULUM")!;
    expect((await asUser(app, H).patch(`/api/prompts/${cur.id}`).send({ content: "changed" }).expect(409)).body.error.code).toBe("PROMPT_READ_ONLY");
    await asUser(app, H).patch(`/api/prompts/${cur.id}`).send({ isActive: false }).expect(200);
    await asUser(app, H).patch(`/api/prompts/${cur.id}`).send({ isActive: true }).expect(200);
    await asUser(app, H).delete(`/api/prompts/${cur.id}`).expect(409);
    await asUser(app, H).delete(`/api/prompts/${p.body.id}`).expect(204);
    await asUser(app, H).post("/api/prompts").send({ topicId: "fe.ts", subtopicId: 999999, content: "Valid question?", retrievalMethod: "WRITTEN", expectedAnswer: "x" }).expect(404);
  });

  it("validates attempts and keeps the revision allowance configurable", async () => {
    const id = await subId("fe.ts", 0);
    await asUser(app, H).post("/api/revision/attempts").send({ topicId: "fe.ts", subtopicId: id, score: 4, retrievalMethod: "CONCEPTUAL", usedHints: false, usedNotes: false, templateKey: "explain" }).expect(400);
    await asUser(app, H).post("/api/revision/attempts").send({ topicId: "fe.ts", subtopicId: id, score: 2, retrievalMethod: "CONCEPTUAL", usedHints: false, usedNotes: false }).expect(400);
    await asUser(app, H).post("/api/revision/attempts").send({ topicId: "fe.ts", subtopicId: id, score: 2, retrievalMethod: "TELEPATHY", usedHints: false, usedNotes: false, templateKey: "explain" }).expect(400);
    const s = await asUser(app, H).patch("/api/settings").send({ revisionDailyMinutes: 45 }).expect(200);
    expect(s.body.revisionDailyMinutes).toBe(45);
    await asUser(app, H).patch("/api/settings").send({ revisionDailyMinutes: 300 }).expect(400);
    await asUser(app, H).patch("/api/settings").send({ revisionDailyMinutes: 30 }).expect(200);
  });

  it("refinement: explicit score, reschedule keeps the due date, one attempt per cycle, no reopening", async () => {
    clock.date = "2026-12-10";
    const id = await subId("fe.ui", 0);
    await learn(id);
    clock.date = "2026-12-11";
    // A score is mandatory and must be 0–3.
    await asUser(app, H).post("/api/revision/attempts").send({ topicId: "fe.ui", subtopicId: id, templateKey: "explain", retrievalMethod: "CONCEPTUAL", usedHints: false, usedNotes: false }).expect(400);
    await attempt("fe.ui", id, { score: -1 }).expect(400);
    await attempt("fe.ui", id, { score: 2.5 }).expect(400);

    const task = (await unitOf("fe.ui", 0)).schedule!.openTask!;
    const to = task.scheduledDate === "2026-12-16" ? "2026-12-17" : "2026-12-16";
    const moved = (await asUser(app, H).patch(`/api/tasks/${task.id}`).send({ scheduledDate: to }).expect(200)).body;
    expect(moved).toMatchObject({ originalDate: "2026-12-11", scheduledDate: to, rescheduleCount: 1 });
    clock.date = "2026-12-12";
    expect((await asUser(app, H).get(`/api/tasks/${task.id}`)).body.revision.overdueDays).toBe(1);

    // Double submission: the row lock serialises them and only one attempt is recorded for the day.
    const [r1, r2] = await Promise.all([attempt("fe.ui", id, { score: 3 }), attempt("fe.ui", id, { score: 3 })]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const sched = await prisma.revisionSchedule.findUniqueOrThrow({ where: { unit: `s:${id}` }, include: { attempts: true, tasks: true } });
    expect(sched.attempts).toHaveLength(1);
    expect(sched.attempts[0].taskId).toBe(task.id);
    expect(sched.tasks.filter((t) => t.status === "TODO")).toHaveLength(1);
    const done = (await asUser(app, H).get(`/api/tasks/${task.id}`)).body;
    expect(done).toMatchObject({ status: "DONE", scheduledDate: "2026-12-12", originalDate: "2026-12-11" }); // counted on the day it was done
    // A recorded revision cannot be reopened, ticked or skipped by hand.
    expect((await asUser(app, H).patch(`/api/tasks/${task.id}`).send({ status: "TODO" }).expect(409)).body.error.code).toBe("REVISION_RECORDED");
  });

  it("refinement: confirming a correction is not a successful retrieval, and history never changes", async () => {
    clock.date = "2026-12-12";
    const id = await subId("fe.ui", 1);
    await learn(id);
    clock.date = "2026-12-14";
    const r = await attempt("fe.ui", id, { score: 1, mistakes: "Forgot aria-expanded", correctionCompleted: false }).expect(201);
    const before = await prisma.revisionSchedule.findUniqueOrThrow({ where: { unit: `s:${id}` } });
    expect(before).toMatchObject({ consecutiveSuccesses: 0, consecutiveFailures: 1, correctionPending: true });
    await asUser(app, H).post(`/api/revision/attempts/${r.body.attempt.id}/correction`).send({}).expect(200);
    const after = await prisma.revisionSchedule.findUniqueOrThrow({ where: { unit: `s:${id}` } });
    expect(after).toMatchObject({ consecutiveSuccesses: 0, consecutiveFailures: 1, correctionPending: false, lastScore: 1 });
    const a = await prisma.revisionAttempt.findUniqueOrThrow({ where: { id: r.body.attempt.id } });
    expect(a).toMatchObject({ score: 1, effectiveScore: 1, correctionCompleted: true, mistakes: "Forgot aria-expanded" });
    expect(a.correctedAt).not.toBeNull();
    clock.date = "2026-12-15";
    expect((await attempt("fe.ui", id, { score: 3 }).expect(201)).body).toMatchObject({ intervalDays: 7 });
    expect((await prisma.revisionAttempt.findUniqueOrThrow({ where: { id: r.body.attempt.id } })).score).toBe(1);
    // Learning and demonstration are untouched.
    expect((await prisma.subtopic.findUniqueOrThrow({ where: { id } })).completedAt).not.toBeNull();
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: "fe.ui" } })).demonstratedAt).toBeNull();
  });

  it("refinement: titles follow the curriculum, Week shows revision workload and over-target time", async () => {
    clock.date = "2026-12-15";
    const id = await subId("fe.ui", 1);
    const open = await prisma.task.findFirstOrThrow({ where: { subtopicId: id, status: "TODO", source: "REVISION" } });
    const old = (await prisma.subtopic.findUniqueOrThrow({ where: { id } })).name;
    await prisma.subtopic.update({ where: { id }, data: { name: "Accessibility (renamed)" } });
    expect((await asUser(app, H).get(`/api/tasks/${open.id}`)).body.title).toBe("Revise: Accessibility (renamed)");
    await prisma.subtopic.update({ where: { id }, data: { name: old } });

    const w = (await asUser(app, H).get("/api/week?date=2026-12-14").expect(200)).body;
    for (const d of w.days) expect(d.overTargetMinutes).toBe(d.inJourney ? Math.max(0, d.plannedMinutes - d.targetMinutes) : 0);
    expect(w.revision.overTargetMinutes).toBe(w.days.reduce((a: number, d: { overTargetMinutes: number }) => a + d.overTargetMinutes, 0));
    expect(w.revision).toMatchObject({ dailyAllowanceMinutes: 30, weeklyOvertimeMinutes: 120 });
    expect(w.revision.overTargetMinutes).toBeLessThanOrEqual(120);
    expect(w.revision.upcomingMinutes).toBeGreaterThanOrEqual(0);
  });

  it("refinement: strict mode keeps every study day within its target", async () => {
    clock.date = "2026-12-15";
    await asUser(app, H).patch("/api/settings").send({ revisionDailyMinutes: 0, revisionWeeklyOvertimeMinutes: 0 }).expect(200);
    const id = await subId("fe.ui", 2);
    await learn(id);
    const t = await prisma.task.findFirstOrThrow({ where: { subtopicId: id, status: "TODO", source: "REVISION" } });
    const day = await prisma.task.findMany({ where: { scheduledDate: t.scheduledDate, status: { not: "SKIPPED" } } });
    expect(day.reduce((a, x) => a + x.estimatedMinutes, 0)).toBeLessThanOrEqual(240);
    await asUser(app, H).patch("/api/settings").send({ revisionDailyMinutes: 30, revisionWeeklyOvertimeMinutes: 120 }).expect(200);
  });

  it("serves the Revision section overview from the one schedule, read-only and prioritised", async () => {
    clock.date = "2026-12-09";
    const tasksBefore = await prisma.task.count();
    const o = (await asUser(app, H).get("/api/revision/overview").expect(200)).body;
    expect(await prisma.task.count()).toBe(tasksBefore); // reading never schedules anything

    type U = { scheduleId: number; nextDueDate: string | null; weak: boolean; correctionPending: boolean; topicId: string; status: string; pendingAttemptId: number | null };
    const ids = (xs: U[]) => xs.map((u) => u.scheduleId);
    expect(o.counts).toMatchObject({ overdue: o.overdue.length, due: o.due.length, upcoming: o.upcoming.length, weak: o.weak.length });
    expect(o.counts.active).toBe(await prisma.revisionSchedule.count({ where: { suspendedAt: null } }));
    for (const u of o.overdue as U[]) expect(u.nextDueDate! < "2026-12-09").toBe(true);
    for (const u of o.due as U[]) expect(u.nextDueDate).toBe("2026-12-09");
    for (const u of o.upcoming as U[]) expect(u.nextDueDate! > "2026-12-09" && u.nextDueDate! <= "2026-12-23").toBe(true);
    // Each unit appears in exactly one of overdue / due / upcoming.
    const all = [...ids(o.overdue), ...ids(o.due), ...ids(o.upcoming)];
    expect(new Set(all).size).toBe(all.length);
    // Overdue weak units come first.
    const firstNonWeak = (o.overdue as U[]).findIndex((u) => !u.weak);
    if (firstNonWeak >= 0) expect((o.overdue as U[]).slice(firstNonWeak).some((u) => u.weak)).toBe(false);
    expect((o.weak as U[]).map((u) => u.topicId)).toContain("fe.ts");
    // The session holds every due or overdue unit that is not blocked by a correction.
    expect(o.session).toHaveLength([...o.overdue, ...o.due].filter((u: U) => !u.correctionPending).length);
    for (const u of o.awaitingCorrection as U[]) expect(u.pendingAttemptId).not.toBeNull();
    // History: newest first, every attempt with its topic.
    expect(o.history.length).toBe(Math.min(50, await prisma.revisionAttempt.count()));
    const times = o.history.map((a: { attemptedAt: string }) => a.attemptedAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(o.history[0]).toHaveProperty("topicName");
    expect(o.checkpoints.length).toBeGreaterThan(0);
  });

  it("re-seeding keeps schedules, attempts and tasks (idempotent)", async () => {
    const counts = async () => ({
      tasks: await prisma.task.count(), schedules: await prisma.revisionSchedule.count(),
      attempts: await prisma.revisionAttempt.count(), prompts: await prisma.revisionPrompt.count(),
    });
    const before = await counts();
    await seed(prisma, () => {}, clock.date, { createEngineeringCity: true });
    expect(await counts()).toEqual(before);
    // The partial unique index enforces one open revision task per unit (REV-13).
    const open = await prisma.task.findFirstOrThrow({ where: { source: "REVISION", status: "TODO" } });
    await expect(
      prisma.task.create({ data: { ...open, id: undefined, createdAt: undefined, updatedAt: undefined } }),
    ).rejects.toThrow();
  });
});
