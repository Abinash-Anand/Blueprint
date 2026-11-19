/**
 * Accounts (docs/Sprint-Multi-User.md §auth, §GDPR). Uses the unscoped client and always filters by the user's id.
 *
 * Enumeration: registration, resend and "forgot password" answer the same whatever the address; only a correct
 * password reveals that an unverified account exists. Tokens are random, single-use, short-lived and stored hashed.
 */
import { type Prisma, type PrismaClient, type User } from "@prisma/client";
import type { AuthConfig } from "../../config.js";
import { HttpError } from "../../lib/http.js";
import type { Mailer } from "./mailer.js";
import { dummyVerify, hashPassword, newToken, normaliseEmail, tokenHash, verifyPassword } from "./security.js";

/** Policy versions the user acknowledges. Bump when the text changes; consent records keep the version agreed to. */
export const POLICY_VERSIONS = { TERMS: "2026-11-18", PRIVACY_NOTICE: "2026-11-18", AI_PROCESSING: "2026-11-18", AI_CURRICULUM: "2026-11-19" } as const;
export type ConsentPurpose = keyof typeof POLICY_VERSIONS;
/** Optional purposes can be granted and withdrawn at any time; the others are required to have an account. */
export const OPTIONAL_PURPOSES: ConsentPurpose[] = ["AI_PROCESSING", "AI_CURRICULUM"];

const VERIFY_HOURS = 24;
const RESET_MINUTES = 60;
const TOUCH_MS = 5 * 60_000;

export interface Preferences { reducedMotion?: "system" | "reduce" | "no-preference"; defaultDailyMinutes?: number; defaultDaysPerWeek?: number }

export const userDTO = (u: User) => ({
  id: u.id, name: u.name, email: u.email, emailVerified: !!u.emailVerifiedAt, timezone: u.timezone, language: u.language,
  preferences: (u.preferences ?? {}) as Preferences, onboardedAt: u.onboardedAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString(),
});
export type UserDTO = ReturnType<typeof userDTO>;

