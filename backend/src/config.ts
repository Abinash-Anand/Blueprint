export interface AuthConfig {
  /** Set the session cookie's Secure flag (required behind HTTPS in production; the local app runs on http). */
  cookieSecure: boolean;
  /** Public base URL used in e-mail links, e.g. https://blueprint.example.com (no trailing slash). */
  publicUrl: string;
  /** Sign-in requires a verified e-mail address. */
  requireVerifiedEmail: boolean;
  /** Only this address may claim cities created before accounts existed; empty = the first verified account. */
  legacyOwnerEmail: string | null;
  mail: MailConfig;
  /** Session lifetimes. */
  sessionHours: number;
  rememberDays: number;
}

/**
 * Outgoing mail. SMTP is configured either as one URL (SMTP_URL) or as separate fields (SMTP_HOST, SMTP_PORT,
 * SMTP_SECURE, SMTP_USER, SMTP_PASS), which avoids URL-encoding a password. Without SMTP, mail goes to the outbox folder.
 */
export interface MailConfig {
  transport: "smtp" | "file";
  smtp: { url: string } | { host: string; port: number; secure: boolean; user: string | null; pass: string | null } | null;
  from: string;
  outboxDir: string;
}

export interface Config {
  port: number;
  /** Reverse proxies in front of the API (see trustProxyHops). */
  trustProxy: number;
  databaseUrl: string;
  appToday?: string;
  production: boolean;
  auth: AuthConfig;
}

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === "" ? d : v === "true");

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const production = env.NODE_ENV === "production" && env.APP_ENV !== "local";
  const mail = loadMailConfig(env);
  return {
    cookieSecure: bool(env.COOKIE_SECURE, production),
    publicUrl: (env.PUBLIC_URL?.trim() || "http://localhost").replace(/\/+$/, ""),
    requireVerifiedEmail: bool(env.REQUIRE_EMAIL_VERIFICATION, true),
    legacyOwnerEmail: env.LEGACY_OWNER_EMAIL?.trim().toLowerCase() || null,
    mail,
    sessionHours: Number(env.SESSION_HOURS ?? 12),
    rememberDays: Number(env.SESSION_REMEMBER_DAYS ?? 30),
  };
}

export function loadMailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig {
  const url = env.SMTP_URL?.trim() || null;
  const host = env.SMTP_HOST?.trim() || null;
  const transport = (env.MAIL_TRANSPORT?.trim() || (url || host ? "smtp" : "file")) as "smtp" | "file";
  if (transport !== "smtp" && transport !== "file") throw new Error(`Unknown MAIL_TRANSPORT: ${transport}`);
  let smtp: MailConfig["smtp"] = null;
  if (transport === "smtp") {
    if (url) smtp = { url };
    else if (host) {
      const port = Number(env.SMTP_PORT?.trim() || 587);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid SMTP_PORT: ${env.SMTP_PORT}`);
      const user = env.SMTP_USER?.trim() || null;
      // App passwords are often shown in groups ("abcd efgh ijkl mnop"); spaces are never part of them.
      const pass = env.SMTP_PASS?.replace(/\s+/g, "") || null;
      if (user && !pass) throw new Error("SMTP_USER is set but SMTP_PASS is empty");
      // 465 = TLS from the start; 587 = STARTTLS (upgraded and required below).
      smtp = { host, port, secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465, user, pass };
    } else throw new Error("MAIL_TRANSPORT=smtp needs SMTP_HOST (or SMTP_URL)");
  }
  const user = smtp && "user" in smtp ? smtp.user : null;
  return {
    transport,
    smtp,
    // The sender must be an address the SMTP account may send as (for Gmail: the account itself).
    from: env.MAIL_FROM?.trim() || (user ? `Blueprint <${user}>` : "Blueprint <no-reply@localhost>"),
    outboxDir: env.MAIL_OUTBOX_DIR?.trim() || "mail-outbox",
  };
}

/** Where mail goes, for logs: never the password. */
export const describeMail = (m: MailConfig) =>
  m.transport === "file" ? { mail: "file" } : m.smtp && "url" in m.smtp ? { mail: "smtp", via: "SMTP_URL" } : { mail: "smtp", host: (m.smtp as { host: string }).host, port: (m.smtp as { port: number }).port };

/**
 * How many reverse proxies stand in front of the API and append to X-Forwarded-For (the client's address is read
 * from there, for sign-in limits). 1 behind the bundled Nginx; behind a host's load balancer, or a static site that
 * proxies /api to it, set it to that chain's length. 0 trusts no header.
 */
export function trustProxyHops(v: string | undefined): number {
  const n = Number(v?.trim() || 1);
  if (!Number.isInteger(n) || n < 0 || n > 5) throw new Error(`TRUST_PROXY must be a whole number from 0 to 5, got "${v}"`);
  return n;
}

export function loadConfig(env = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  return {
    port: Number(env.PORT ?? 3000),
    trustProxy: trustProxyHops(env.TRUST_PROXY),
    databaseUrl,
    appToday: env.APP_TODAY || undefined,
    production: env.NODE_ENV === "production" && env.APP_ENV !== "local",
    auth: loadAuthConfig(env),
  };
}
