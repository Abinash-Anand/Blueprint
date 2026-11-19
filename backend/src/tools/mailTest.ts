/**
 * Sends one test message with the configured mail settings and reports the result (no secrets printed).
 *   docker compose exec backend node dist/src/tools/mailTest.js you@example.com
 *   npx tsx --env-file=../.env src/tools/mailTest.ts you@example.com      (outside Docker)
 */
import { describeMail, loadMailConfig } from "../config.js";
import { createMailer } from "../modules/auth/mailer.js";

const to = process.argv[2];
if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
  console.error("Usage: mailTest <your e-mail address>");
  process.exit(2);
}
const cfg = loadMailConfig();
console.log("Mail settings:", JSON.stringify(describeMail(cfg)));
const mailer = createMailer(cfg);
try {
  if (mailer.verify) {
    await mailer.verify();
    console.log("Connected and signed in to the mail server.");
  }
  await mailer.send({ to, subject: "Blueprint test message", text: "This is a test from Blueprint. If you can read it, e-mail delivery works." });
  console.log(cfg.transport === "smtp" ? "Sent. Check the inbox (and the spam folder)." : `Written to ${cfg.outboxDir} (no SMTP configured).`);
} catch (e) {
  const err = e as { code?: string; responseCode?: number };
  // Only the error code: server messages can echo the login name.
  console.error("Failed:", err.code ?? "unknown error", err.responseCode ?? "");
  if (err.code === "EAUTH") console.error("The server refused the login: check SMTP_USER and SMTP_PASS (for Gmail an app password, not your normal password).");
  if (err.code === "ETIMEDOUT" || err.code === "ECONNECTION" || err.code === "ESOCKET") console.error("Could not reach the server: check SMTP_HOST and SMTP_PORT, and that the network allows outgoing mail.");
  process.exit(1);
}
