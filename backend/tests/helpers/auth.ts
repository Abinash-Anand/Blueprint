/** Integration-test helpers: a verified user with a real session, owning a city, and requests that carry both. */
import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { hashPassword, newToken, tokenHash } from "../../src/modules/auth/security.js";

export const TEST_PASSWORD = "correct horse battery staple";

/** Creates (or reuses) a verified user, gives them the city if it is unowned, and opens a session. */
export async function signIn(prisma: PrismaClient, opts: { email?: string; cityId?: string; name?: string } = {}) {
  const email = opts.email ?? "learner@example.test";
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: opts.name ?? "Learner", passwordHash: await hashPassword(TEST_PASSWORD), emailVerifiedAt: new Date() },
  });
  const cityId = opts.cityId ?? "engineering";
  await prisma.city.updateMany({ where: { id: cityId, ownerId: null }, data: { ownerId: user.id } });
  const token = newToken();
  await prisma.session.create({ data: { id: tokenHash(token), userId: user.id, expiresAt: new Date("2099-01-01T00:00:00Z") } });
  return { user, token, headers: { Cookie: `bp_session=${token}`, "X-City-Id": cityId } as Record<string, string> };
}

type App = Parameters<typeof request>[0];
/** supertest with headers on every request (session cookie and city). `headers` may be filled in later (beforeAll). */
export const asUser = (app: App, headers: Record<string, string>) => {
  const t = request(app);
  return {
    get: (u: string) => t.get(u).set(headers),
    post: (u: string) => t.post(u).set(headers),
    patch: (u: string) => t.patch(u).set(headers),
    put: (u: string) => t.put(u).set(headers),
    delete: (u: string) => t.delete(u).set(headers),
  };
};
