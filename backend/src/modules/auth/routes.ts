/**
 * /auth (sign-up, verification, sign-in, sign-out, password reset) and /account (profile, password, consents,
 * export, deletion). Every body is validated strictly; abuse-prone routes are rate-limited by address and e-mail.
 */
import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../../app.js";
import { validate } from "../../lib/http.js";
import { requireUser } from "../../lib/context.js";
import { POLICY_VERSIONS, userDTO } from "./service.js";
import { PASSWORD_MAX, PASSWORD_MIN, clearSessionCookie, clientIp, cookieName, normaliseEmail, readCookie, setSessionCookie } from "./security.js";

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters`).max(PASSWORD_MAX);
const token = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/, "Invalid link");
const name = z.string().trim().min(1).max(80);
const timezone = z.string().max(64).refine((tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Unknown time zone");

const registerBody = z.object({
  name, email, password, passwordConfirm: z.string(),
  // Required acknowledgements: must be explicitly true (never pre-ticked in the UI).
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "Accept the terms to create an account" }) }),
  acknowledgePrivacy: z.literal(true, { errorMap: () => ({ message: "Acknowledge the privacy notice to create an account" }) }),
}).strict().refine((b) => b.password === b.passwordConfirm, { message: "The passwords do not match", path: ["passwordConfirm"] });
const loginBody = z.object({ email, password: z.string().min(1).max(PASSWORD_MAX), remember: z.boolean().default(false) }).strict();
const emailBody = z.object({ email }).strict();
const tokenBody = z.object({ token }).strict();
const resetBody = z.object({ token, password, passwordConfirm: z.string() }).strict()
  .refine((b) => b.password === b.passwordConfirm, { message: "The passwords do not match", path: ["passwordConfirm"] });
const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(PASSWORD_MAX), newPassword: password, newPasswordConfirm: z.string() }).strict()
  .refine((b) => b.newPassword === b.newPasswordConfirm, { message: "The passwords do not match", path: ["newPasswordConfirm"] });
const profileBody = z.object({
  name: name.optional(),
  timezone: timezone.optional(),
  language: z.enum(["en", "de"]).optional(),
  onboarded: z.literal(true).optional(),
  preferences: z.object({
    reducedMotion: z.enum(["system", "reduce", "no-preference"]).optional(),
    defaultDailyMinutes: z.number().int().min(0).max(720).optional(),
    defaultDaysPerWeek: z.number().int().min(1).max(7).optional(),
  }).strict().optional(),
}).strict().refine((b) => Object.keys(b).length > 0, { message: "Provide at least one field" });
const consentBody = z.object({ purpose: z.enum(["AI_PROCESSING", "AI_CURRICULUM"]), granted: z.boolean() }).strict();
const deleteBody = z.object({ password: z.string().min(1).max(PASSWORD_MAX), confirm: z.literal("DELETE") }).strict();

const MIN = 60_000;
const GENERIC = "If the address can receive mail from us, a message is on its way. Check your inbox.";

export function authRoutes(deps: Deps) {
  const { auth: svc, authConfig: cfg, limiter } = deps;
  const r = Router();
  const secure = cfg.cookieSecure;

  r.post("/auth/register", async (req, res) => {
    limiter.take(`register:${clientIp(req)}`, 5, 60 * MIN);
    const b = validate(registerBody, req.body);
    limiter.take(`register-mail:${normaliseEmail(b.email)}`, 3, 60 * MIN);
    await svc.register(b);
    res.status(202).json({ message: cfg.requireVerifiedEmail ? "Check your inbox to confirm your e-mail address, then sign in." : "Account ready. Sign in." });
  });

  r.post("/auth/verify-email", async (req, res) => {
    limiter.take(`verify:${clientIp(req)}`, 20, 15 * MIN);
    await svc.verifyEmail(validate(tokenBody, req.body).token);
    res.json({ message: "E-mail address confirmed. You can sign in now." });
  });

  r.post("/auth/resend-verification", async (req, res) => {
    limiter.take(`resend:${clientIp(req)}`, 5, 60 * MIN);
    const { email: e } = validate(emailBody, req.body);
    limiter.take(`resend-mail:${e}`, 3, 60 * MIN);
    await svc.resendVerification(e);
    res.status(202).json({ message: GENERIC });
  });

  r.post("/auth/login", async (req, res) => {
    limiter.take(`login:${clientIp(req)}`, 20, 15 * MIN);
    const b = validate(loginBody, req.body);
    limiter.take(`login-mail:${b.email}`, 8, 15 * MIN);
    const s = await svc.login(b);
    await svc.logout(readCookie(req, cookieName(secure))); // no session fixation: an old cookie's session ends
    setSessionCookie(res, secure, s.token, s.maxAgeSeconds);
    res.json({ user: s.user });
  });

  r.post("/auth/logout", async (req, res) => {
    await svc.logout(readCookie(req, cookieName(secure)));
    clearSessionCookie(res, secure);
    res.status(204).end();
  });

  r.get("/auth/me", requireUser, async (req, res) => {
    res.json({ user: userDTO(req.user!) });
  });

  r.post("/auth/forgot-password", async (req, res) => {
    limiter.take(`forgot:${clientIp(req)}`, 5, 60 * MIN);
    const { email: e } = validate(emailBody, req.body);
    limiter.take(`forgot-mail:${e}`, 3, 60 * MIN);
    await svc.forgotPassword(e);
    res.status(202).json({ message: GENERIC });
  });

  r.post("/auth/reset-password", async (req, res) => {
    limiter.take(`reset:${clientIp(req)}`, 10, 15 * MIN);
    const b = validate(resetBody, req.body);
    await svc.resetPassword(b.token, b.password);
    clearSessionCookie(res, secure);
    res.json({ message: "Password changed. Sign in with the new password." });
  });

  /* ---------------- account (signed in) ---------------- */

  r.patch("/account", requireUser, async (req, res) => {
    res.json({ user: await svc.updateProfile(req.user!, validate(profileBody, req.body)) });
  });

  r.post("/account/password", requireUser, async (req, res) => {
    limiter.take(`password:${req.user!.id}`, 5, 15 * MIN);
    const b = validate(changePasswordBody, req.body);
    await svc.changePassword(req.user!, req.sessionId!, b.currentPassword, b.newPassword);
    res.json({ message: "Password changed. Other devices have been signed out." });
  });

  r.get("/account/consents", requireUser, async (req, res) => {
    res.json(await svc.consents(req.user!.id));
  });
  r.post("/account/consents", requireUser, async (req, res) => {
    const b = validate(consentBody, req.body);
    await svc.setConsent(req.user!.id, b.purpose, b.granted);
    res.json(await svc.consents(req.user!.id));
  });

  r.get("/account/export", requireUser, async (req, res) => {
    limiter.take(`export:${req.user!.id}`, 10, 60 * MIN);
    res.setHeader("Content-Disposition", `attachment; filename="blueprint-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(await svc.exportData(req.user!));
  });

  r.delete("/account", requireUser, async (req, res) => {
    limiter.take(`delete:${req.user!.id}`, 5, 15 * MIN);
    const b = validate(deleteBody, req.body);
    await svc.deleteAccount(req.user!, b.password);
    clearSessionCookie(res, secure);
    res.status(204).end();
  });

  r.get("/legal/versions", (_req, res) => res.json(POLICY_VERSIONS));
  return r;
}
