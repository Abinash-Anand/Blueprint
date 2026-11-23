/**
 * Token encryption at rest (docs/Google-Calendar-MVP-Plan.md §3): AES-256-GCM with a random 12-byte IV per value and
 * the authentication tag, so a changed or swapped value fails to decrypt instead of decrypting to something else.
 * Stored as "v1.<iv>.<tag>.<ciphertext>" in base64url. The key (32 bytes) comes from CALENDAR_TOKEN_KEY.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function parseKey(raw: string | undefined): Buffer | null {
  if (!raw?.trim()) return null;
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== 32) throw new Error("CALENDAR_TOKEN_KEY must be 32 bytes in base64 (for example: openssl rand -base64 32)");
  return key;
}

export function encrypt(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), body].map((x) => (typeof x === "string" ? x : x.toString("base64url"))).join(".");
}

export function decrypt(key: Buffer, stored: string): string {
  const [v, iv, tag, body] = stored.split(".");
  if (v !== "v1" || !iv || !tag || body === undefined) throw new Error("Unreadable encrypted value");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}
