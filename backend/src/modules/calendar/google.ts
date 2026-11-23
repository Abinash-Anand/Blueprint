/**
 * The Google side of calendar sync (docs/Google-Calendar-MVP-Plan.md): OAuth and the Calendar API calls the sync uses,
 * behind one interface, so tests and local development run on the fake (fakeGoogle.ts) and nothing calls Google.
 * Only the narrow `calendar.app.created` scope is asked for: Blueprint can make its own calendar and change events on
 * it, and can't read or change any other calendar.
 */
export const SCOPE = "https://www.googleapis.com/auth/calendar.app.created";

/** A Google API failure: `status` is the HTTP status (410 = sync token too old, 412 = the etag changed, …). */
export class GoogleError extends Error {
  constructor(public status: number, message: string, public reason?: string) {
    super(message);
  }
}

export interface EventTime { dateTime?: string; date?: string; timeZone?: string }
export interface GoogleEvent {
  id: string;
  etag: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  start?: EventTime;
  end?: EventTime;
  extendedProperties?: { private?: Record<string, string> };
  /** One of Google's 11 event colours ("1"–"11"). */
  colorId?: string;
  reminders?: { useDefault: boolean; overrides?: { method: "popup" | "email"; minutes: number }[] };
}
export type EventBody = Pick<GoogleEvent, "summary" | "description" | "start" | "end" | "extendedProperties" | "colorId" | "reminders">;
export interface EventPage { items: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string }
export interface Tokens { accessToken: string; expiresInSec: number; refreshToken?: string; scope?: string }

export interface GoogleCalendarApi {
  authUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<Tokens>;
  refresh(refreshToken: string): Promise<Tokens>;
  revoke(token: string): Promise<void>;
  createCalendar(at: string, summary: string, timeZone: string): Promise<{ id: string }>;
  deleteCalendar(at: string, calendarId: string): Promise<void>;
  /** One page: with `syncToken` only what changed since (deleted events as "cancelled"); without, everything. */
  listEvents(at: string, calendarId: string, o: { syncToken?: string; pageToken?: string }): Promise<EventPage>;
  getEvent(at: string, calendarId: string, eventId: string): Promise<GoogleEvent>;
  insertEvent(at: string, calendarId: string, body: EventBody): Promise<GoogleEvent>;
  /** A patch that only applies if the event's etag is still `etag` (412 otherwise). */
  patchEvent(at: string, calendarId: string, eventId: string, body: EventBody, etag?: string): Promise<GoogleEvent>;
  deleteEvent(at: string, calendarId: string, eventId: string): Promise<void>;
  watch(at: string, calendarId: string, c: { id: string; token: string; address: string }): Promise<{ resourceId: string; expiresAt: Date }>;
  stopChannel(at: string, c: { id: string; resourceId: string }): Promise<void>;
}

const OAUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";
const enc = encodeURIComponent;

