/**
 * An in-memory Google Calendar for tests and local development (GOOGLE_CALENDAR_FAKE=true): the same answers the real
 * API gives for the calls the sync makes, including sync tokens (410 once expired), etags (412 on a stale If-Match)
 * and deleted events as "cancelled". Helpers act as the learner in Google (`userMove`, `userDelete`) and inject
 * failures (`failNext`). Its sign-in page is skipped: the consent URL is the callback itself.
 */
import { randomUUID } from "node:crypto";
import { type EventBody, GoogleError, type GoogleCalendarApi, type GoogleEvent, type Tokens } from "./google.js";

interface Stored { ev: GoogleEvent; version: number }
interface Cal { id: string; summary: string; timeZone: string; version: number; events: Map<string, Stored>; oldestToken: number }

export type FakeGoogle = GoogleCalendarApi & {
  calendars: Map<string, Cal>;
  calls: string[];
  channels: Map<string, { calendarId: string; resourceId: string; token: string; address: string }>;
  revoked: string[];
  /** The next call of `method` (or any call, "*") fails with this status. */
  failNext(method: string, status: number, times?: number): void;
  /** Sync tokens issued before now answer 410. */
  expireSyncTokens(calendarId: string): void;
  userMove(calendarId: string, eventId: string, start: string, end: string): void;
  userDelete(calendarId: string, eventId: string): void;
  events(calendarId: string): GoogleEvent[];
};

export function fakeGoogle(): FakeGoogle {
  const calendars = new Map<string, Cal>();
  const calls: string[] = [];
  const channels = new Map<string, { calendarId: string; resourceId: string; token: string; address: string }>();
  const revoked: string[] = [];
  const failures: { method: string; status: number }[] = [];
  let tokenSeq = 0;

  const hit = (method: string) => {
    calls.push(method);
    const i = failures.findIndex((f) => f.method === method || f.method === "*");
    if (i >= 0) {
      const [f] = failures.splice(i, 1);
      throw new GoogleError(f.status, `fake ${method} ${f.status}`);
    }
  };
  const cal = (id: string) => {
    const c = calendars.get(id);
    if (!c) throw new GoogleError(404, "calendar not found");
    return c;
  };
  const bump = (c: Cal, s: Stored) => {
    c.version++;
    s.version = c.version;
    s.ev.etag = `"${c.id}-${c.version}"`;
  };
  const copy = (e: GoogleEvent): GoogleEvent => JSON.parse(JSON.stringify(e));
  const issue = (): Tokens => ({ accessToken: `at-${++tokenSeq}`, expiresInSec: 3600 });

  return {
    calendars, calls, channels, revoked,
    failNext: (method, status, times = 1) => { for (let i = 0; i < times; i++) failures.push({ method, status }); },
    expireSyncTokens: (id) => { cal(id).oldestToken = cal(id).version + 1; },
    userMove(id, eventId, start, end) {
      const c = cal(id);
      const s = c.events.get(eventId)!;
      s.ev.start = { dateTime: start, timeZone: s.ev.start?.timeZone };
      s.ev.end = { dateTime: end, timeZone: s.ev.end?.timeZone };
      bump(c, s);
    },
    userDelete(id, eventId) {
      const c = cal(id);
      const s = c.events.get(eventId)!;
      s.ev.status = "cancelled";
      bump(c, s);
    },
    events: (id) => [...cal(id).events.values()].filter((s) => s.ev.status !== "cancelled").map((s) => copy(s.ev)),

    authUrl: (state, redirectUri) => `${redirectUri}?${new URLSearchParams({ code: "fake-code", state })}`,
    async exchangeCode(code) {
      hit("exchangeCode");
      if (code !== "fake-code") throw new GoogleError(400, "bad code", "invalid_grant");
      return { ...issue(), refreshToken: `rt-${randomUUID()}`, scope: "https://www.googleapis.com/auth/calendar.app.created" };
    },
    async refresh() {
      hit("refresh");
      return issue();
    },
    async revoke(token) {
      hit("revoke");
      revoked.push(token);
    },
    async createCalendar(_at, summary, timeZone) {
      hit("createCalendar");
      const id = `cal-${randomUUID().slice(0, 8)}@group.calendar.google.com`;
      calendars.set(id, { id, summary, timeZone, version: 0, events: new Map(), oldestToken: 0 });
      return { id };
    },
    async deleteCalendar(_at, id) {
      hit("deleteCalendar");
      cal(id);
      calendars.delete(id);
    },
    async listEvents(_at, id, o) {
      hit("listEvents");
      const c = cal(id);
      const since = o.syncToken ? Number(o.syncToken.split(":")[1]) : null;
      if (since !== null && since < c.oldestToken) throw new GoogleError(410, "sync token too old", "fullSyncRequired");
      const items = [...c.events.values()].filter((s) => (since === null ? s.ev.status !== "cancelled" : s.version > since)).map((s) => copy(s.ev));
      return { items, nextSyncToken: `${id}:${c.version}` };
    },
    async getEvent(_at, id, eventId) {
      hit("getEvent");
      const s = cal(id).events.get(eventId);
      if (!s) throw new GoogleError(404, "event not found");
      return copy(s.ev);
    },
    async insertEvent(_at, id, body: EventBody) {
      hit("insertEvent");
      const c = cal(id);
      const s: Stored = { ev: { ...copy(body as GoogleEvent), id: `ev${randomUUID().replace(/-/g, "").slice(0, 12)}`, etag: "", status: "confirmed" }, version: 0 };
      c.events.set(s.ev.id, s);
      bump(c, s);
      return copy(s.ev);
    },
    async patchEvent(_at, id, eventId, body, etag) {
      hit("patchEvent");
      const c = cal(id);
      const s = c.events.get(eventId);
      if (!s || s.ev.status === "cancelled") throw new GoogleError(s ? 410 : 404, "event gone");
      if (etag && etag !== s.ev.etag) throw new GoogleError(412, "etag changed");
      Object.assign(s.ev, copy(body as GoogleEvent));
      bump(c, s);
      return copy(s.ev);
    },
    async deleteEvent(_at, id, eventId) {
      hit("deleteEvent");
      const c = cal(id);
      const s = c.events.get(eventId);
      if (!s || s.ev.status === "cancelled") throw new GoogleError(410, "event gone");
      s.ev.status = "cancelled";
      bump(c, s);
    },
    async watch(_at, id, ch) {
      hit("watch");
      cal(id);
      const resourceId = `res-${randomUUID().slice(0, 8)}`;
      channels.set(ch.id, { calendarId: id, resourceId, token: ch.token, address: ch.address });
      return { resourceId, expiresAt: new Date(Date.now() + 7 * 86_400_000) };
    },
    async stopChannel(_at, ch) {
      hit("stopChannel");
      channels.delete(ch.id);
    },
  };
}
