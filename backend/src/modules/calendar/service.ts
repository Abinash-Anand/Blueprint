/**
 * Google Calendar sync (docs/Google-Calendar-MVP-Plan.md). Pages never wait on Google: requests only read and write
 * the local tables and enqueue jobs; a worker in this process runs the jobs with backoff.
 *
 * - PUSH (Blueprint → Google): one block per city and study day for the next 14 days; only blocks whose content
 *   changed are written (hash), with If-Match on the etag; a 412 adopts the time the learner chose in Google.
 * - PULL (Google → Blueprint): the Blueprint calendar read with Google's sync token (a full read after 410). An event
 *   whose etag matches the mirror is our own write coming back and is dropped. A new time on the same day is kept;
 *   a block moved to another day moves that day's open tasks there, pinned; a deleted block is hidden for that day.
 * - WATCH: Google push notifications where the API has a public https address; renewed before they expire.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { CalendarEvent, GoogleConnection, PrismaClient } from "@prisma/client";
import { d2i, i2d } from "../../db.js";
import { type ISODate, addDays } from "../../domain/dates.js";
import type { Clock } from "../../lib/clock.js";
import { cityScoped } from "../../lib/cityScope.js";
import { HttpError } from "../../lib/http.js";
import { withTimeZone } from "../../lib/zone.js";
import { replanCity } from "../schedule/replan.js";
import { type BlockKind, type RecallItem, hashBody, layoutDay, localStart, recallBody, studyBody } from "./blocks.js";
import { decrypt, encrypt } from "./crypto.js";
import { type CalendarConfig, type EventBody, GoogleError, type GoogleCalendarApi, type GoogleEvent } from "./google.js";

export type JobKind = "PUSH" | "PULL" | "WATCH";
/** Tries before a job gives up and the connection is paused ("Retry" on the Calendar page). */
export const MAX_ATTEMPTS = 8;
const CHANNEL_RENEW_MS = 24 * 3600_000;

export interface CalendarDeps {
  prisma: PrismaClient;
  clock: Clock;
  config: CalendarConfig;
  google: GoogleCalendarApi;
  /** Wall-clock time for job timing (tests replace it); "today" always comes from the clock. */
  now?: () => Date;
}