/** The real client: plain fetch against Google's REST endpoints, 20 s per call. */
export function googleCalendarApi(o: { clientId: string; clientSecret: string }): GoogleCalendarApi {
  async function call<T>(method: string, url: string, init: { at?: string; body?: unknown; form?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<T> {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.at) headers.authorization = `Bearer ${init.at}`;
    let body: string | undefined;
    if (init.form) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(init.form).toString();
    } else if (init.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      throw new GoogleError(0, `Google could not be reached (${(e as Error).name})`);
    }
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      // OAuth errors: { error: "invalid_grant" }; API errors: { error: { message, errors: [{ reason }] } }.
      const err = data?.error;
      const reason = typeof err === "string" ? err : ((err as { errors?: { reason?: string }[] } | undefined)?.errors?.[0]?.reason);
      const message = typeof err === "object" && err ? String((err as { message?: string }).message ?? "") : String(data?.error_description ?? err ?? "");
      throw new GoogleError(res.status, `Google answered ${res.status}${message ? `: ${message.slice(0, 200)}` : ""}`, reason);
    }
    return data as T;
  }
  const tokens = (r: { access_token: string; expires_in: number; refresh_token?: string; scope?: string }): Tokens =>
    ({ accessToken: r.access_token, expiresInSec: r.expires_in, refreshToken: r.refresh_token, scope: r.scope });
  return {
    authUrl: (state, redirectUri) => `${OAUTH}?${new URLSearchParams({
      client_id: o.clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPE,
      access_type: "offline", prompt: "consent", include_granted_scopes: "false", state,
    })}`,
    exchangeCode: async (code, redirectUri) => tokens(await call("POST", TOKEN, { form: { code, client_id: o.clientId, client_secret: o.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" } })),
    refresh: async (refreshToken) => tokens(await call("POST", TOKEN, { form: { refresh_token: refreshToken, client_id: o.clientId, client_secret: o.clientSecret, grant_type: "refresh_token" } })),
    revoke: async (token) => void (await call("POST", REVOKE, { form: { token } })),
    createCalendar: (at, summary, timeZone) => call("POST", `${API}/calendars`, { at, body: { summary, timeZone } }),
    deleteCalendar: async (at, id) => void (await call("DELETE", `${API}/calendars/${enc(id)}`, { at })),
    listEvents: (at, id, q) => call("GET", `${API}/calendars/${enc(id)}/events?${new URLSearchParams({
      maxResults: "250", showDeleted: "true", ...(q.syncToken ? { syncToken: q.syncToken } : {}), ...(q.pageToken ? { pageToken: q.pageToken } : {}),
    })}`, { at }),
    getEvent: (at, id, eventId) => call("GET", `${API}/calendars/${enc(id)}/events/${enc(eventId)}`, { at }),
    insertEvent: (at, id, body) => call("POST", `${API}/calendars/${enc(id)}/events`, { at, body }),
    patchEvent: (at, id, eventId, body, etag) => call("PATCH", `${API}/calendars/${enc(id)}/events/${enc(eventId)}`, { at, body, headers: etag ? { "if-match": etag } : {} }),
    deleteEvent: async (at, id, eventId) => void (await call("DELETE", `${API}/calendars/${enc(id)}/events/${enc(eventId)}`, { at })),
    watch: async (at, id, c) => {
      const r = await call<{ resourceId: string; expiration: string }>("POST", `${API}/calendars/${enc(id)}/events/watch`, { at, body: { id: c.id, type: "web_hook", address: c.address, token: c.token } });
      return { resourceId: r.resourceId, expiresAt: new Date(Number(r.expiration)) };
    },
    stopChannel: async (at, c) => void (await call("POST", `${API}/channels/stop`, { at, body: { id: c.id, resourceId: c.resourceId } })),
  };
}

export interface CalendarConfig {
  /** Off unless the Google client and the token key are set (or the fake is on): the Calendar page says so. */
  enabled: boolean;
  fake: boolean;
  clientId?: string;
  clientSecret?: string;
  key: Buffer | null;
  redirectUri: string;
  /** Blueprint's own address, for the links in event descriptions. */
  appUrl: string;
  /** Where Google sends change notifications: only an https address Google can reach; null = poll instead. */
  webhookUrl: string | null;
  /** Days written ahead, today included. */
  windowDays: number;
  /** How often every account is read and written again without a trigger (minutes). */
  pollMinutes: number;
}

/** The public URL without a default port: Google compares redirect addresses exactly. */
const origin = (publicUrl: string) => {
  try {
    const u = new URL(publicUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return publicUrl.replace(/\/+$/, "");
  }
};

export function loadCalendarConfig(env: NodeJS.ProcessEnv, publicUrl: string, parseKey: (raw: string | undefined) => Buffer | null): CalendarConfig {
  const fake = env.GOOGLE_CALENDAR_FAKE === "true";
  const clientId = env.GOOGLE_CLIENT_ID?.trim() || undefined;
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() || undefined;
  // The fake needs no real key; a fixed development key keeps local data readable across restarts.
  const key = parseKey(env.CALENDAR_TOKEN_KEY) ?? (fake ? Buffer.alloc(32, 7) : null);
  const base = origin(publicUrl);
  const hook = env.GOOGLE_WEBHOOK_URL?.trim() || `${base}/api/calendar/google/webhook`;
  const reachable = (() => {
    try {
      const u = new URL(hook);
      return u.protocol === "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1";
    } catch {
      return false;
    }
  })();
  return {
    enabled: !!key && (fake || (!!clientId && !!clientSecret)),
    fake,
    clientId,
    clientSecret,
    key,
    appUrl: base,
    redirectUri: env.GOOGLE_REDIRECT_URI?.trim() || `${base}/api/calendar/google/callback`,
    webhookUrl: reachable && !fake ? hook : null,
    windowDays: 14,
    pollMinutes: Number(env.CALENDAR_POLL_MINUTES) > 0 ? Number(env.CALENDAR_POLL_MINUTES) : 15,
  };
}
