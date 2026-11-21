/**
 * Authentication and account security (docs/Sprint-Multi-User.md §auth) against a real database: registration and
 * verification, enumeration-safe answers, Argon2id storage, sessions (cookie flags, logout, expiry, password change),
 * password reset, rate limits, cross-site protection, legacy-city claim. Fresh schema per run, dropped after.
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { loadAuthConfig } from "../../src/config.js";
import { TestClock } from "../../src/lib/clock.js";
import { memoryMailer } from "../../src/modules/auth/mailer.js";
import { rateLimiter } from "../../src/modules/auth/security.js";
import { seed } from "../../prisma/seed.js";

const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const schema = `it_auth_${Date.now()}`;
const url = base ? `${base}${base.includes("?") ? "&" : "?"}schema=${schema}` : "";

const PW = "a long enough password";
const linkToken = (text: string) => decodeURIComponent(/token=([A-Za-z0-9_%-]+)/.exec(text)![1]);
const cookieOf = (res: request.Response) => (res.headers["set-cookie"] as unknown as string[] | undefined)?.find((c) => c.startsWith("bp_session=")) ?? "";

suite("authentication", () => {
  let prisma: PrismaClient;
  const clock = new TestClock("2026-11-18");
  const mailer = memoryMailer();
  const limiter = rateLimiter();
  let app: ReturnType<typeof createApp>;
  const cfg = loadAuthConfig({ REQUIRE_EMAIL_VERIFICATION: "true", PUBLIC_URL: "http://localhost", MAIL_TRANSPORT: "file" });

  const lastMail = (pred: (m: { to: string; subject: string; text: string }) => boolean) => [...mailer.sent].reverse().find(pred);
  const register = (email: string, extra: Record<string, unknown> = {}) =>
    request(app).post("/api/auth/register").send({ name: "Ada", email, password: PW, passwordConfirm: PW, acceptTerms: true, acknowledgePrivacy: true, ...extra });
  const login = (email: string, password = PW, remember = false) => request(app).post("/api/auth/login").send({ email, password, remember });
  async function verified(email: string) {
    await register(email).expect(202);
    const mail = lastMail((m) => m.to === email)!;
    await request(app).post("/api/auth/verify-email").send({ token: linkToken(mail.text) }).expect(200);
  }

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = new PrismaClient({ datasourceUrl: url });
    await seed(prisma, () => {}, clock.date, { createEngineeringCity: true }); // an unowned pre-accounts city
    app = createApp({ prisma, clock, authConfig: cfg, mailer, limiter });
  });
  beforeEach(() => limiter.reset());
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  it("requires a signed-in user for every learning route", async () => {
    for (const path of ["/api/today", "/api/curriculum", "/api/revision/archive", "/api/cities", "/api/account/export"]) {
      expect((await request(app).get(path).expect(401)).body.error.code, path).toBe("AUTH_REQUIRED");
    }
    expect((await request(app).get("/api/health").expect(200)).body.status).toBe("ok");
  });

  it("registers with explicit acknowledgements, stores only an Argon2id hash and records consents with versions", async () => {
    const missing = await register("ada@example.test", { acceptTerms: false }).expect(400);
    expect(missing.body.error.code).toBe("VALIDATION_ERROR");
    await register("ada@example.test", { passwordConfirm: "different password" }).expect(400);
    await register("ada@example.test", { password: "short", passwordConfirm: "short" }).expect(400);

    const r = await register("Ada@Example.test").expect(202);
    expect(r.body.message).toMatch(/inbox/);
    expect(r.headers["set-cookie"]).toBeUndefined(); // not signed in before verifying
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "ada@example.test" }, include: { consents: true } });
    expect(u.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(u.passwordHash).not.toContain(PW);
    expect(u.emailVerifiedAt).toBeNull();
    expect(u.consents.map((c) => [c.purpose, c.granted, c.policyVersion]).sort()).toEqual([["PRIVACY_NOTICE", true, "2026-11-21"], ["TERMS", true, "2026-11-18"]]);
    // The e-mailed token is stored only as a hash.
    const token = linkToken(mailer.sent.at(-1)!.text);
    expect(await prisma.authToken.count({ where: { id: token } })).toBe(0);
    expect(await prisma.authToken.count({ where: { userId: u.id, purpose: "VERIFY_EMAIL" } })).toBe(1);
  });

  it("answers a duplicate registration exactly like a new one, and tells the owner by e-mail", async () => {
    const before = mailer.sent.length;
    const r = await register("ada@example.test").expect(202);
    expect(r.body.message).toMatch(/inbox/);
    expect(await prisma.user.count({ where: { email: "ada@example.test" } })).toBe(1);
    expect(mailer.sent.slice(before).map((m) => m.subject)).toEqual(["Someone tried to register with your e-mail address"]);
  });

  it("refuses sign-in before verification, verifies once, and the first verified account claims the pre-accounts city", async () => {
    expect((await login("ada@example.test").expect(403)).body.error.code).toBe("EMAIL_NOT_VERIFIED");
    const token = linkToken(lastMail((m) => m.subject.startsWith("Confirm"))!.text);
    await request(app).post("/api/auth/verify-email").send({ token }).expect(200);
    expect((await request(app).post("/api/auth/verify-email").send({ token }).expect(400)).body.error.code).toBe("TOKEN_INVALID");
    const ada = await prisma.user.findUniqueOrThrow({ where: { email: "ada@example.test" } });
    expect((await prisma.city.findUniqueOrThrow({ where: { id: "engineering" } })).ownerId).toBe(ada.id);
    // A second verified account does not get it.
    await verified("bob@example.test");
    expect((await prisma.city.findUniqueOrThrow({ where: { id: "engineering" } })).ownerId).toBe(ada.id);
  });

  it("gives the same answer for an unknown e-mail and a wrong password", async () => {
    const a = await login("nobody@example.test").expect(401);
    const b = await login("ada@example.test", "wrong password!!").expect(401);
    expect(a.body).toEqual(b.body);
    expect(a.body.error).toEqual({ code: "INVALID_CREDENTIALS", message: "E-mail or password is incorrect." });
  });

  it("signs in with an HttpOnly SameSite cookie, stores the session hashed, and signs out", async () => {
    const r = await login("ADA@example.test").expect(200);
    const cookie = cookieOf(r);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/Max-Age/); // without "remember me": a browser-session cookie
    expect(r.body.user).toMatchObject({ email: "ada@example.test", emailVerified: true });
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|argon2/);
    const value = cookie.split(";")[0].split("=")[1];
    expect(await prisma.session.count({ where: { id: value } })).toBe(0); // only the hash is stored
    const c = cookie.split(";")[0];
    expect((await request(app).get("/api/auth/me").set("Cookie", c).expect(200)).body.user.name).toBe("Ada");
    await request(app).post("/api/auth/logout").set("Cookie", c).expect(204);
    await request(app).get("/api/auth/me").set("Cookie", c).expect(401);
    const remembered = cookieOf(await login("ada@example.test", PW, true).expect(200));
    expect(remembered).toMatch(/Max-Age=2592000/);
  });

  it("expires sessions", async () => {
    const c = cookieOf(await login("ada@example.test").expect(200)).split(";")[0];
    await request(app).get("/api/auth/me").set("Cookie", c).expect(200);
    const day = clock.date;
    clock.date = "2026-11-20"; // past the 12-hour lifetime
    await request(app).get("/api/auth/me").set("Cookie", c).expect(401);
    clock.date = day;
  });

  it("blocks cross-site requests that carry the cookie", async () => {
    const c = cookieOf(await login("ada@example.test").expect(200)).split(";")[0];
    const r = await request(app).post("/api/auth/logout").set("Cookie", c).set("Origin", "https://evil.example").set("Host", "localhost").expect(403);
    expect(r.body.error.code).toBe("FORBIDDEN_ORIGIN");
    await request(app).get("/api/auth/me").set("Cookie", c).expect(200); // still signed in
  });

  it("resets a forgotten password with a one-time, expiring link and ends every session", async () => {
    const c = cookieOf(await login("ada@example.test").expect(200)).split(";")[0];
    const unknown = await request(app).post("/api/auth/forgot-password").send({ email: "nobody@example.test" }).expect(202);
    const known = await request(app).post("/api/auth/forgot-password").send({ email: "ada@example.test" }).expect(202);
    expect(unknown.body).toEqual(known.body);
    const token = linkToken(lastMail((m) => m.subject.startsWith("Reset"))!.text);
    const NEW = "a brand new password";
    await request(app).post("/api/auth/reset-password").send({ token, password: NEW, passwordConfirm: NEW }).expect(200);
    await request(app).post("/api/auth/reset-password").send({ token, password: NEW, passwordConfirm: NEW }).expect(400);
    await request(app).get("/api/auth/me").set("Cookie", c).expect(401);
    await login("ada@example.test").expect(401);
    await login("ada@example.test", NEW).expect(200);
    // An expired link is refused.
    await request(app).post("/api/auth/forgot-password").send({ email: "ada@example.test" }).expect(202);
    const late = linkToken(lastMail((m) => m.subject.startsWith("Reset"))!.text);
    clock.date = "2026-11-19";
    expect((await request(app).post("/api/auth/reset-password").send({ token: late, password: PW, passwordConfirm: PW }).expect(400)).body.error.code).toBe("TOKEN_INVALID");
    clock.date = "2026-11-18";
    await prisma.user.update({ where: { email: "ada@example.test" }, data: { passwordHash: (await prisma.user.findUniqueOrThrow({ where: { email: "bob@example.test" } })).passwordHash } });
  });

  it("changes the password with the current one and signs out other devices", async () => {
    const a = cookieOf(await login("ada@example.test").expect(200)).split(";")[0];
    const b = cookieOf(await login("ada@example.test").expect(200)).split(";")[0];
    const NEW = "another new password";
    await request(app).post("/api/account/password").set("Cookie", a).send({ currentPassword: "wrong one", newPassword: NEW, newPasswordConfirm: NEW }).expect(400);
    await request(app).post("/api/account/password").set("Cookie", a).send({ currentPassword: PW, newPassword: NEW, newPasswordConfirm: NEW }).expect(200);
    await request(app).get("/api/auth/me").set("Cookie", a).expect(200);
    await request(app).get("/api/auth/me").set("Cookie", b).expect(401);
    await request(app).post("/api/account/password").set("Cookie", a).send({ currentPassword: NEW, newPassword: PW, newPasswordConfirm: PW }).expect(200);
  });

  it("answers the same when mail delivery fails, so nothing is revealed and the user can ask again", async () => {
    const down = createApp({ prisma, clock, authConfig: cfg, mailer: memoryMailer({ fail: true }), limiter: rateLimiter() });
    const r = await request(down).post("/api/auth/register").send({ name: "Cy", email: "cy@example.test", password: PW, passwordConfirm: PW, acceptTerms: true, acknowledgePrivacy: true }).expect(202);
    expect(r.body.message).toMatch(/inbox/);
    expect(await prisma.user.count({ where: { email: "cy@example.test" } })).toBe(1);
    await request(down).post("/api/auth/forgot-password").send({ email: "ada@example.test" }).expect(202);
    await request(down).post("/api/auth/resend-verification").send({ email: "cy@example.test" }).expect(202);
  });

  it("rate-limits sign-in, registration and password reset", async () => {
    for (let i = 0; i < 8; i++) await login("ada@example.test", "wrong password!!").expect(401);
    const r = await login("ada@example.test", "wrong password!!").expect(429);
    expect(r.body.error.code).toBe("TOO_MANY_REQUESTS");
    await login("ada@example.test").expect(429); // even the right password, until the window passes
    limiter.reset();
    for (let i = 0; i < 3; i++) await request(app).post("/api/auth/forgot-password").send({ email: "ada@example.test" }).expect(202);
    await request(app).post("/api/auth/forgot-password").send({ email: "ada@example.test" }).expect(429);
    limiter.reset();
    for (let i = 0; i < 5; i++) await register(`spam${i}@example.test`).expect(202);
    await register("spam9@example.test").expect(429);
  });
});
