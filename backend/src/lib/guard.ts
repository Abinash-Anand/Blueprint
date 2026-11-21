/**
 * Cross-site request guard for every state-changing API route (AI design §8.2).
 *
 * The app binds to 127.0.0.1, but a web page open in the same browser can still send requests to it. Browsers send
 * `Origin` on every non-GET request, so a browser request must come from this same origin (scheme-less host:port
 * match with `Host`) and carry the `X-Blueprint: 1` header, which a cross-site page cannot add without a CORS
 * preflight (and there is no CORS). Requests without Origin or Fetch Metadata are not from a browser page (curl,
 * tests) and are allowed: a local process can reach the database anyway. No CSRF token: the app sets no cookies.
 *
 * Hosted with the frontend on another domain that proxies /api (Render: a static site rewriting /api/* to this
 * service), the request arrives with this service's own Host but the page's Origin. That one page origin, the
 * configured PUBLIC_URL, is accepted too; any other origin is still refused.
 */
import type { RequestHandler } from "express";
import { HttpError } from "./http.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** The guard, also accepting the page origin of `publicUrl` (when it names a host other than localhost). */
export const requestGuardFor = (publicUrl?: string): RequestHandler => {
  let publicHost: string | null = null;
  try {
    const u = publicUrl ? new URL(publicUrl) : null;
    publicHost = u && u.hostname !== "localhost" && u.hostname !== "127.0.0.1" ? u.host : null;
  } catch {
    publicHost = null;
  }
  return (req, res, next) => guard(req, res, next, publicHost);
};

export const requestGuard: RequestHandler = (req, res, next) => guard(req, res, next, null);

function guard(...[req, _res, next, publicHost]: [...Parameters<RequestHandler>, string | null]) {
  if (SAFE.has(req.method)) return next();
  const forbid = () => next(new HttpError(403, "FORBIDDEN_ORIGIN", "This request did not come from Blueprint itself"));
  const site = req.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return forbid();
  const origin = req.get("origin");
  if (origin === undefined) return site ? (req.get("x-blueprint") === "1" ? next() : forbid()) : next();
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return forbid();
  }
  if ((host !== req.get("host") && host !== publicHost) || req.get("x-blueprint") !== "1") return forbid();
  next();
}
