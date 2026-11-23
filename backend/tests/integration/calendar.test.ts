/**
 * Google Calendar sync end to end (docs/Google-Calendar-MVP-Plan.md) on a real database with the fake Google: connect
 * (OAuth state checked), study blocks written for 14 days and never twice, changes pushed, the learner's moves in
 * Google pulled back (a new time kept, another day moves the tasks, a deletion hides the block), echoes dropped,
 * 410 and 412 handled, backoff then a pause, webhooks checked, and disconnecting.
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../prisma/seed.js";
import { createApp } from "../../src/app.js";
import { loadAuthConfig } from "../../src/config.js";
import { d2i } from "../../src/db.js";
import { addDays } from "../../src/domain/dates.js";
import { TestClock } from "../../src/lib/clock.js";
import { memoryMailer } from "../../src/modules/auth/mailer.js";
import { decrypt } from "../../src/modules/calendar/crypto.js";
import { type FakeGoogle, fakeGoogle } from "../../src/modules/calendar/fakeGoogle.js";
import type { CalendarConfig } from "../../src/modules/calendar/google.js";
import { type CalendarService, MAX_ATTEMPTS } from "../../src/modules/calendar/service.js";
import { asUser, signIn } from "../helpers/auth.js";

const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const schema = `it_calendar_${Date.now()}`;
const url = base ? `${base}${base.includes("?") ? "&" : "?"}schema=${schema}` : "";

suite("google calendar", () => {
  let prisma: PrismaClient;
  const clock = new TestClock("2026-11-20");
  let wall = new Date("2026-11-20T12:00:00Z");
  const later = (ms: number) => { wall = new Date(wall.getTime() + ms); };
  const google: FakeGoogle = fakeGoogle();
  const config: CalendarConfig = {
    enabled: true, fake: true, key: Buffer.alloc(32, 1), appUrl: "https://bp.example", redirectUri: "http://localhost/api/calendar/google/callback",
    webhookUrl: "https://bp.example/api/calendar/google/webhook", windowDays: 14, pollMinutes: 15,
  };
  let app: ReturnType<typeof createApp>;
  let calendar: CalendarService;
  const H: Record<string, string> = {};
  let userId = "";
  const conn = () => prisma.googleConnection.findUniqueOrThrow({ where: { userId } });
  const calId = async () => (await conn()).calendarId!;
  const ofKind = async (kind: "STUDY" | "RECALL") => new Map(google.events(await calId()).filter((e) => e.extendedProperties!.private!.bpKind === kind).map((e) => [e.extendedProperties!.private!.bpDay, e]));
  const byDay = () => ofKind("STUDY");

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = new PrismaClient({ datasourceUrl: url });
    await seed(prisma, () => {}, clock.date, { createEngineeringCity: true });
    app = createApp({ prisma, clock, authConfig: loadAuthConfig({ MAIL_TRANSPORT: "file" }), mailer: memoryMailer(), calendar: { config, google, now: () => wall } });
    calendar = app.locals.calendar as CalendarService;
    const s = await signIn(prisma);
    Object.assign(H, s.headers);
    userId = s.user.id;
  }, 120_000);
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  it("is off on a server without Google settings", async () => {
    const off = createApp({ prisma, clock, authConfig: loadAuthConfig({ MAIL_TRANSPORT: "file" }), mailer: memoryMailer() });
    expect((await asUser(off, H).get("/api/calendar").expect(200)).body).toMatchObject({ configured: false, connected: false });
    await asUser(off, H).get("/api/calendar/google/connect").expect(503);
  });

  it("connects only when Google's answer comes back to the browser that asked, and keeps the tokens encrypted", async () => {
    const go = await asUser(app, H).get("/api/calendar/google/connect").expect(302);
    const to = new URL(go.headers.location);
    const cookie = String(go.headers["set-cookie"]).split(";")[0];
    expect(cookie).toMatch(/^bp_gstate=.+/);
    const callback = `/api/calendar/google/callback${to.search}`;
    // Without the state cookie (another site starting the flow), nothing is connected.
    expect((await asUser(app, H).get(callback).expect(302)).headers.location).toBe("/#/calendar?error=state");
    expect(await prisma.googleConnection.count()).toBe(0);
    const done = await asUser(app, { ...H, Cookie: `${H.Cookie}; ${cookie}` }).get(callback).expect(302);
    expect(done.headers.location).toBe("/#/calendar?connected=1");
    const c = await conn();
    expect(c.refreshToken).not.toMatch(/^rt-/);
    expect(decrypt(config.key!, c.refreshToken)).toMatch(/^rt-/);
    expect((await asUser(app, H).get("/api/calendar").expect(200)).body).toMatchObject({ configured: true, connected: true, status: "ACTIVE", startTime: "18:00", instant: true });
  });

  it("writes one block per study day for the next 14 days, at the start time, and never writes an unchanged block again", async () => {
    await calendar.runDue();
    const days = await byDay();
    const planned = await prisma.task.groupBy({ by: ["scheduledDate"], where: { cityId: "engineering", recallStateId: null, status: { in: ["TODO", "DONE"] }, scheduledDate: { gte: new Date("2026-11-20"), lte: new Date(addDays("2026-11-20", 13)) } } });
    expect(days.size).toBe(planned.length);
    expect(days.size).toBeGreaterThan(5);
    const first = [...days.values()][0];
    expect(first.summary).toMatch(/^Engineering City · Study · (\d+ h( \d+ min)?|\d+ min)$/);
    expect(first.colorId).toBe("7");
    expect(first.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 10 }] });
    expect(first.description).toContain("Open in Blueprint: https://bp.example/#/today?city=engineering");
    expect(first.start!.dateTime).toMatch(/T18:00:00$/);
    expect(first.start!.timeZone).toBe("Europe/Berlin");
    expect(first.extendedProperties!.private).toMatchObject({ bp: "1", bpCity: "engineering", bpKind: "STUDY" });
    expect(first.description).toMatch(/Planned by Blueprint/);
    expect(google.calendars.get(await calId())!.summary).toBe("Blueprint");
    // Nothing changed: no call to Google at all.
    const before = google.calls.length;
    expect(await calendar.push(userId)).toBe(0);
    expect(google.calls.length).toBe(before);
  });

  it("brings the changed blocks up to date after a change in Blueprint, and only those", async () => {
    const t = await prisma.task.findFirstOrThrow({ where: { cityId: "engineering", status: "TODO", scheduledDate: { gte: new Date("2026-11-21") } }, orderBy: { scheduledDate: "asc" } });
    await asUser(app, H).patch(`/api/tasks/${t.id}`).send({ estimatedMinutes: t.estimatedMinutes + 15 }).expect(200);
    // The push is asked for once the response is sent, a little later (merged with any changes that follow).
    for (let i = 0; i < 50 && !(await prisma.calendarJob.count({ where: { userId, kind: "PUSH" } })); i++) await new Promise((ok) => setTimeout(ok, 20));
    expect((await prisma.calendarJob.findFirstOrThrow({ where: { userId, kind: "PUSH" } })).runAt.getTime()).toBeGreaterThan(wall.getTime());
    later(11_000);
    const before = google.calls.filter((c) => c === "patchEvent").length;
    await calendar.runDue();
    // Longer work re-plans the city, so later days change too; each changed day is written once.
    const writes = google.calls.filter((c) => c === "patchEvent" || c === "insertEvent" || c === "deleteEvent").length;
    expect(google.calls.filter((c) => c === "patchEvent").length).toBeGreaterThan(before);
    expect(writes).toBeLessThanOrEqual(before + 14 * 2);
    const now = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect((await byDay()).get(d2i(now.scheduledDate))!.description).toContain(`${t.title} · `);
    expect(await calendar.push(userId)).toBe(0);
  });

  it("keeps a new time chosen in Google, and drops its own writes when they come back", async () => {
    const days = await byDay();
    const [day, ev] = [...days.entries()][1];
    google.userMove(await calId(), ev.id, `${day}T07:30:00`, `${day}T08:00:00`);
    expect(await calendar.pull(userId)).toBe(1);
    expect((await prisma.calendarEvent.findFirstOrThrow({ where: { googleEventId: ev.id } })).startMinute).toBe(450);
    // The planned length is written back, at the learner's time.
    await calendar.runDue();
    const moved = (await byDay()).get(day)!;
    expect(moved.start!.dateTime).toBe(`${day}T07:30:00`);
    expect(moved.end!.dateTime).not.toBe(`${day}T08:00:00`);
    // Our own write comes back with the etag we stored: nothing to do.
    expect(await calendar.pull(userId)).toBe(0);
  });

  it("moves a day's open tasks when its block is dragged to another day, pinned there", async () => {
    const days = await byDay();
    const from = [...days.keys()].sort()[3];
    const to = addDays(from, 1);
    const ev = days.get(from)!;
    const open = await prisma.task.findMany({ where: { cityId: "engineering", scheduledDate: new Date(from), status: "TODO", recallStateId: null }, select: { id: true } });
    expect(open.length).toBeGreaterThan(0);
    google.userMove(await calId(), ev.id, `${to}T18:00:00`, `${to}T19:00:00`);
    await calendar.pull(userId);
    const after = await prisma.task.findMany({ where: { id: { in: open.map((t) => t.id) } } });
    expect(after.every((t) => d2i(t.scheduledDate) === to && t.pinnedAt !== null)).toBe(true);
    await calendar.runDue();
    expect((await byDay()).get(to)!.description).toContain("Planned by Blueprint");
  });

  it("gives recall its own event before the study block, each sub-topic with a link that opens it", async () => {
    const sub = await prisma.subtopic.findFirstOrThrow({ where: { topic: { cityId: "engineering" }, completedAt: null }, orderBy: { id: "asc" } });
    await asUser(app, H).patch(`/api/subtopics/${sub.id}`).send({ completed: true }).expect(200);
    const task = await prisma.task.findFirstOrThrow({ where: { subtopicId: sub.id, recallStateId: { not: null }, status: "TODO" } });
    const day = d2i(task.scheduledDate);
    // An earlier test moved a study block by hand; this day is laid out by Blueprint.
    await prisma.calendarEvent.updateMany({ where: { userId, day: new Date(day) }, data: { startMinute: null } });
    await calendar.push(userId);
    const recall = (await ofKind("RECALL")).get(day)!;
    expect(recall.summary).toBe("Engineering City · Recall · 1 sub-topic");
    expect(recall.colorId).toBe("3");
    expect(recall.description).toContain(`1. ${sub.name} (`);
    expect(recall.description).toContain("first recall");
    expect(recall.description).toContain(`https://bp.example/#/recall/${sub.id}?city=engineering`);
    // Recall first, then study right after it: nothing overlaps.
    const study = (await byDay()).get(day);
    if (study) {
      expect(recall.start!.dateTime! < study.start!.dateTime!).toBe(true);
      expect(study.start!.dateTime).toBe(recall.end!.dateTime);
    }
    expect(study?.description ?? "").not.toContain("Recall:");
  });

  it("marks a finished block with ✓ and grey, and follows the reminder setting", async () => {
    const days = await byDay();
    const day = [...days.keys()].sort()[0];
    await prisma.task.updateMany({ where: { cityId: "engineering", scheduledDate: new Date(day), recallStateId: null }, data: { status: "DONE", completedAt: new Date() } });
    await asUser(app, H).put("/api/calendar").send({ reminderMinutes: 0 }).expect(200);
    await calendar.push(userId);
    const done = (await byDay()).get(day)!;
    expect(done.summary).toMatch(/^✓ Engineering City · Study/);
    expect(done.colorId).toBe("8");
    expect(done.reminders).toEqual({ useDefault: false, overrides: [] });
    await asUser(app, H).put("/api/calendar").send({ reminderMinutes: 10 }).expect(200);
    await asUser(app, H).put("/api/calendar").send({ reminderMinutes: 7 }).expect(400);
    expect((await asUser(app, H).get("/api/calendar").expect(200)).body).toMatchObject({ reminderMinutes: 10, cities: [{ id: "engineering", name: "Engineering City" }] });
  });

  it("leaves work finished ahead (a sub-topic ticked learned) out of today's block", async () => {
    const today = clock.date;
    const ahead = await prisma.task.findFirstOrThrow({ where: { cityId: "engineering", recallStateId: null, status: "TODO", scheduledDate: { gt: new Date(addDays(today, 2)) } } });
    await prisma.task.update({ where: { id: ahead.id }, data: { status: "DONE", completedAt: new Date(), scheduledDate: new Date(today) } });
    await calendar.push(userId);
    expect((await byDay()).get(today)?.description ?? "").not.toContain(`${ahead.title} · `);
  });

  it("never takes a block from before the update as moved by the learner, and puts each city in its own study time", async () => {
    // A row from before richer events: Blueprint doesn't know where it put it.
    const row = await prisma.calendarEvent.findFirstOrThrow({ where: { userId, kind: "STUDY", googleEventId: { not: null } }, orderBy: { day: "desc" } });
    await prisma.calendarEvent.update({ where: { id: row.id }, data: { placedMinute: null, etag: "old" } });
    await calendar.pull(userId);
    expect((await prisma.calendarEvent.findUniqueOrThrow({ where: { id: row.id } })).startMinute).toBeNull();
    // Study from 09:00, saved on Your time: the blocks move there.
    const now = (await asUser(app, H).get("/api/schedule/availability").expect(200)).body;
    const saved = await asUser(app, H).put("/api/schedule/availability")
      .send({ minutesPerDay: now.minutesPerDay, studyDays: now.studyDays, pace: now.pace, studyStart: "09:00" }).expect(200);
    expect(saved.body).toMatchObject({ studyStart: "09:00", slot: { start: "09:00", clashes: [] } });
    await prisma.calendarEvent.updateMany({ where: { userId }, data: { startMinute: null } });
    await calendar.push(userId);
    const days = [...(await byDay()).values()];
    expect(days.length).toBeGreaterThan(3);
    expect(days.some((e) => e.start!.dateTime!.endsWith("T09:00:00"))).toBe(true);
    expect((await asUser(app, H).get("/api/calendar").expect(200)).body.cities).toEqual([{ id: "engineering", name: "Engineering City", start: "09:00" }]);
    // Back to no set time (the default start), so the next tests see the calendar's own start time.
    await prisma.settings.updateMany({ where: { cityId: "engineering" }, data: { studyStartMinute: null } });
    // The save also asked for a push (a few seconds later): let it run, so the next tests start clean.
    later(20_000);
    await calendar.runDue();
  });

  it("hides a block deleted in Google and doesn't write it again; the plan doesn't change", async () => {
    const days = await byDay();
    const [day, ev] = [...days.entries()].sort()[6];
    const tasks = await prisma.task.count({ where: { cityId: "engineering", scheduledDate: new Date(day) } });
    google.userDelete(await calId(), ev.id);
    await calendar.pull(userId);
    await calendar.runDue();
    expect((await byDay()).has(day)).toBe(false);
    expect((await prisma.calendarEvent.findFirstOrThrow({ where: { userId, day: new Date(day) } })).hidden).toBe(true);
    expect(await prisma.task.count({ where: { cityId: "engineering", scheduledDate: new Date(day) } })).toBe(tasks);
  });

  it("reads everything again when Google says the sync token is too old (410)", async () => {
    google.expireSyncTokens(await calId());
    const before = google.calls.filter((c) => c === "listEvents").length;
    await calendar.pull(userId);
    expect(google.calls.filter((c) => c === "listEvents").length).toBe(before + 2);
    expect((await conn()).syncToken).not.toBeNull();
  });

  it("keeps the learner's time when the block changed in Google since the last read (412)", async () => {
    const days = await byDay();
    const [day, ev] = [...days.entries()].sort()[2];
    google.userMove(await calId(), ev.id, `${day}T06:00:00`, `${day}T06:30:00`);
    // A change in Blueprint before Blueprint has read Google: the write carries the old etag.
    const t = await prisma.task.findFirstOrThrow({ where: { cityId: "engineering", scheduledDate: new Date(day), status: "TODO" } });
    await prisma.task.update({ where: { id: t.id }, data: { estimatedMinutes: t.estimatedMinutes + 30 } });
    await calendar.push(userId);
    expect(google.calls.slice(-3)).toEqual(["patchEvent", "getEvent", "patchEvent"]);
    expect((await byDay()).get(day)!.start!.dateTime).toBe(`${day}T06:00:00`);
  });

  it("backs off after failures, pauses after too many, and starts again on Retry", async () => {
    await asUser(app, H).put("/api/calendar").send({ startTime: "19:15" }).expect(200);
    google.failNext("*", 500, MAX_ATTEMPTS);
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await calendar.runDue();
      const job = await prisma.calendarJob.findFirstOrThrow({ where: { userId, kind: "PUSH" } });
      expect(job.attempts).toBe(i);
      expect(job.runAt.getTime()).toBeGreaterThan(wall.getTime());
      later(2 * 3600_000);
    }
    await calendar.runDue();
    expect((await asUser(app, H).get("/api/calendar").expect(200)).body).toMatchObject({ status: "PAUSED", lastError: expect.stringMatching(/500/) });
    await asUser(app, H).post("/api/calendar/sync").expect(200);
    await calendar.runDue();
    expect((await conn()).status).toBe("ACTIVE");
    expect([...(await byDay()).values()].some((e) => e.start!.dateTime!.endsWith("T19:15:00"))).toBe(true);
  });

  it("accepts Google's notifications only from its own channel, and reads Google when one arrives", async () => {
    later(6_000);
    await calendar.runDue();
    const ch = await prisma.calendarChannel.findFirstOrThrow({ where: { userId } });
    expect(google.channels.get(ch.id)!.address).toBe(config.webhookUrl);
    const hook = (token: string) => asUser(app, {}).post("/api/calendar/google/webhook")
      .set("X-Goog-Channel-ID", ch.id).set("X-Goog-Resource-ID", ch.resourceId).set("X-Goog-Channel-Token", token).set("X-Goog-Resource-State", "exists");
    await hook("wrong").expect(404);
    expect(await prisma.calendarJob.count({ where: { userId, kind: "PULL" } })).toBe(0);
    await hook(ch.token).expect(200);
    expect(await prisma.calendarJob.count({ where: { userId, kind: "PULL" } })).toBe(1);
    await calendar.runDue();
  });

  it("asks to connect again when Google refuses the token", async () => {
    google.failNext("listEvents", 401);
    await calendar.enqueue(userId, "PULL");
    await calendar.runDue();
    expect((await conn()).status).toBe("RECONNECT");
    await asUser(app, H).post("/api/calendar/sync").expect(409);
    await prisma.googleConnection.update({ where: { userId }, data: { status: "ACTIVE", lastError: null } });
  });

  it("disconnects: access revoked, the Blueprint calendar removed when asked, nothing left here", async () => {
    const id = await calId();
    await asUser(app, H).delete("/api/calendar").send({ removeCalendar: true }).expect(204);
    expect(google.calendars.has(id)).toBe(false);
    expect(google.revoked).toHaveLength(1);
    expect(google.channels.size).toBe(0);
    expect(await prisma.googleConnection.count()).toBe(0);
    expect(await prisma.calendarEvent.count()).toBe(0);
    expect((await asUser(app, H).get("/api/calendar").expect(200)).body).toMatchObject({ configured: true, connected: false });
  });
});
