/**
 * Request context: the signed-in user (session cookie) and the city a request works in (`X-City-Id` header, checked
 * against the owner on every request). Learning routes get `req.db`, a client scoped to that city (lib/cityScope.ts).
 */
import type { City, PrismaClient, User } from "@prisma/client";
import type { RequestHandler } from "express";
import type { AuthService } from "../modules/auth/service.js";
import { cookieName, readCookie } from "../modules/auth/security.js";
import { cityScoped } from "./cityScope.js";
import { HttpError } from "./http.js";
import { withTimeZone } from "./zone.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
    sessionId?: string;
    city?: City;
    /** City-scoped database client (set by requireCity). */
    db: PrismaClient;
  }
}

export const authenticate = (auth: AuthService, secure: boolean): RequestHandler => async (req, _res, next) => {
  try {
    const s = await auth.authenticate(readCookie(req, cookieName(secure)));
    if (s) {
      req.user = s.user;
      req.sessionId = s.sessionId;
    }
    next();
  } catch (e) {
    next(e);
  }
};

export const requireUser: RequestHandler = (req, _res, next) =>
  next(req.user ? undefined : new HttpError(401, "AUTH_REQUIRED", "Sign in to continue."));

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const CITY_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;

/**
 * The city named by `X-City-Id`, owned by the signed-in user. Someone else's city answers exactly like a missing one
 * (404), so ids cannot be probed. Archived cities are read-only; draft cities have no curriculum yet.
 */
export const requireCity = (prisma: PrismaClient): RequestHandler => async (req, _res, next) => {
  try {
    if (!req.user) throw new HttpError(401, "AUTH_REQUIRED", "Sign in to continue.");
    const id = req.get("x-city-id") ?? "";
    if (!CITY_ID.test(id)) throw new HttpError(400, "CITY_REQUIRED", "Choose a city first.");
    const city = await prisma.city.findFirst({ where: { id, ownerId: req.user.id } });
    if (!city) throw new HttpError(404, "CITY_NOT_FOUND", "City not found");
    if (city.status === "DRAFT") throw new HttpError(409, "CITY_NOT_READY", "This city has no approved curriculum yet.");
    if (city.status === "ARCHIVED" && !SAFE.has(req.method)) throw new HttpError(409, "CITY_ARCHIVED", "This city is archived. Restore it to make changes.");
    req.city = city;
    req.db = cityScoped(prisma, city.id);
    // The rest of the request counts "today" in this city's time zone.
    const settings = await prisma.settings.findUnique({ where: { cityId: city.id }, select: { timezone: true } });
    withTimeZone(settings?.timezone, () => next());
  } catch (e) {
    next(e);
  }
};