export interface CalendarStatus {
  configured: boolean;
  connected: boolean;
  status: "ACTIVE" | "PAUSED" | "RECONNECT" | null;
  startTime: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  /** Changes in Google arrive at once (webhooks) or on the next read (every few minutes, on opening the app). */
  instant: boolean;
  pollMinutes: number;
  blocks: number;
  /** Minutes before a block that Google reminds you; 0 = none. */
  reminderMinutes: number;
  /** Your active cities in order, with each one's study slot ("09:00"; null = the default start). */
  cities: { id: string; name: string; start: string | null }[];
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** Exponential backoff with jitter: 30 s, 1 min, 2 min, … capped at an hour, ±25 %. */
export const backoffMs = (attempt: number) => Math.min(3600_000, 30_000 * 2 ** (attempt - 1)) * (0.75 + Math.random() * 0.5);

export function calendarService(d: CalendarDeps) {
  const { prisma, config, google } = d;
  const now = d.now ?? (() => new Date());
  const key = () => {
    if (!config.key) throw new HttpError(503, "CALENDAR_OFF", "Google Calendar isn't set up on this server.");
    return config.key;
  };

  /* ---------------- jobs ---------------- */

  /** Asks for a job; one waiting job per account and kind, so many requests make one run. */
  async function enqueue(userId: string, kind: JobKind, delayMs = 0) {
    const t = now();
    const runAt = new Date(t.getTime() + delayMs);
    // A job backing off after a failure keeps its later time; otherwise the earliest request wins.
    await prisma.$executeRaw`
      INSERT INTO "CalendarJob" ("userId", "kind", "runAt", "requestedAt") VALUES (${userId}, ${kind}, ${runAt}, ${t})
      ON CONFLICT ("userId", "kind") DO UPDATE SET "requestedAt" = EXCLUDED."requestedAt",
        "runAt" = CASE WHEN "CalendarJob"."attempts" > 0 THEN "CalendarJob"."runAt" ELSE LEAST("CalendarJob"."runAt", EXCLUDED."runAt") END`;
  }

  /** Claims the next due job (FOR UPDATE SKIP LOCKED: two workers never take the same one). */
  async function claim() {
    const t = now();
    const lock = new Date(t.getTime() + 5 * 60_000);
    const rows = await prisma.$queryRaw<{ id: number; userId: string; kind: JobKind; requestedAt: Date; attempts: number }[]>`
      UPDATE "CalendarJob" SET "lockedUntil" = ${lock}
      WHERE "id" = (SELECT "id" FROM "CalendarJob" WHERE "runAt" <= ${t} AND ("lockedUntil" IS NULL OR "lockedUntil" < ${t})
                    ORDER BY "runAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING "id", "userId", "kind", "requestedAt", "attempts"`;
    return rows[0] ?? null;
  }

  async function runJob(job: NonNullable<Awaited<ReturnType<typeof claim>>>) {
    try {
      const c = await prisma.googleConnection.findUnique({ where: { userId: job.userId } });
      if (c?.status === "ACTIVE") {
        if (job.kind === "PUSH") await push(job.userId);
        else if (job.kind === "PULL") await pull(job.userId);
        else await watch(job.userId);
      }
      // Done, unless it was asked for again while it ran: then it runs once more.
      const done = await prisma.calendarJob.deleteMany({ where: { id: job.id, requestedAt: job.requestedAt } });
      if (!done.count) await prisma.calendarJob.updateMany({ where: { id: job.id }, data: { lockedUntil: null, attempts: 0, lastError: null } });
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 300) : "Sync failed";
      console.warn(JSON.stringify({ level: "warn", msg: "Calendar sync failed", kind: job.kind, status: e instanceof GoogleError ? e.status : null, attempt: job.attempts + 1 }));
      // Google no longer accepts the token (revoked, expired): nothing to retry until the learner connects again.
      if (e instanceof GoogleError && (e.status === 401 || e.reason === "invalid_grant")) {
        await prisma.googleConnection.updateMany({ where: { userId: job.userId }, data: { status: "RECONNECT", lastError: "Google no longer accepts Blueprint's access. Connect again." } });
        await prisma.calendarJob.deleteMany({ where: { userId: job.userId } });
        return;
      }
      const attempts = job.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await prisma.googleConnection.updateMany({ where: { userId: job.userId }, data: { status: "PAUSED", lastError: message } });
        await prisma.calendarJob.deleteMany({ where: { id: job.id } });
        return;
      }
      await prisma.calendarJob.updateMany({ where: { id: job.id }, data: { attempts, lastError: message, lockedUntil: null, runAt: new Date(now().getTime() + backoffMs(attempts)) } });
    }
  }

  /** Runs due jobs until none is left (or `max` ran); answers how many ran. */
  async function runDue(max = 50) {
    let n = 0;
    for (; n < max; n++) {
      const job = await claim();
      if (!job) break;
      await runJob(job);
    }
    return n;
  }

  /* ---------------- tokens ---------------- */

  /** A valid access token, refreshed under a per-account lock so two jobs never refresh at once. */
  async function accessToken(userId: string): Promise<string> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gcal:${userId}`}))`;
      const c = await tx.googleConnection.findUniqueOrThrow({ where: { userId } });
      if (c.accessToken && c.accessExpiresAt && c.accessExpiresAt.getTime() > now().getTime() + 60_000) return decrypt(key(), c.accessToken);
      const t = await google.refresh(decrypt(key(), c.refreshToken));
      await tx.googleConnection.update({
        where: { userId },
        data: { accessToken: encrypt(key(), t.accessToken), accessExpiresAt: new Date(now().getTime() + t.expiresInSec * 1000), ...(t.refreshToken ? { refreshToken: encrypt(key(), t.refreshToken) } : {}) },
      });
      return t.accessToken;
    }, { timeout: 30_000 });
  }

  /* ---------------- what should be in the calendar ---------------- */

  /** One event Blueprint wants: a city's recalls or its study block on a day (docs/Google-Calendar-MVP-Plan.md §8). */
  interface Want { key: string; cityId: string; day: ISODate; kind: BlockKind; timeZone: string; minutes: number; earliest: number; body: (startMinute: number) => EventBody | null }
  const keyOf = (cityId: string, day: ISODate, kind: string) => `${cityId}|${day}|${kind}`;

  /** The cities in the learner's order (unlisted ones last, oldest first). */
  const ordered = <T extends { id: string; createdAt: Date }>(cities: T[], order: string[]) =>
    [...cities].sort((a, b) => {
      const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      if (ia !== ib) return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

  /** Every event for the window, in day order (each city's recalls, then its study block, cities in order). */
  async function wanted(c: GoogleConnection) {
    const cities = ordered(await prisma.city.findMany({
      where: { ownerId: c.userId, status: "ACTIVE" },
      include: { settings: { select: { timezone: true, studyStartMinute: true } }, weeklyTargets: { select: { weekday: true, availableMinutes: true, targetMinutes: true } } },
    }), c.cityOrder);
    const want: Want[] = [];
    const windows = new Map<string, { from: ISODate; to: ISODate; timeZone: string }>();
    for (const city of cities) {
      const timeZone = city.settings?.timezone ?? "Europe/Berlin";
      // The city's own study slot (§9), else the calendar's start; its length is the weekday's study time.
      const earliest = city.settings?.studyStartMinute ?? c.startMinute;
      const slotOf = (day: ISODate) => {
        const wd = new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
        const t = city.weeklyTargets.find((x) => x.weekday === wd);
        return t ? t.availableMinutes ?? t.targetMinutes : 0;
      };
      const from = withTimeZone(timeZone, () => d.clock.today());
      const to = addDays(from, config.windowDays - 1);
      windows.set(city.id, { from, to, timeZone });
      const tasks = await prisma.task.findMany({
        where: { cityId: city.id, scheduledDate: { gte: i2d(from), lte: i2d(to) }, status: { in: ["TODO", "DONE"] } },
        orderBy: [{ scheduledDate: "asc" }, { originalDate: "asc" }, { position: "asc" }, { id: "asc" }],
        select: {
          title: true, estimatedMinutes: true, status: true, scheduledDate: true, originalDate: true, recallStateId: true, subtopicId: true,
          stage: { select: { name: true } }, subtopic: { select: { name: true, topic: { select: { name: true } } } }, recallState: { select: { lastReviewDate: true } },
        },
      });
      const byDay = new Map<ISODate, typeof tasks>();
      for (const t of tasks) {
        const day = d2i(t.scheduledDate);
        // Finished ahead of its day (a sub-topic ticked learned closes its later study tasks today): not today's work.
        if (t.status === "DONE" && d2i(t.originalDate) > day) continue;
        byDay.set(day, [...(byDay.get(day) ?? []), t]);
      }
      for (const [day, list] of byDay) {
        const total = list.reduce((s, t) => s + t.estimatedMinutes, 0);
        const slot = slotOf(day);
        const over = slot > 0 && total > slot ? { minutes: total - slot, slot } : null;
        const ctx = { cityId: city.id, cityName: city.name, day, timeZone, appUrl: config.appUrl, reminderMinutes: c.reminderMinutes, over };
        const recalls = list.filter((t) => t.recallStateId !== null);
        const study = list.filter((t) => t.recallStateId === null);
        if (recalls.length) {
          const items: RecallItem[] = recalls.map((t) => ({
            subtopicId: t.subtopicId ?? 0, name: t.subtopic?.name ?? t.title.replace(/^Recall:\s*/, ""), topic: t.subtopic?.topic.name ?? "", minutes: t.estimatedMinutes,
            done: t.status === "DONE", lastReview: t.recallState?.lastReviewDate ? d2i(t.recallState.lastReviewDate) : null,
            overdueSince: t.status === "TODO" && d2i(t.originalDate) < day ? d2i(t.originalDate) : null,
          }));
          want.push({ key: keyOf(city.id, day, "RECALL"), cityId: city.id, day, kind: "RECALL", timeZone, earliest, minutes: items.reduce((s, x) => s + x.minutes, 0), body: (m) => recallBody({ ...ctx, over: null, items }, m) });
        }
        if (study.length) {
          // The stage most of the day's work belongs to.
          const stages = new Map<string, number>();
          for (const t of study) if (t.stage) stages.set(t.stage.name, (stages.get(t.stage.name) ?? 0) + t.estimatedMinutes);
          const stage = [...stages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
          const items = study.map((t) => ({ title: t.title, minutes: t.estimatedMinutes, done: t.status === "DONE" }));
          want.push({ key: keyOf(city.id, day, "STUDY"), cityId: city.id, day, kind: "STUDY", timeZone, earliest, minutes: items.reduce((s, x) => s + x.minutes, 0), body: (m) => studyBody({ ...ctx, stage, tasks: items }, m) });
        }
      }
    }
    return { want, windows, firstZone: cities[0]?.settings?.timezone ?? "Europe/Berlin" };
  }

  async function ensureCalendar(c: GoogleConnection, at: string, timeZone: string) {
    if (c.calendarId) return c.calendarId;
    const cal = await google.createCalendar(at, "Blueprint", timeZone);
    await prisma.googleConnection.update({ where: { userId: c.userId }, data: { calendarId: cal.id, syncToken: null } });
    return cal.id;
  }

  /** The calendar was deleted in Google: start again with a new one on the next push. */
  async function calendarGone(userId: string) {
    await prisma.googleConnection.update({ where: { userId }, data: { calendarId: null, syncToken: null } });
    await prisma.calendarEvent.deleteMany({ where: { userId } });
  }

  /* ---------------- PUSH ---------------- */

  async function push(userId: string) {
    const c = await prisma.googleConnection.findUniqueOrThrow({ where: { userId } });
    const { want, windows, firstZone } = await wanted(c);
    const rows = await prisma.calendarEvent.findMany({ where: { userId } });
    const rowOf = new Map(rows.map((r) => [keyOf(r.cityId, d2i(r.day), r.kind), r]));

    // Each day laid out across cities: events one after another from the start time, moved ones where they were put.
    const starts = new Map<string, number>();
    const days = [...new Set(want.map((w) => w.day))];
    for (const day of days) {
      const list = want.filter((w) => w.day === day && !rowOf.get(w.key)?.hidden);
      const at = layoutDay(list.map((w) => ({ minutes: w.minutes, fixed: rowOf.get(w.key)?.startMinute ?? null, earliest: w.earliest })));
      list.forEach((w, i) => starts.set(w.key, at[i]));
    }

    type Op = { kind: "insert" | "patch"; w: Want; row?: CalendarEvent; body: EventBody; hash: string; start: number } | { kind: "delete"; row: CalendarEvent };
    const ops: Op[] = [];
    for (const w of want) {
      const row = rowOf.get(w.key);
      if (row?.hidden) continue;
      const start = starts.get(w.key)!;
      const body = w.body(start);
      if (!body) continue;
      const hash = hashBody(body);
      if (!row?.googleEventId) ops.push({ kind: "insert", w, row, body, hash, start });
      else if (row.contentHash !== hash) ops.push({ kind: "patch", w, row, body, hash, start });
    }
    const wantedKeys = new Set(want.map((w) => w.key));
    for (const row of rows) {
      if (!row.googleEventId || wantedKeys.has(keyOf(row.cityId, d2i(row.day), row.kind))) continue;
      const win = windows.get(row.cityId);
      // A city that is gone or no longer active loses its blocks; past days and days beyond the window are left alone.
      if (!win || (d2i(row.day) >= win.from && d2i(row.day) <= win.to)) ops.push({ kind: "delete", row });
    }
    if (!ops.length && c.calendarId) {
      await prisma.googleConnection.update({ where: { userId }, data: { lastSyncedAt: now(), lastError: null } });
      return 0;
    }

    const at = await accessToken(userId);
    const calendarId = await ensureCalendar(c, at, firstZone);
    for (const op of ops) {
      try {
        if (op.kind === "insert") {
          const ev = await google.insertEvent(at, calendarId, op.body);
          await saveRow(userId, op.w, { googleEventId: ev.id, etag: ev.etag, contentHash: op.hash, hidden: false, placedMinute: op.start });
        } else if (op.kind === "patch") {
          await patch(at, calendarId, op.w, op.row!, op.body, op.hash, op.start);
        } else {
          const row = op.row!;
          await google.deleteEvent(at, calendarId, row.googleEventId!).catch((e) => {
            if (!(e instanceof GoogleError && (e.status === 404 || e.status === 410))) throw e;
          });
          await prisma.calendarEvent.delete({ where: { id: row.id } });
        }
      } catch (e) {
        if (e instanceof GoogleError && e.status === 404 && op.kind === "insert") {
          // The Blueprint calendar itself was deleted in Google.
          await calendarGone(userId);
          throw new GoogleError(404, "The Blueprint calendar was deleted in Google; a new one is made on the next try.");
        }
        throw e;
      }
    }
    await prisma.googleConnection.update({ where: { userId }, data: { lastSyncedAt: now(), lastError: null } });
    return ops.length;
  }

  type RowData = Partial<Pick<CalendarEvent, "googleEventId" | "etag" | "contentHash" | "hidden" | "startMinute" | "placedMinute">>;
  async function saveRow(userId: string, w: Pick<Want, "cityId" | "day" | "kind">, data: RowData) {
    const where = { userId_cityId_day_kind: { userId, cityId: w.cityId, day: i2d(w.day), kind: w.kind } };
    await prisma.calendarEvent.upsert({ where, create: { userId, cityId: w.cityId, day: i2d(w.day), kind: w.kind, ...data }, update: data });
  }

  /** A patch with If-Match; when the learner changed the event in Google meanwhile (412), their time is kept. */
  async function patch(at: string, calendarId: string, w: Want, row: CalendarEvent, body: EventBody, hash: string, start: number) {
    try {
      const ev = await google.patchEvent(at, calendarId, row.googleEventId!, body, row.etag ?? undefined);
      await saveRow(row.userId, w, { etag: ev.etag, contentHash: hash, placedMinute: start });
    } catch (e) {
      if (!(e instanceof GoogleError)) throw e;
      if (e.status === 404 || e.status === 410) {
        // Deleted in Google before the pull noticed: hidden for that day, like any deleted block.
        await saveRow(row.userId, w, { googleEventId: null, etag: null, contentHash: null, hidden: true });
        return;
      }
      if (e.status !== 412) throw e;
      const remote = await google.getEvent(at, calendarId, row.googleEventId!);
      if (remote.status === "cancelled") {
        await saveRow(row.userId, w, { googleEventId: null, etag: null, contentHash: null, hidden: true });
        return;
      }
      const local = localStart(remote.start, w.timeZone);
      // Same day: the learner's time wins, Blueprint's title, tasks and length win. Another day: the pull handles it.
      if (local && local.day !== w.day) return;
      // Moved only if Blueprint knows where it put it and the time differs (a row from before §8 knows nothing).
      const moved = local?.minute != null && row.placedMinute !== null && local.minute !== row.placedMinute ? local.minute : null;
      const at2 = moved ?? row.startMinute ?? start;
      const again = w.body(at2)!;
      const ev = await google.patchEvent(at, calendarId, row.googleEventId!, again, remote.etag);
      await saveRow(row.userId, w, { etag: ev.etag, contentHash: hashBody(again), placedMinute: at2, ...(moved !== null ? { startMinute: moved } : {}) });
    }
  }

  /* ---------------- PULL ---------------- */

  async function pull(userId: string) {
    const c = await prisma.googleConnection.findUniqueOrThrow({ where: { userId } });
    if (!c.calendarId) return 0;
    const at = await accessToken(userId);
    const items: GoogleEvent[] = [];
    let syncToken = c.syncToken ?? undefined;
    let next: string | undefined;
    for (let page: string | undefined, guard = 0; guard < 100; guard++) {
      try {
        const r = await google.listEvents(at, c.calendarId, { syncToken, pageToken: page });
        items.push(...r.items);
        if (r.nextPageToken) page = r.nextPageToken;
        else {
          next = r.nextSyncToken;
          break;
        }
      } catch (e) {
        if (e instanceof GoogleError && e.status === 410 && syncToken) {
          // The sync token is too old: read everything again.
          syncToken = undefined;
          page = undefined;
          items.length = 0;
          continue;
        }
        if (e instanceof GoogleError && e.status === 404) {
          await calendarGone(userId);
          await enqueue(userId, "PUSH");
          return 0;
        }
        throw e;
      }
    }

    const rows = await prisma.calendarEvent.findMany({ where: { userId, googleEventId: { not: null } } });
    const rowOf = new Map(rows.map((r) => [r.googleEventId!, r]));
    const zones = new Map((await prisma.settings.findMany({ where: { cityId: { in: [...new Set(rows.map((r) => r.cityId))] } }, select: { cityId: true, timezone: true } })).map((s) => [s.cityId, s.timezone]));
    let changed = 0;
    const replan = new Set<string>();
    for (const ev of items) {
      if (ev.extendedProperties?.private?.bp !== "1") continue; // not one of Blueprint's events: left alone
      const row = rowOf.get(ev.id);
      if (!row || ev.etag === row.etag) continue; // unknown, or our own write coming back
      changed++;
      if (ev.status === "cancelled") {
        await prisma.calendarEvent.update({ where: { id: row.id }, data: { hidden: true, googleEventId: null, etag: null, contentHash: null } });
        continue;
      }
      const timeZone = zones.get(row.cityId) ?? "Europe/Berlin";
      const local = localStart(ev.start, timeZone);
      if (!local) continue;
      if (local.day === d2i(row.day)) {
        // Moved to another time: kept from now on. Any other edit: the next push writes Blueprint's version back.
        // Unknown where Blueprint put it (a row from before §8): taken as Blueprint's own placement, never as a move.
        const moved = local.minute !== null && row.placedMinute !== null && local.minute !== row.placedMinute;
        await prisma.calendarEvent.update({
          where: { id: row.id },
          data: { etag: ev.etag, contentHash: null, ...(moved ? { startMinute: local.minute, placedMinute: local.minute } : row.placedMinute === null ? { placedMinute: local.minute } : {}) },
        });
      } else if (await moveDay(userId, row, local.day, local.minute, ev, c, timeZone)) replan.add(row.cityId);
    }
    for (const cityId of replan) {
      const tz = zones.get(cityId) ?? "Europe/Berlin";
      await replanCity(cityScoped(prisma, cityId), cityId, withTimeZone(tz, () => d.clock.today()), "CALENDAR");
    }
    await prisma.googleConnection.update({ where: { userId }, data: { syncToken: next ?? null, lastSyncedAt: now(), lastError: null } });
    if (changed) await enqueue(userId, "PUSH");
    return changed;
  }

  /**
   * An event dragged to another day: that day's open tasks of its kind (recalls for a recall event, the rest for a
   * study block) move there and are pinned, as if moved by hand. If the new day already has that event, the moved one
   * is folded into it. A move into the past is ignored (the push puts it back).
   */
  async function moveDay(userId: string, row: CalendarEvent, to: ISODate, minute: number | null, ev: GoogleEvent, c: GoogleConnection, timeZone: string) {
    const from = d2i(row.day);
    const today = withTimeZone(timeZone, () => d.clock.today());
    if (to < today) {
      await prisma.calendarEvent.update({ where: { id: row.id }, data: { etag: ev.etag, contentHash: null } });
      return false;
    }
    const at = d.clock.now();
    await prisma.task.updateMany({
      where: { cityId: row.cityId, scheduledDate: i2d(from), status: "TODO", recallStateId: row.kind === "RECALL" ? { not: null } : null },
      data: { scheduledDate: i2d(to), pinnedAt: at, rescheduleCount: { increment: 1 } },
    });
    const there = await prisma.calendarEvent.findUnique({ where: { userId_cityId_day_kind: { userId, cityId: row.cityId, day: i2d(to), kind: row.kind } } });
    if (there?.googleEventId && !there.hidden) {
      const token = await accessToken(userId);
      await google.deleteEvent(token, c.calendarId!, ev.id).catch(() => undefined);
      await prisma.calendarEvent.delete({ where: { id: row.id } });
      await prisma.calendarEvent.update({ where: { id: there.id }, data: { contentHash: null } });
    } else {
      if (there) await prisma.calendarEvent.delete({ where: { id: there.id } });
      await prisma.calendarEvent.update({
        where: { id: row.id },
        data: { day: i2d(to), etag: ev.etag, contentHash: null, startMinute: minute, placedMinute: minute },
      });
    }
    return true;
  }

  /* ---------------- WATCH ---------------- */

  async function watch(userId: string) {
    if (!config.webhookUrl) return;
    const c = await prisma.googleConnection.findUniqueOrThrow({ where: { userId } });
    if (!c.calendarId) {
      await enqueue(userId, "WATCH", 60_000);
      return;
    }
    const at = await accessToken(userId);
    for (const old of await prisma.calendarChannel.findMany({ where: { userId } })) {
      await google.stopChannel(at, { id: old.id, resourceId: old.resourceId }).catch(() => undefined);
      await prisma.calendarChannel.delete({ where: { id: old.id } });
    }
    const id = randomUUID();
    const token = randomBytes(24).toString("base64url");
    const ch = await google.watch(at, c.calendarId, { id, token, address: config.webhookUrl });
    await prisma.calendarChannel.create({ data: { id, userId, resourceId: ch.resourceId, token, expiresAt: ch.expiresAt } });
  }

  /** Channels that end within a day (or accounts without one) get a new one. */
  async function renewChannels() {
    if (!config.webhookUrl) return 0;
    const soon = new Date(now().getTime() + CHANNEL_RENEW_MS);
    const accounts = await prisma.googleConnection.findMany({ where: { status: "ACTIVE", calendarId: { not: null } }, select: { userId: true, channels: { select: { expiresAt: true } } } });
    const due = accounts.filter((a) => !a.channels.some((ch) => ch.expiresAt > soon));
    for (const a of due) await enqueue(a.userId, "WATCH");
    return due.length;
  }

  /* ---------------- the account's side ---------------- */

  return {
    enqueue,
    runDue,
    renewChannels,
    push,
    pull,

    async status(userId: string): Promise<CalendarStatus> {
      const c = await prisma.googleConnection.findUnique({ where: { userId } });
      const blocks = c ? await prisma.calendarEvent.count({ where: { userId, googleEventId: { not: null } } }) : 0;
      const cities = c ? ordered(await prisma.city.findMany({ where: { ownerId: userId, status: "ACTIVE" }, select: { id: true, name: true, createdAt: true, settings: { select: { studyStartMinute: true } } } }), c.cityOrder) : [];
      return {
        configured: config.enabled, connected: !!c, status: (c?.status as CalendarStatus["status"]) ?? null,
        startTime: hhmm(c?.startMinute ?? 1080), lastSyncedAt: c?.lastSyncedAt?.toISOString() ?? null, lastError: c?.lastError ?? null,
        instant: !!config.webhookUrl, pollMinutes: config.pollMinutes, blocks,
        reminderMinutes: c?.reminderMinutes ?? 10,
        cities: cities.map((x) => ({ id: x.id, name: x.name, start: x.settings?.studyStartMinute != null ? hhmm(x.settings.studyStartMinute) : null })),
      };
    },

    /** The consent URL, with a one-time `state` that ties Google's answer to this session. */
    connectUrl(state: string) {
      if (!config.enabled) throw new HttpError(503, "CALENDAR_OFF", "Google Calendar isn't set up on this server.");
      return google.authUrl(state, config.redirectUri);
    },

    async finishConnect(userId: string, code: string) {
      const t = await google.exchangeCode(code, config.redirectUri);
      if (!t.refreshToken) throw new HttpError(502, "GOOGLE_NO_REFRESH", "Google didn't give Blueprint lasting access. Try connecting again.");
      const data = {
        refreshToken: encrypt(key(), t.refreshToken), accessToken: encrypt(key(), t.accessToken),
        accessExpiresAt: new Date(now().getTime() + t.expiresInSec * 1000), scope: t.scope ?? "", status: "ACTIVE", lastError: null,
      };
      await prisma.googleConnection.upsert({ where: { userId }, create: { userId, ...data }, update: data });
      await enqueue(userId, "PULL");
      await enqueue(userId, "PUSH");
      if (config.webhookUrl) await enqueue(userId, "WATCH", 5_000);
    },

    /** The start time, the reminder and the city order; blocks follow on the next push. */
    async setSettings(userId: string, s: { startTime?: string; reminderMinutes?: number; cityOrder?: string[] }) {
      const data: { startMinute?: number; reminderMinutes?: number; cityOrder?: string[] } = {};
      if (s.startTime) {
        const [h, m] = s.startTime.split(":").map(Number);
        data.startMinute = h * 60 + m;
      }
      if (s.reminderMinutes !== undefined) data.reminderMinutes = s.reminderMinutes;
      if (s.cityOrder) {
        // Only your own cities, each once.
        const mine = new Set((await prisma.city.findMany({ where: { ownerId: userId }, select: { id: true } })).map((x) => x.id));
        data.cityOrder = [...new Set(s.cityOrder)].filter((id) => mine.has(id));
      }
      const r = await prisma.googleConnection.updateMany({ where: { userId }, data });
      if (!r.count) throw new HttpError(404, "CALENDAR_NOT_CONNECTED", "Connect Google Calendar first.");
      await enqueue(userId, "PUSH");
    },

    /** "Sync now" (and "Retry" after a pause): read Google, then write. */
    async syncNow(userId: string) {
      const r = await prisma.googleConnection.updateMany({ where: { userId, status: { not: "RECONNECT" } }, data: { status: "ACTIVE", lastError: null } });
      if (!r.count) throw new HttpError(409, "CALENDAR_RECONNECT", "Connect Google Calendar again first.");
      await prisma.calendarJob.updateMany({ where: { userId }, data: { attempts: 0, runAt: now() } });
      await enqueue(userId, "PULL");
      await enqueue(userId, "PUSH");
    },

    /** Stops syncing and revokes access; the Blueprint calendar is removed from Google only if asked. */
    async disconnect(userId: string, removeCalendar: boolean) {
      const c = await prisma.googleConnection.findUnique({ where: { userId }, include: { channels: true } });
      if (!c) return;
      try {
        const at = await accessToken(userId);
        for (const ch of c.channels) await google.stopChannel(at, { id: ch.id, resourceId: ch.resourceId }).catch(() => undefined);
        if (removeCalendar && c.calendarId) await google.deleteCalendar(at, c.calendarId).catch(() => undefined);
      } catch {
        /* Google may already refuse the token; the local data goes anyway */
      }
      await google.revoke(decrypt(key(), c.refreshToken)).catch(() => undefined);
      await prisma.googleConnection.delete({ where: { userId } });
    },

    /** A push notification: accepted only when channel, resource and token all match. */
    async notified(h: { channelId?: string; resourceId?: string; token?: string; state?: string }) {
      if (!h.channelId) return false;
      const ch = await prisma.calendarChannel.findUnique({ where: { id: h.channelId } });
      if (!ch || ch.resourceId !== h.resourceId || ch.token !== h.token) return false;
      if (h.state !== "sync") await enqueue(ch.userId, "PULL");
      return true;
    },

    /** After a change in Blueprint: a push a little later (many changes in a row make one). */
    async changed(userId: string) {
      const c = await prisma.googleConnection.findUnique({ where: { userId }, select: { status: true } });
      if (c?.status === "ACTIVE") await enqueue(userId, "PUSH", 10_000);
    },

    /** Every account read and written again (a new day moves the window; changes made where no hook fired). */
    pollAll,

    /** The worker: due jobs every few seconds, everyone every `pollMinutes`, channel renewal every 12 hours. */
    start() {
      if (!config.enabled) return () => {};
      let busy = false;
      const tick = async () => {
        if (busy) return;
        busy = true;
        try {
          await runDue();
        } catch (e) {
          console.error(JSON.stringify({ level: "error", msg: "Calendar worker failed", error: String((e as Error).message ?? e).slice(0, 300) }));
        } finally {
          busy = false;
        }
      };
      const quiet = (p: Promise<unknown>) => void p.catch((e) => console.error(JSON.stringify({ level: "error", msg: "Calendar job scheduling failed", error: String((e as Error).message ?? e).slice(0, 300) })));
      quiet(pollAll());
      quiet(renewChannels());
      const timers = [
        setInterval(() => void tick(), 5_000),
        setInterval(() => quiet(pollAll()), config.pollMinutes * 60_000),
        setInterval(() => quiet(renewChannels()), 12 * 3600_000),
      ];
      for (const t of timers) t.unref();
      return () => timers.forEach(clearInterval);
    },
  };

  async function pollAll() {
    const accounts = await prisma.googleConnection.findMany({ where: { status: "ACTIVE" }, select: { userId: true } });
    for (const a of accounts) {
      await enqueue(a.userId, "PULL");
      await enqueue(a.userId, "PUSH");
    }
    return accounts.length;
  }
}

export type CalendarService = ReturnType<typeof calendarService>;
