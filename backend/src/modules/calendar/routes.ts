/**
 * Google Calendar routes (docs/Google-Calendar-MVP-Plan.md). Account-level: a connection belongs to the signed-in user,
 * not to a city. The OAuth callback and the webhook are plain GET/POST from Google; everything else is the Calendar page.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { type RequestHandler, Router } from "express";
import { z } from "zod";
import { requireUser } from "../../lib/context.js";
import { validate } from "../../lib/http.js";
import { readCookie } from "../auth/security.js";
import type { CalendarService } from "./service.js";

const STATE_COOKIE = "bp_gstate";
const startBody = z.object({ startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 18:00") }).strict();
const disconnectBody = z.object({ removeCalendar: z.boolean().optional() }).strict();

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function calendarRoutes(calendar: CalendarService, secure: boolean) {
  const r = Router();
  const stateCookie = (value: string, maxAge: number) =>
    [`${STATE_COOKIE}=${value}`, "Path=/api/calendar", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`, ...(secure ? ["Secure"] : [])].join("; ");

  r.get("/calendar", requireUser, async (req, res, next) => {
    try {
      res.json(await calendar.status(req.user!.id));
    } catch (e) {
      next(e);
    }
  });

  r.put("/calendar", requireUser, async (req, res, next) => {
    try {
      await calendar.setStart(req.user!.id, validate(startBody, req.body).startTime);
      res.json(await calendar.status(req.user!.id));
    } catch (e) {
      next(e);
    }
  });

  r.post("/calendar/sync", requireUser, async (req, res, next) => {
    try {
      await calendar.syncNow(req.user!.id);
      res.json(await calendar.status(req.user!.id));
    } catch (e) {
      next(e);
    }
  });

  r.delete("/calendar", requireUser, async (req, res, next) => {
    try {
      await calendar.disconnect(req.user!.id, !!validate(disconnectBody, req.body ?? {}).removeCalendar);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // The page sends the browser here; Google's consent screen follows, then Google sends it to the callback.
  r.get("/calendar/google/connect", requireUser, (_req, res, next) => {
    try {
      const state = randomBytes(24).toString("base64url");
      const url = calendar.connectUrl(state);
      res.setHeader("Set-Cookie", stateCookie(state, 600));
      res.redirect(302, url);
    } catch (e) {
      next(e);
    }
  });

  r.get("/calendar/google/callback", async (req, res) => {
    const back = (q: string) => res.redirect(302, `/#/calendar?${q}`);
    res.setHeader("Set-Cookie", stateCookie("", 0));
    if (!req.user) return back("error=signin");
    if (typeof req.query.error === "string") return back("error=denied");
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const expected = readCookie(req, STATE_COOKIE) ?? "";
    // The answer must come back to the browser that asked (another site can't attach its Google account to you).
    if (!state || !expected || !same(state, expected) || !code) return back("error=state");
    try {
      await calendar.finishConnect(req.user.id, code);
      back("connected=1");
    } catch (e) {
      console.warn(JSON.stringify({ level: "warn", msg: "Google Calendar connect failed", error: String((e as Error).message ?? e).slice(0, 200) }));
      back("error=failed");
    }
  });

  // Google's change notifications: answered at once; the sync runs in the worker.
  r.post("/calendar/google/webhook", async (req, res) => {
    try {
      const ok = await calendar.notified({
        channelId: req.get("x-goog-channel-id"), resourceId: req.get("x-goog-resource-id"),
        token: req.get("x-goog-channel-token"), state: req.get("x-goog-resource-state"),
      });
      res.status(ok ? 200 : 404).end();
    } catch {
      res.status(500).end();
    }
  });

  return r;
}

/** After a successful change by a signed-in user, the calendar is brought up to date (merged into one push). */
export const pushAfterChanges = (calendar: CalendarService): RequestHandler => (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD" && req.user && !req.path.startsWith("/calendar")) {
    const userId = req.user.id;
    res.on("finish", () => {
      if (res.statusCode < 400) void calendar.changed(userId).catch(() => undefined);
    });
  }
  next();
};
