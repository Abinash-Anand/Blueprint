/**
 * API integration tests against a real PostgreSQL database (LLD §14).
 * Requires TEST_DATABASE_URL (a disposable database: it is wiped).
 *   docker run -d --name ec-test-db -e POSTGRES_USER=ec -e POSTGRES_PASSWORD=ec_test -e POSTGRES_DB=ec_test -p 127.0.0.1:55432:5432 postgres:17-alpine
 *   TEST_DATABASE_URL=postgresql://ec:ec_test@127.0.0.1:55432/ec_test npm run test:integration
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
// Each run gets its own fresh schema, migrated with the non-destructive `migrate deploy`,
// and only that schema is dropped afterwards.
const schema = `it_${Date.now()}`;
const url = base ? `${base}${base.includes("?") ? "&" : "?"}schema=${schema}` : "";

suite("Engineering City API", () => {
  let prisma: PrismaClient;
  const clock = new TestClock("2026-11-17");
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = new PrismaClient({ datasourceUrl: url });
    await seed(prisma, () => {}, "2026-11-17", { createEngineeringCity: true });
    Object.assign(H, (await signIn(prisma)).headers);
    app = createApp({ prisma, clock });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  it("reports health and the clock's date", async () => {
    const r = await asUser(app, H).get("/api/health").expect(200);
    expect(r.body).toEqual({ status: "ok", today: "2026-11-17" });
  });

  it("serves the full curriculum with seven districts", async () => {
    const r = await asUser(app, H).get("/api/curriculum").expect(200);
    expect(r.body.districts).toHaveLength(7);
    const ts = r.body.districts[0].topics[0];
    expect(ts).toMatchObject({ id: "fe.ts", priority: "CORE", status: "NOT_STARTED", estimatedHours: 10 });
    expect(ts.subtopics.length).toBeGreaterThan(0);
    expect(ts.resources.length).toBeGreaterThan(0);
    expect(r.body.stages.map((s: { id: string }) => s.id)).toContain("bedb");
  });

  it("is idempotent: re-seeding keeps the plan and progress", async () => {
    const before = await prisma.task.count({ where: { source: "PLAN" } });
    const prompts = await prisma.revisionPrompt.count();
    const sub = await prisma.subtopic.findFirstOrThrow({ where: { topicId: "fe.ts", position: 0 } });
    await prisma.subtopic.update({ where: { id: sub.id }, data: { completedAt: new Date("2026-11-17T12:00:00Z") } });
    await seed(prisma, () => {}, "2026-11-17", { createEngineeringCity: true });
    expect(await prisma.task.count({ where: { source: "PLAN" } })).toBe(before);
    expect(await prisma.revisionPrompt.count()).toBe(prompts);
    expect((await prisma.subtopic.findUniqueOrThrow({ where: { id: sub.id } })).completedAt).not.toBeNull();
    // The old revision systems are retired (docs/Recall-Plan.md §9): seeding plans no revision tasks.
    expect(await prisma.task.count({ where: { source: "REVISION" } })).toBe(0);
    await prisma.subtopic.update({ where: { id: sub.id }, data: { completedAt: null } });
  });

  it("shows today's mission: date, current topic, tasks and the 4-hour target", async () => {
    const r = await asUser(app, H).get("/api/today").expect(200);
    expect(r.body).toMatchObject({ date: "2026-11-17", weekday: 2, isRestDay: false, targetMinutes: 240, actualMinutes: 0 });
    expect(r.body.journey).toMatchObject({ day: 1, totalDays: 274, status: "ACTIVE" });
    expect(r.body.current).toEqual({ districtId: "fe", topicId: "fe.ts" });
    expect(r.body.tasks.length).toBeGreaterThan(0);
    expect(r.body.plannedMinutes).toBe(240);
    expect(r.body.carriedOver).toEqual([]);
  });

  it("treats Sunday as a rest day without tasks", async () => {
    const r = await asUser(app, H).get("/api/today?date=2026-11-22").expect(200);
    expect(r.body).toMatchObject({ isRestDay: true, targetMinutes: 0, tasks: [] });
  });

  it("completes a task without touching sub-topics or time, and can reopen it", async () => {
    const today = (await asUser(app, H).get("/api/today")).body;
    const task = today.tasks[0];
    const done = await asUser(app, H).patch(`/api/tasks/${task.id}`).send({ status: "DONE" }).expect(200);
    expect(done.body.status).toBe("DONE");
    expect(done.body.completedAt).not.toBeNull();
    expect(done.body.subtopic.completed).toBe(false); // BR-12
    expect(done.body.loggedMinutes).toBe(0);
    const again = await asUser(app, H).get("/api/today").expect(200);
    expect(again.body.doneMinutes).toBe(task.estimatedMinutes);
    await asUser(app, H).patch(`/api/tasks/${task.id}`).send({ status: "TODO" }).expect(200);
    await asUser(app, H).patch(`/api/tasks/${task.id}`).send({ status: "DONE" }).expect(200);
  });

  it("records study time on a task and shows it today and in the week", async () => {
    const task = (await asUser(app, H).get("/api/today")).body.tasks[0];
    const s = await asUser(app, H).post("/api/sessions").send({ date: "2026-11-17", minutes: 95, taskId: task.id }).expect(201);
    expect(s.body).toMatchObject({ minutes: 95, taskId: task.id, topicId: "fe.ts" });
    expect((await asUser(app, H).get("/api/today")).body.actualMinutes).toBe(95);
    const week = await asUser(app, H).get("/api/week").expect(200);
    expect(week.body.weekStart).toBe("2026-11-16");
    // Mon 16 Nov is before the journey starts, so the first week targets Tue–Sat only (5 × 4 h).
    expect(week.body.totals.targetMinutes).toBe(20 * 60);
    expect(week.body.days[0]).toMatchObject({ date: "2026-11-16", inJourney: false, targetMinutes: 0 });
    expect(week.body.totals.actualMinutes).toBe(95);
    expect(week.body.days.find((d: { date: string }) => d.date === "2026-11-17").actualMinutes).toBe(95);
    expect(week.body.days.find((d: { date: string }) => d.date === "2026-11-22")).toMatchObject({ isRestDay: true, targetMinutes: 0 });
  });

  it("rejects study time in the future and invalid minutes", async () => {
    await asUser(app, H).post("/api/sessions").send({ date: "2026-11-18", minutes: 30 }).expect(400);
    const r = await asUser(app, H).post("/api/sessions").send({ date: "2026-11-17", minutes: 0 }).expect(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
    await asUser(app, H).post("/api/sessions").send({ date: "2026-02-30", minutes: 10 }).expect(400);
  });

  it("validates task input and refuses to delete planned tasks", async () => {
    await asUser(app, H).patch("/api/tasks/999999").send({ status: "DONE" }).expect(404);
    await asUser(app, H).patch("/api/tasks/1").send({ status: "FINISHED" }).expect(400);
    await asUser(app, H).patch("/api/tasks/1").send({}).expect(400);
    await asUser(app, H).patch("/api/tasks/1").send({ unknown: 1 }).expect(400);
    const r = await asUser(app, H).delete("/api/tasks/1").expect(409);
    expect(r.body.error.code).toBe("PLAN_TASK_NOT_DELETABLE");
  });

  it("creates, edits and deletes a manual task", async () => {
    const c = await asUser(app, H)
      .post("/api/tasks")
      .send({ title: "  Review generics  ", scheduledDate: "2026-11-22", estimatedMinutes: 45, kind: "REVISION", topicId: "fe.ts" })
      .expect(201);
    expect(c.body).toMatchObject({ title: "Review generics", source: "MANUAL", originalDate: "2026-11-22", topic: { id: "fe.ts" } });
    const e = await asUser(app, H).patch(`/api/tasks/${c.body.id}`).send({ title: "Revise generics", estimatedMinutes: 60 }).expect(200);
    expect(e.body).toMatchObject({ title: "Revise generics", estimatedMinutes: 60 });
    await asUser(app, H).delete(`/api/tasks/${c.body.id}`).expect(204);
    await asUser(app, H).post("/api/tasks").send({ title: "x", scheduledDate: "2026-11-22", estimatedMinutes: 30, topicId: "zz.nope" }).expect(404);
  });

  it("re-plans missed work at the start of a new day, keeps the original date, and leaves hand-moved tasks alone", async () => {
    type T = { id: number; status: string; scheduledDate: string; originalDate: string; estimatedMinutes: number; pinned: boolean };
    const missed = ((await asUser(app, H).get("/api/tasks?from=2026-11-17&to=2026-11-18")).body as T[]).filter((x) => x.status === "TODO");
    expect(missed.length).toBeGreaterThan(0);
    clock.date = "2026-11-19"; // two days later; 17–18 Nov mostly unfinished
    // A server start plans recalls first; with no recall task coming or going, it leaves the missed work to the day's
    // own re-plan, which records what it moved.
    await (app.locals.recall as { planAll: () => Promise<number> }).planAll();
    expect((await prisma.task.count({ where: { id: { in: missed.map((m) => m.id) }, scheduledDate: { lt: new Date("2026-11-19T00:00:00Z") } } }))).toBe(missed.length);

    // The first request of the day re-plans: nothing is left carried over, and every missed task keeps its original date.
    expect((await asUser(app, H).get("/api/today")).body.carriedOver).toEqual([]);
    const ahead = (await asUser(app, H).get("/api/tasks?from=2026-11-19&to=2026-12-31")).body as T[];
    const moved = ahead.filter((x) => missed.some((m) => m.id === x.id));
    expect(moved).toHaveLength(missed.length);
    for (const x of moved) expect([x.scheduledDate >= "2026-11-19", x.originalDate <= "2026-11-18"]).toEqual([true, true]);
    // No study day is overfilled and nothing lands on Sunday.
    const load = new Map<string, number>();
    for (const x of ahead) if (x.status !== "SKIPPED") load.set(x.scheduledDate, (load.get(x.scheduledDate) ?? 0) + x.estimatedMinutes);
    expect(Math.max(...load.values())).toBeLessThanOrEqual(240);
    expect(load.has("2026-11-22") || load.has("2026-11-29")).toBe(false);
    // The change is recorded, once a day: a second request re-plans nothing.
    const changes = (await asUser(app, H).get("/api/schedule/plan-changes").expect(200)).body;
    expect(changes[0]).toMatchObject({ reason: "DAILY" });
    expect(changes[0].moved).toBeGreaterThanOrEqual(missed.length);
    await asUser(app, H).get("/api/today").expect(200);
    expect((await asUser(app, H).get("/api/schedule/plan-changes")).body).toHaveLength(changes.length);

    // A task moved by hand is pinned, even onto a rest day, and re-planning leaves it there.
    const first = moved[0];
    const pinned = await asUser(app, H).patch(`/api/tasks/${first.id}`).send({ scheduledDate: "2026-11-29" }).expect(200);
    expect(pinned.body).toMatchObject({ scheduledDate: "2026-11-29", originalDate: first.originalDate, status: "TODO", pinned: true });
    const bulk = await asUser(app, H).post("/api/tasks/reschedule-overdue").send({}).expect(200);
    expect(bulk.body.moved.map((m: { id: number }) => m.id)).not.toContain(first.id);
    const at = async () => ((await asUser(app, H).get("/api/tasks?from=2026-11-19&to=2026-12-31")).body as T[]).find((x) => x.id === first.id)!;
    expect((await at()).scheduledDate).toBe("2026-11-29");
    // Unpinned, it goes back to its place in the plan.
    expect((await asUser(app, H).patch(`/api/tasks/${first.id}`).send({ pinned: false }).expect(200)).body.pinned).toBe(false);
    await asUser(app, H).post("/api/tasks/reschedule-overdue").send({}).expect(200);
    expect((await at()).scheduledDate).toBe(first.scheduledDate);
    clock.date = "2026-11-17";
  });

  it("moves the car with core learning, but only demonstration passes the checkpoint", async () => {
    const p0 = (await asUser(app, H).get("/api/progress")).body;
    expect(p0.road).toMatchObject({ currentDistrictIndex: 0, districtFraction: 0, overall: 0 });

    const cur = (await asUser(app, H).get("/api/curriculum")).body;
    const fe = cur.districts[0];
    // Learn every sub-topic of every frontend topic.
    for (const topic of fe.topics) for (const s of topic.subtopics) await asUser(app, H).patch(`/api/subtopics/${s.id}`).send({ completed: true }).expect(200);
    const p1 = (await asUser(app, H).get("/api/progress")).body;
    expect(p1.road.currentDistrictIndex).toBe(0);
    expect(p1.road.districtFraction).toBeCloseTo(0.8);
    expect(p1.districts[0]).toMatchObject({ passed: false, coreDemonstrated: 0 });

    // Demonstrate every core topic → checkpoint passed, car moves to Backend.
    for (const topic of fe.topics.filter((t: { priority: string }) => t.priority === "CORE")) {
      const r = await asUser(app, H).patch(`/api/topics/${topic.id}`).send({ demonstrated: true, demonstrationNote: "repo link" }).expect(200);
      expect(r.body.status).toBe("DEMONSTRATED");
    }
    const p2 = (await asUser(app, H).get("/api/progress")).body;
    expect(p2.districts[0].passed).toBe(true);
    expect(p2.road.currentDistrictIndex).toBe(1);
    expect(p2.road.overall).toBeCloseTo(1 / 7);
    expect(p2.core.demonstrated).toBe(fe.topics.filter((t: { priority: string }) => t.priority === "CORE").length);

    // Un-demonstrating one topic moves the car back (state is never sticky).
    await asUser(app, H).patch(`/api/topics/fe.ts`).send({ demonstrated: false }).expect(200);
    expect((await asUser(app, H).get("/api/progress")).body.road.currentDistrictIndex).toBe(0);
  });

  it("never completes a stage just because its deadline passed (FR-CAL-05, FR-CAR-04)", async () => {
    clock.date = "2027-01-05";
    const p = (await asUser(app, H).get("/api/progress")).body;
    const fe = p.stages.find((s: { id: string }) => s.id === "fe");
    expect(fe.status).toBe("DELAYED");
    expect(fe.delayDays).toBe(5);
    expect(fe.tasksDone).toBeLessThan(fe.tasksTotal);
    expect(p.road.currentDistrictIndex).toBe(0);
    const bedb = p.stages.find((s: { id: string }) => s.id === "bedb");
    expect(["BEHIND", "ON_TRACK"]).toContain(bedb.status);
    expect(p.stages.find((s: { id: string }) => s.id === "cl").status).toBe("UPCOMING");
    clock.date = "2026-11-17";
  });

  it("reports progress hours and series", async () => {
    const p = (await asUser(app, H).get("/api/progress")).body;
    expect(p.hours.actualTotal).toBe(95);
    expect(p.hours.plannedTotal).toBeGreaterThan(600 * 60);
    expect(p.weekly[0]).toMatchObject({ weekStart: "2026-11-16", actualMinutes: 95 });
    expect(p.monthly.map((m: { month: string }) => m.month)).toEqual([
      "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08",
    ]);
    expect(p.practice.total).toBeGreaterThan(50);
  });

  it("edits stage dates within the journey and weekday targets", async () => {
    await asUser(app, H).patch("/api/stages/fe").send({ endDate: "2027-01-10" }).expect(200);
    await asUser(app, H).patch("/api/stages/fe").send({ endDate: "2026-11-01" }).expect(400);
    await asUser(app, H).patch("/api/stages/fe").send({ endDate: "2028-01-01" }).expect(400);
    await asUser(app, H).patch("/api/stages/fe").send({ endDate: "2026-12-31" }).expect(200);
    const s = await asUser(app, H).patch("/api/settings").send({ weeklyTargets: [{ weekday: 7, targetMinutes: 60 }] }).expect(200);
    expect(s.body.weeklyTargets.find((t: { weekday: number }) => t.weekday === 7).targetMinutes).toBe(60);
    await asUser(app, H).patch("/api/settings").send({ weeklyTargets: [{ weekday: 7, targetMinutes: 0 }] }).expect(200);
    await asUser(app, H).patch("/api/settings").send({ weeklyTargets: [{ weekday: 8, targetMinutes: 0 }] }).expect(400);
  });

  it("returns structured errors for unknown routes and malformed JSON", async () => {
    const r = await asUser(app, H).get("/api/nope").expect(404);
    expect(r.body.error.code).toBe("ROUTE_NOT_FOUND");
    const j = await asUser(app, H).patch("/api/tasks/1").set("Content-Type", "application/json").send("{bad").expect(400);
    expect(j.body.error.code).toBe("INVALID_JSON");
  });

  it("describes your time, previews a change without saving anything, and saves exactly what it previewed", async () => {
    const now = (await asUser(app, H).get("/api/schedule/availability").expect(200)).body;
    // The built-in city plans all its hours as new material: no preset matches, so its split shows as "Current".
    expect(now).toMatchObject({ minutesPerDay: 240, pace: "CURRENT", share: 1, uniform: true, targetDate: null, timezone: "Europe/Berlin" });
    const choice = { minutesPerDay: now.minutesPerDay, studyDays: now.studyDays, pace: now.pace };
    expect((await asUser(app, H).post("/api/schedule/preview").send(choice).expect(200)).body).toMatchObject({ unchanged: true, moved: 0 });

    const dates = async () => (await prisma.task.findMany({ where: { cityId: "engineering" }, select: { id: true, scheduledDate: true }, orderBy: { id: "asc" } })).map((t) => `${t.id}:${t.scheduledDate.toISOString()}`);
    const weekRows = async () => prisma.weeklyTarget.findMany({ where: { cityId: "engineering" }, orderBy: { weekday: "asc" } });
    const changes = async () => (await asUser(app, H).get("/api/schedule/plan-changes")).body.length;
    const [d0, w0, c0] = [await dates(), await weekRows(), await changes()];

    // An hour less a day at a Steady pace: later, with revision time, and some tasks move.
    const less = { ...choice, minutesPerDay: 180, pace: "STEADY" };
    const p = (await asUser(app, H).post("/api/schedule/preview").send(less).expect(200)).body;
    expect(p.finish.after > p.finish.before).toBe(true);
    expect(p.moved).toBeGreaterThan(0);
    expect(p.split.revision).toBeGreaterThan(0);
    expect(p.week["1"]).toEqual({ available: 180, newTarget: 135 });
    expect(p.unchanged).toBe(false);
    // The preview wrote nothing.
    expect([await dates(), await weekRows(), await changes()]).toEqual([d0, w0, c0]);

    // Saved: the week is stored and the plan moves exactly as previewed.
    const open = () => prisma.task.findMany({ where: { cityId: "engineering", status: "TODO", kind: { not: "REVISION" } }, orderBy: [{ originalDate: "asc" }, { position: "asc" }, { id: "asc" }] });
    const before = await open();
    const saved = (await asUser(app, H).put("/api/schedule/availability").send(less).expect(200)).body;
    // Tasks sized for 4-hour days are split to fill 135 minutes: nothing is lost, and the plan's order holds.
    const afterSave = await open();
    expect(afterSave.reduce((a, t) => a + t.estimatedMinutes, 0)).toBe(before.reduce((a, t) => a + t.estimatedMinutes, 0));
    const cont = (xs: { title: string }[]) => xs.filter((t) => t.title.endsWith("(continued)")).length;
    expect(cont(afterSave) - cont(before)).toBe(afterSave.length - before.length); // every new task is a continuation
    expect(p.splitTasks).toBeGreaterThan(0);
    for (const stageId of new Set(afterSave.map((t) => t.stageId))) {
      const line = afterSave.filter((t) => t.stageId === stageId && t.scheduledDate >= new Date("2026-11-18T00:00:00Z")).map((t) => t.scheduledDate.toISOString());
      for (let i = 1; i < line.length; i++) expect(line[i] >= line[i - 1]).toBe(true);
    }
    expect(saved).toMatchObject({ minutesPerDay: 180, pace: "STEADY" });
    const pc = (await asUser(app, H).get("/api/schedule/plan-changes")).body[0];
    expect(pc).toMatchObject({ reason: "AVAILABILITY", moved: p.moved, finishAfter: p.finish.after });
    expect((await asUser(app, H).post("/api/schedule/preview").send(less).expect(200)).body).toMatchObject({ unchanged: true, moved: 0 });

    // A target date is checked, never moves the plan, and can be cleared; a time zone must exist.
    const target = (await asUser(app, H).post("/api/schedule/preview").send({ ...less, targetDate: "2027-03-01" }).expect(200)).body;
    expect(target.target).toMatchObject({ date: "2027-03-01", meets: false });
    expect(target.target.neededNewMinutesPerWeek).toBeGreaterThan(0);
    expect(target.moved).toBe(0);
    await asUser(app, H).put("/api/schedule/availability").send({ ...less, targetDate: "2027-03-01" }).expect(200);
    expect((await asUser(app, H).get("/api/schedule/availability")).body.targetDate).toBe("2027-03-01");
    await asUser(app, H).put("/api/schedule/availability").send({ ...less, targetDate: null }).expect(200);
    expect((await asUser(app, H).get("/api/schedule/availability")).body.targetDate).toBeNull();
    await asUser(app, H).post("/api/schedule/preview").send({ ...less, targetDate: "2026-11-01" }).expect(400);
    await asUser(app, H).post("/api/schedule/preview").send({ ...less, timezone: "Mars/Olympus" }).expect(400);
    await asUser(app, H).post("/api/schedule/preview").send({ ...less, minutesPerDay: 100 }).expect(400); // not in 15-minute steps
    await asUser(app, H).post("/api/schedule/preview").send({ ...less, studyDays: [] }).expect(400);
    await asUser(app, H).put("/api/schedule/availability").send({ ...less, timezone: "Asia/Kolkata" }).expect(200);
    expect((await asUser(app, H).get("/api/schedule/availability")).body.timezone).toBe("Asia/Kolkata");
  });
});
