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
import { blockBody, hashBody, localStart } from "./blocks.js";
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

  interface Want { cityId: string; day: ISODate; timeZone: string; body: (startMinute: number) => EventBody | null }

  /** Each active city's blocks for the window, and each city's first and last day. */
  async function wanted(userId: string) {
    const cities = await prisma.city.findMany({ where: { ownerId: userId, status: "ACTIVE" }, include: { settings: { select: { timezone: true } } } });
    const want = new Map<string, Want>();
    const windows = new Map<string, { from: ISODate; to: ISODate; timeZone: string }>();
    for (const city of cities) {
      const timeZone = city.settings?.timezone ?? "Europe/Berlin";
      const from = withTimeZone(timeZone, () => d.clock.today());
      const to = addDays(from, config.windowDays - 1);
      windows.set(city.id, { from, to, timeZone });
      const tasks = await prisma.task.findMany({
        where: { cityId: city.id, scheduledDate: { gte: i2d(from), lte: i2d(to) }, status: { in: ["TODO", "DONE"] } },
        orderBy: [{ scheduledDate: "asc" }, { originalDate: "asc" }, { position: "asc" }, { id: "asc" }],
        select: { title: true, estimatedMinutes: true, status: true, scheduledDate: true },
      });
      const byDay = new Map<ISODate, typeof tasks>();
      for (const t of tasks) byDay.set(d2i(t.scheduledDate), [...(byDay.get(d2i(t.scheduledDate)) ?? []), t]);
      for (const [day, list] of byDay) {
        want.set(`${city.id}|${day}`, {
          cityId: city.id, day, timeZone,
          body: (startMinute) => blockBody({ cityId: city.id, cityName: city.name, day, timeZone, startMinute, tasks: list.map((t) => ({ title: t.title, minutes: t.estimatedMinutes, done: t.status === "DONE" })) }),
        });
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
    const { want, windows, firstZone } = await wanted(userId);
    const rows = await prisma.calendarEvent.findMany({ where: { userId } });
    const rowOf = new Map(rows.map((r) => [`${r.cityId}|${d2i(r.day)}`, r]));

    type Op = { kind: "insert" | "patch"; w: Want; row?: CalendarEvent; body: EventBody; hash: string } | { kind: "delete"; row: CalendarEvent };
    const ops: Op[] = [];
    for (const [k, w] of want) {
      const row = rowOf.get(k);
      if (row?.hidden) continue;
      const body = w.body(row?.startMinute ?? c.startMinute);
      if (!body) continue;
      const hash = hashBody(body);
      if (!row?.googleEventId) ops.push({ kind: "insert", w, row, body, hash });
      else if (row.contentHash !== hash) ops.push({ kind: "patch", w, row, body, hash });
    }
    for (const row of rows) {
      if (!row.googleEventId || want.has(`${row.cityId}|${d2i(row.day)}`)) continue;
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
          await saveRow(userId, op.w.cityId, op.w.day, { googleEventId: ev.id, etag: ev.etag, contentHash: op.hash, hidden: false });
        } else if (op.kind === "patch") {
          await patch(at, calendarId, c, op.w, op.row!, op.body, op.hash);
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

  async function saveRow(userId: string, cityId: string, day: ISODate, data: Partial<Pick<CalendarEvent, "googleEventId" | "etag" | "contentHash" | "hidden" | "startMinute">>) {
    await prisma.calendarEvent.upsert({ where: { userId_cityId_day: { userId, cityId, day: i2d(day) } }, create: { userId, cityId, day: i2d(day), ...data }, update: data });
  }

  /** A patch with If-Match; when the learner changed the event in Google meanwhile (412), their time is kept. */
  async function patch(at: string, calendarId: string, c: GoogleConnection, w: Want, row: CalendarEvent, body: EventBody, hash: string) {
    try {
      const ev = await google.patchEvent(at, calendarId, row.googleEventId!, body, row.etag ?? undefined);
      await saveRow(row.userId, w.cityId, w.day, { etag: ev.etag, contentHash: hash });
    } catch (e) {
      if (!(e instanceof GoogleError)) throw e;
      if (e.status === 404 || e.status === 410) {
        // Deleted in Google before the pull noticed: hidden for that day, like any deleted block.
        await saveRow(row.userId, w.cityId, w.day, { googleEventId: null, etag: null, contentHash: null, hidden: true });
        return;
      }
      if (e.status !== 412) throw e;
      const remote = await google.getEvent(at, calendarId, row.googleEventId!);
      if (remote.status === "cancelled") {
        await saveRow(row.userId, w.cityId, w.day, { googleEventId: null, etag: null, contentHash: null, hidden: true });
        return;
      }
      const local = localStart(remote.start, w.timeZone);
      // Same day: the learner's time wins, Blueprint's title, tasks and length win. Another day: the pull handles it.
      if (local && local.day !== w.day) return;
      const startMinute = local?.minute ?? row.startMinute ?? c.startMinute;
      const again = w.body(startMinute)!;
      const ev = await google.patchEvent(at, calendarId, row.googleEventId!, again, remote.etag);
      await saveRow(row.userId, w.cityId, w.day, { etag: ev.etag, contentHash: hashBody(again), startMinute: startMinute === c.startMinute ? null : startMinute });
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
      if (ev.extendedProperties?.private?.bp !== "1") continue; // not one of Blueprint's blocks: left alone
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
      const day = d2i(row.day);
      if (local.day === day) {
        const minute = local.minute ?? row.startMinute ?? c.startMinute;
        // The new time is kept; contentHash is cleared so the next push writes the planned length back if it changed.
        await prisma.calendarEvent.update({ where: { id: row.id }, data: { etag: ev.etag, startMinute: minute === c.startMinute ? null : minute, contentHash: null } });
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
   * A block dragged to another day: that day's open tasks move there and are pinned (as if moved by hand). If the new
   * day already has a block, the moved one is folded into it. A move into the past is ignored (the push puts it back).
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
      where: { cityId: row.cityId, scheduledDate: i2d(from), status: "TODO" },
      data: { scheduledDate: i2d(to), pinnedAt: at, rescheduleCount: { increment: 1 } },
    });
    const there = await prisma.calendarEvent.findUnique({ where: { userId_cityId_day: { userId, cityId: row.cityId, day: i2d(to) } } });
    if (there?.googleEventId && !there.hidden) {
      const token = await accessToken(userId);
      await google.deleteEvent(token, c.calendarId!, ev.id).catch(() => undefined);
      await prisma.calendarEvent.delete({ where: { id: row.id } });
      await prisma.calendarEvent.update({ where: { id: there.id }, data: { contentHash: null } });
    } else {
      if (there) await prisma.calendarEvent.delete({ where: { id: there.id } });
      await prisma.calendarEvent.update({
        where: { id: row.id },
        data: { day: i2d(to), etag: ev.etag, contentHash: null, startMinute: minute === null || minute === c.startMinute ? null : minute },
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
      return {
        configured: config.enabled, connected: !!c, status: (c?.status as CalendarStatus["status"]) ?? null,
        startTime: hhmm(c?.startMinute ?? 1080), lastSyncedAt: c?.lastSyncedAt?.toISOString() ?? null, lastError: c?.lastError ?? null,
        instant: !!config.webhookUrl, pollMinutes: config.pollMinutes, blocks,
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

    async setStart(userId: string, startTime: string) {
      const [h, m] = startTime.split(":").map(Number);
      const startMinute = h * 60 + m;
      const r = await prisma.googleConnection.updateMany({ where: { userId }, data: { startMinute } });
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
