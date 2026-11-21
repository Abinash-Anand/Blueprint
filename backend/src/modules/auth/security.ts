/**
 * Authentication primitives (docs/Sprint-Multi-User.md §auth): Argon2id passwords, random opaque tokens stored only
 * as SHA-256 hashes, the session cookie, and in-memory rate limits.
 */
import { createHash, randomBytes } from "node:crypto";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import type { Request, Response } from "express";
import { HttpError } from "../../lib/http.js";

/** OWASP baseline for Argon2id: 19 MiB memory, 2 iterations, 1 lane. */
const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, ARGON);
export async function verifyPassword(hashed: string, password: string) {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}
/** Verifying against this keeps the response time the same whether or not the account exists. */
let dummy: Promise<string> | null = null;
export const dummyVerify = async (password: string) => {
  dummy ??= hashPassword("not-a-real-password-just-timing");
  await verifyPassword(await dummy, password);
  return false;
};

export const newToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/* ---------------- session cookie ---------------- */

export const cookieName = (secure: boolean) => (secure ? "__Host-bp_session" : "bp_session");

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim();
      return /^[A-Za-z0-9_-]{20,100}$/.test(v) ? v : null;
    }
  }
  return null;
}

/** HttpOnly, SameSite=Lax, Path=/, Secure when configured; a "remember me" session persists, otherwise browser-session only. */
export function setSessionCookie(res: Response, secure: boolean, token: string, maxAgeSeconds: number | null) {
  const attrs = [`${cookieName(secure)}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", ...(secure ? ["Secure"] : []), ...(maxAgeSeconds ? [`Max-Age=${maxAgeSeconds}`] : [])];
  res.append("Set-Cookie", attrs.join("; "));
}
export function clearSessionCookie(res: Response, secure: boolean) {
  res.append("Set-Cookie", [`${cookieName(secure)}=`, "Path=/", "HttpOnly", "SameSite=Lax", ...(secure ? ["Secure"] : []), "Max-Age=0"].join("; "));
}

/* ---------------- rate limits (single instance; see the deployment guide for several) ---------------- */

export function rateLimiter(now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return {
    /** Throws 429 when `key` was used `max` times within `windowMs`. */
    take(key: string, max: number, windowMs: number) {
      const t = now();
      const xs = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (xs.length >= max) {
        const retry = Math.ceil((windowMs - (t - xs[0])) / 1000);
        throw new HttpError(429, "TOO_MANY_REQUESTS", `Too many attempts. Try again in ${Math.ceil(retry / 60)} minute(s).`, { retryAfterSeconds: retry });
      }
      xs.push(t);
      hits.set(key, xs);
      if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
    },
    reset() {
      hits.clear();
    },
  };
}
export type RateLimiter = ReturnType<typeof rateLimiter>;

/** Client address for rate limits: Nginx sets X-Real-IP; otherwise the socket address. */
/**
 * The client's address for sign-in limits: Express's req.ip, which reads X-Forwarded-For only as far as the trusted
 * proxies go (app "trust proxy", TRUST_PROXY). Not X-Real-IP: no proxy here sets it, so a client could choose it and
 * walk past the limits, and without it every visitor looked like the proxy and shared one limit.
 */
export const clientIp = (req: Request) => (req.ip || req.socket.remoteAddress || "unknown").slice(0, 64);

/* ---------------- input rules ---------------- */

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const normaliseEmail = (e: string) => e.trim().toLowerCase();
