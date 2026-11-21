/**
 * Outgoing e-mail (verification, password reset, notices). Three transports:
 *  - smtp: any SMTP server (Gmail with an app password, a transactional provider, your own server). TLS is required:
 *    port 465 uses TLS from the start, other ports must upgrade with STARTTLS or the message is not sent.
 *  - brevo: Brevo's transactional e-mail API over HTTPS, for hosts that block SMTP ports (Render's free web services
 *    block 25, 465 and 587). The sender (MAIL_FROM) must be a sender verified in the Brevo account.
 *  - file: writes each message as a text file into MAIL_OUTBOX_DIR (git-ignored), for local use and tests. Links in
 *    these files are one-time secrets, so the folder must stay private.
 * Message bodies, addresses and credentials are never logged.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTransport } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { type MailConfig, mailAddress } from "../../config.js";

const BREVO_API = "https://api.brevo.com/v3";

export interface Mail { to: string; subject: string; text: string }
export interface Mailer {
  send(m: Mail): Promise<void>;
  /** Checks that the server accepts the connection and the login (start-up and the test command). */
  verify?(): Promise<void>;
  sent?: Mail[];
}

export function createMailer(cfg: MailConfig): Mailer {
  if (cfg.transport === "brevo" && cfg.brevo) return brevoMailer(cfg.brevo.apiKey, cfg.from);
  if (cfg.transport === "smtp" && cfg.smtp) {
    const s = cfg.smtp;
    // A slow mail server must not hold a sign-up request for minutes.
    const timeouts = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 };
    const options: SMTPTransport.Options =
      "url" in s
        ? { ...timeouts }
        : { ...timeouts, host: s.host, port: s.port, secure: s.secure, requireTLS: !s.secure, ...(s.user ? { auth: { user: s.user, pass: s.pass ?? "" } } : {}) };
    const t = "url" in s ? createTransport(s.url, { ...timeouts } as SMTPTransport.Options) : createTransport(options);
    return {
      send: async (m) => void (await t.sendMail({ from: cfg.from, ...m })),
      verify: async () => void (await t.verify()),
    };
  }
  return {
    async send(m) {
      await mkdir(cfg.outboxDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safe = m.to.replace(/[^a-z0-9@._-]/gi, "_").slice(0, 80);
      await writeFile(join(cfg.outboxDir, `${stamp}-${safe}.txt`), `From: ${cfg.from}\nTo: ${m.to}\nSubject: ${m.subject}\n\n${m.text}\n`, { mode: 0o600 });
      console.log(JSON.stringify({ level: "info", msg: "Mail written to the local outbox", subject: m.subject }));
    },
  };
}

/**
 * Brevo's transactional API: POST /v3/smtp/email with the api-key header, 201 when accepted. Failures name only the
 * status and Brevo's error code, never the message or the addresses. The start-up check reads the account (GET
 * /v3/account), which confirms the key without sending anything.
 */
export function brevoMailer(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): Mailer {
  const sender = mailAddress(from);
  const call = async (path: string, init: RequestInit = {}) => {
    const r = await fetchImpl(`${BREVO_API}${path}`, {
      ...init,
      headers: { "api-key": apiKey, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const code = await r.json().then((b: { code?: unknown }) => (typeof b?.code === "string" ? b.code : null), () => null);
      throw Object.assign(new Error(`Brevo answered ${r.status}${code ? ` (${code})` : ""}`), { code: code ?? `HTTP_${r.status}` });
    }
    return r;
  };
  return {
    send: async (m) => {
      await call("/smtp/email", {
        method: "POST",
        body: JSON.stringify({ sender: { email: sender.email, ...(sender.name ? { name: sender.name } : {}) }, to: [{ email: m.to }], subject: m.subject, textContent: m.text }),
      });
    },
    verify: async () => void (await call("/account")),
  };
}

/** For tests: keeps messages in memory; `fail` makes every send throw (delivery failures). */
export function memoryMailer(opts: { fail?: boolean } = {}): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return {
    sent,
    send: async (m) => {
      if (opts.fail) throw new Error("SMTP unavailable");
      sent.push(m);
    },
  };
}