export function authService(prisma: PrismaClient, cfg: AuthConfig, mailer: Mailer, now: () => Date = () => new Date()) {
  /**
   * Sends one message. A delivery failure is logged (without address or content) and swallowed: the response stays the
   * same as for a delivered message, so it reveals nothing, and the user can request the link again.
   */
  async function deliver(m: Parameters<Mailer["send"]>[0]) {
    try {
      await mailer.send(m);
    } catch (e) {
      const code = (e as { code?: string; responseCode?: number }).code ?? (e as { responseCode?: number }).responseCode ?? "unknown";
      console.error(JSON.stringify({ level: "error", msg: "Mail delivery failed", subject: m.subject, code: String(code) }));
    }
  }
  const link = (path: string, token: string) => `${cfg.publicUrl}/#/${path}?token=${encodeURIComponent(token)}`;
  const later = (ms: number) => new Date(now().getTime() + ms);

  async function issue(userId: string, purpose: "VERIFY_EMAIL" | "RESET_PASSWORD", ttlMs: number) {
    const token = newToken();
    await prisma.$transaction([
      prisma.authToken.deleteMany({ where: { userId, purpose, usedAt: null } }), // one live token per purpose
      prisma.authToken.create({ data: { id: tokenHash(token), userId, purpose, expiresAt: later(ttlMs) } }),
    ]);
    return token;
  }

  async function consume(token: string, purpose: "VERIFY_EMAIL" | "RESET_PASSWORD") {
    const t = await prisma.authToken.findUnique({ where: { id: tokenHash(token) }, include: { user: true } });
    if (!t || t.purpose !== purpose || t.usedAt || t.expiresAt <= now())
      throw new HttpError(400, "TOKEN_INVALID", "This link is invalid or has expired. Request a new one.");
    const used = await prisma.authToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: now() } });
    if (used.count !== 1) throw new HttpError(400, "TOKEN_INVALID", "This link has already been used.");
    return t.user;
  }

  async function sendVerification(user: User) {
    const token = await issue(user.id, "VERIFY_EMAIL", VERIFY_HOURS * 3_600_000);
    await deliver({
      to: user.email,
      subject: "Confirm your e-mail address for Blueprint",
      text: `Hello ${user.name},\n\nconfirm your e-mail address to start using Blueprint:\n${link("verify-email", token)}\n\nThe link is valid for ${VERIFY_HOURS} hours. If you did not create an account, ignore this message.`,
    });
  }

  /** Cities created before accounts existed get their owner: LEGACY_OWNER_EMAIL, or else the first verified account. */
  async function claimLegacy(user: User) {
    if (cfg.legacyOwnerEmail ? user.email !== cfg.legacyOwnerEmail : (await prisma.user.count({ where: { emailVerifiedAt: { not: null }, id: { not: user.id } } })) > 0) return 0;
    const unowned = await prisma.city.findMany({ where: { ownerId: null }, select: { id: true } });
    if (!unowned.length) return 0;
    await prisma.city.updateMany({ where: { id: { in: unowned.map((c) => c.id) }, ownerId: null }, data: { ownerId: user.id } });
    // The AI notice accepted before accounts existed becomes this user's consent record (kept as legacy evidence).
    const legacy = await prisma.settings.findFirst({ where: { cityId: { in: unowned.map((c) => c.id) }, aiConsentAt: { not: null } } });
    if (legacy?.aiConsentAt) await prisma.consentRecord.create({ data: { userId: user.id, purpose: "AI_PROCESSING", policyVersion: "pre-accounts", granted: true, at: legacy.aiConsentAt } });
    console.log(JSON.stringify({ level: "info", msg: "Legacy cities claimed", count: unowned.length }));
    return unowned.length;
  }

  async function createSession(userId: string, remember: boolean) {
    const token = newToken();
    const expiresAt = remember ? later(cfg.rememberDays * 86_400_000) : later(cfg.sessionHours * 3_600_000);
    await prisma.session.create({ data: { id: tokenHash(token), userId, remember, expiresAt } });
    return { token, maxAgeSeconds: remember ? cfg.rememberDays * 86_400 : null };
  }

  return {
    async register(b: { name: string; email: string; password: string }) {
      const email = normaliseEmail(b.email);
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        await deliver({
          to: existing.email,
          subject: "Someone tried to register with your e-mail address",
          text: `Hello ${existing.name},\n\nsomeone (perhaps you) tried to create a Blueprint account with this address, but you already have one.\nSign in instead, or reset your password: ${cfg.publicUrl}/#/forgot-password\n\nIf this was not you, you can ignore this message.`,
        });
        return;
      }
      const user = await prisma.user.create({
        data: {
          email, name: b.name.trim(), passwordHash: await hashPassword(b.password),
          consents: { create: (["TERMS", "PRIVACY_NOTICE"] as const).map((purpose) => ({ purpose, policyVersion: POLICY_VERSIONS[purpose], granted: true })) },
        },
      });
      if (cfg.requireVerifiedEmail) await sendVerification(user);
      else {
        await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now() } });
        await claimLegacy({ ...user, emailVerifiedAt: now() });
      }
    },

    async verifyEmail(token: string) {
      const user = await consume(token, "VERIFY_EMAIL");
      const u = user.emailVerifiedAt ? user : await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now() } });
      await claimLegacy(u);
    },

    async resendVerification(emailInput: string) {
      const user = await prisma.user.findUnique({ where: { email: normaliseEmail(emailInput) } });
      if (user && !user.emailVerifiedAt) await sendVerification(user);
    },

    async login(b: { email: string; password: string; remember: boolean }) {
      const user = await prisma.user.findUnique({ where: { email: normaliseEmail(b.email) } });
      const ok = user ? await verifyPassword(user.passwordHash, b.password) : await dummyVerify(b.password);
      if (!user || !ok) throw new HttpError(401, "INVALID_CREDENTIALS", "E-mail or password is incorrect.");
      if (cfg.requireVerifiedEmail && !user.emailVerifiedAt)
        throw new HttpError(403, "EMAIL_NOT_VERIFIED", "Confirm your e-mail address first. We can send the link again.");
      const s = await createSession(user.id, b.remember);
      return { user: userDTO(user), ...s };
    },

    async logout(token: string | null) {
      if (token) await prisma.session.deleteMany({ where: { id: tokenHash(token) } });
    },

    /** The signed-in user for a cookie value, or null (expired, unknown, or deleted user). */
    async authenticate(token: string | null) {
      if (!token) return null;
      const s = await prisma.session.findUnique({ where: { id: tokenHash(token) }, include: { user: true } });
      if (!s) return null;
      if (s.expiresAt <= now() || s.createdAt < s.user.passwordChangedAt) {
        await prisma.session.deleteMany({ where: { id: s.id } });
        return null;
      }
      if (now().getTime() - s.lastSeenAt.getTime() > TOUCH_MS) await prisma.session.updateMany({ where: { id: s.id }, data: { lastSeenAt: now() } });
      return { user: s.user, sessionId: s.id };
    },

    async forgotPassword(emailInput: string) {
      const user = await prisma.user.findUnique({ where: { email: normaliseEmail(emailInput) } });
      if (!user) return;
      const token = await issue(user.id, "RESET_PASSWORD", RESET_MINUTES * 60_000);
      await deliver({
        to: user.email,
        subject: "Reset your Blueprint password",
        text: `Hello ${user.name},\n\nuse this link to choose a new password:\n${link("reset-password", token)}\n\nIt is valid for ${RESET_MINUTES} minutes and works once. If you did not ask for this, ignore this message: your password stays the same.`,
      });
    },

    async resetPassword(token: string, password: string) {
      const user = await consume(token, "RESET_PASSWORD");
      // Every existing session ends; following the e-mailed link also proves the address.
      await prisma.$transaction([
        prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), passwordChangedAt: now(), emailVerifiedAt: user.emailVerifiedAt ?? now() } }),
        prisma.session.deleteMany({ where: { userId: user.id } }),
        prisma.authToken.deleteMany({ where: { userId: user.id, purpose: "RESET_PASSWORD" } }),
      ]);
    },

    async changePassword(user: User, sessionId: string, current: string, next: string) {
      if (!(await verifyPassword(user.passwordHash, current))) throw new HttpError(400, "INVALID_PASSWORD", "The current password is incorrect.");
      await prisma.$transaction([
        prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), passwordChangedAt: now() } }),
        prisma.session.deleteMany({ where: { userId: user.id, id: { not: sessionId } } }),
      ]);
      // This session stays valid: it is re-dated after the password change.
      await prisma.session.updateMany({ where: { id: sessionId }, data: { createdAt: later(1) } });
    },

    async updateProfile(user: User, b: { name?: string; timezone?: string; language?: string; preferences?: Preferences; onboarded?: boolean }) {
      const prefs = b.preferences ? { ...((user.preferences ?? {}) as Preferences), ...b.preferences } : undefined;
      const u = await prisma.user.update({
        where: { id: user.id },
        data: {
          ...(b.name !== undefined && { name: b.name.trim() }),
          ...(b.timezone !== undefined && { timezone: b.timezone }),
          ...(b.language !== undefined && { language: b.language }),
          ...(prefs && { preferences: prefs as Prisma.InputJsonValue }),
          ...(b.onboarded && !user.onboardedAt && { onboardedAt: now() }),
        },
      });
      return userDTO(u);
    },

    async consents(userId: string) {
      const rows = await prisma.consentRecord.findMany({ where: { userId }, orderBy: [{ at: "desc" }, { id: "desc" }] });
      const current = (Object.keys(POLICY_VERSIONS) as ConsentPurpose[]).map((purpose) => {
        const r = rows.find((x) => x.purpose === purpose);
        return { purpose, optional: OPTIONAL_PURPOSES.includes(purpose), granted: !!r?.granted, policyVersion: r?.policyVersion ?? null, currentVersion: POLICY_VERSIONS[purpose], at: r?.at.toISOString() ?? null };
      });
      return { current, history: rows.map((r) => ({ purpose: r.purpose, granted: r.granted, policyVersion: r.policyVersion, at: r.at.toISOString() })) };
    },

    async setConsent(userId: string, purpose: ConsentPurpose, granted: boolean) {
      if (!OPTIONAL_PURPOSES.includes(purpose)) throw new HttpError(400, "CONSENT_REQUIRED", "This acknowledgement is required for an account. Delete the account instead.");
      await prisma.consentRecord.create({ data: { userId, purpose, policyVersion: POLICY_VERSIONS[purpose], granted } });
    },

    async hasConsent(userId: string, purpose: ConsentPurpose) {
      const r = await prisma.consentRecord.findFirst({ where: { userId, purpose }, orderBy: [{ at: "desc" }, { id: "desc" }] });
      return r?.granted ? r.at : null;
    },

    /** GDPR Art. 15 and 20: everything Blueprint holds about the user, machine-readable. Secrets (hashes, tokens) excluded. */
    async exportData(user: User) {
      const [sessions, consents, cities] = await Promise.all([
        prisma.session.findMany({ where: { userId: user.id }, select: { createdAt: true, lastSeenAt: true, expiresAt: true, remember: true } }),
        prisma.consentRecord.findMany({ where: { userId: user.id }, orderBy: { at: "asc" }, select: { purpose: true, policyVersion: true, granted: true, at: true } }),
        prisma.city.findMany({
          where: { ownerId: user.id },
          include: {
            settings: true, weeklyTargets: true, versions: true, stages: true,
            districts: { include: { topics: { include: { subtopics: true } } } },
            tasks: true, sessions: true, prompts: { where: { source: "LEARNER" } }, schedules: true, attempts: true, checkpoints: true, evaluations: true,
          },
        }),
      ]);
      return {
        format: "blueprint-export", formatVersion: 1, exportedAt: now().toISOString(),
        account: userDTO(user), sessions, consents, cities,
      };
    },

    /** GDPR Art. 17. Deletes the account and everything it owns; keeps only the id in DeletedAccount (no personal data). */
    async deleteAccount(user: User, password: string) {
      if (!(await verifyPassword(user.passwordHash, password))) throw new HttpError(400, "INVALID_PASSWORD", "The password is incorrect.");
      await prisma.$transaction([
        prisma.deletedAccount.create({ data: { userId: user.id } }),
        prisma.user.delete({ where: { id: user.id } }), // cascades: sessions, tokens, consents, cities and all their data
      ]);
      console.log(JSON.stringify({ level: "info", msg: "Account deleted" }));
    },

    /** Start-up housekeeping: expired sessions and tokens go. */
    async cleanup() {
      const [s, t] = await prisma.$transaction([
        prisma.session.deleteMany({ where: { expiresAt: { lt: now() } } }),
        prisma.authToken.deleteMany({ where: { OR: [{ expiresAt: { lt: now() } }, { usedAt: { not: null } }] } }),
      ]);
      return { sessions: s.count, tokens: t.count };
    },
  };
}
export type AuthService = ReturnType<typeof authService>;
