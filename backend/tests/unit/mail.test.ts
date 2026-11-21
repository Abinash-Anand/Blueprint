/** Mail settings: outbox by default, SMTP from separate fields or a URL, TLS by port, no password in descriptions. */
import { describe, expect, it } from "vitest";
import { describeMail, loadMailConfig, mailAddress } from "../../src/config.js";
import { brevoMailer, createMailer } from "../../src/modules/auth/mailer.js";

describe("mail settings", () => {
  it("writes to the local outbox when no SMTP server is configured", () => {
    expect(loadMailConfig({})).toMatchObject({ transport: "file", smtp: null, outboxDir: "mail-outbox" });
  });

  it("uses SMTP from separate fields, with TLS chosen by port", () => {
    const gmail = loadMailConfig({ SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "465", SMTP_USER: "me@gmail.com", SMTP_PASS: "abcd efgh ijkl mnop" });
    expect(gmail).toMatchObject({ transport: "smtp", smtp: { host: "smtp.gmail.com", port: 465, secure: true, user: "me@gmail.com", pass: "abcdefghijklmnop" }, from: "Blueprint <me@gmail.com>" });
    expect(loadMailConfig({ SMTP_HOST: "smtp.example.com", SMTP_USER: "u", SMTP_PASS: "p" }).smtp).toMatchObject({ port: 587, secure: false });
    expect(loadMailConfig({ SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p", MAIL_FROM: "Blueprint <a@b.c>" }).from).toBe("Blueprint <a@b.c>");
    expect(loadMailConfig({ SMTP_URL: "smtps://u:p@h:465" }).smtp).toEqual({ url: "smtps://u:p@h:465" });
  });

  it("refuses incomplete settings instead of failing at the first sign-up", () => {
    expect(() => loadMailConfig({ SMTP_HOST: "h", SMTP_USER: "u" })).toThrow(/SMTP_PASS/);
    expect(() => loadMailConfig({ MAIL_TRANSPORT: "smtp" })).toThrow(/SMTP_HOST/);
    expect(() => loadMailConfig({ SMTP_HOST: "h", SMTP_PORT: "99999" })).toThrow(/SMTP_PORT/);
    expect(() => loadMailConfig({ MAIL_TRANSPORT: "pigeon" })).toThrow(/MAIL_TRANSPORT/);
  });

  it("never describes the password", () => {
    const d = JSON.stringify(describeMail(loadMailConfig({ SMTP_HOST: "smtp.gmail.com", SMTP_USER: "me@gmail.com", SMTP_PASS: "secretpassword1" })));
    expect(d).toBe('{"mail":"smtp","host":"smtp.gmail.com","port":587}');
    expect(JSON.stringify(describeMail(loadMailConfig({ SMTP_URL: "smtps://u:secret@h" })))).not.toContain("secret");
  });

  it("gives SMTP mailers a connection check and the outbox none", () => {
    expect(typeof createMailer(loadMailConfig({ SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p" })).verify).toBe("function");
    expect(createMailer(loadMailConfig({})).verify).toBeUndefined();
  });
});

describe("Brevo (an e-mail API for hosts that block SMTP ports)", () => {
  it("is chosen by its key, needs a real sender, and never names the key in descriptions", () => {
    const cfg = loadMailConfig({ BREVO_API_KEY: "xkeysib-secret", MAIL_FROM: "Blueprint <me@gmail.com>", SMTP_HOST: "smtp.gmail.com" });
    expect(cfg).toMatchObject({ transport: "brevo", brevo: { apiKey: "xkeysib-secret" }, from: "Blueprint <me@gmail.com>" });
    expect(JSON.stringify(describeMail(cfg))).toBe('{"mail":"brevo"}');
    // The SMTP account doubles as the sender when MAIL_FROM is not set.
    expect(loadMailConfig({ MAIL_TRANSPORT: "brevo", BREVO_API_KEY: "k", SMTP_USER: "me@gmail.com" }).from).toBe("Blueprint <me@gmail.com>");
    expect(() => loadMailConfig({ MAIL_TRANSPORT: "brevo" })).toThrow(/BREVO_API_KEY/);
    expect(() => loadMailConfig({ BREVO_API_KEY: "k" })).toThrow(/MAIL_FROM/);
  });

  it("reads a sender with or without a name", () => {
    expect(mailAddress("Blueprint <me@gmail.com>")).toEqual({ name: "Blueprint", email: "me@gmail.com" });
    expect(mailAddress('"Blue Print" <a@b.c>')).toEqual({ name: "Blue Print", email: "a@b.c" });
    expect(mailAddress("me@gmail.com")).toEqual({ name: null, email: "me@gmail.com" });
  });

  it("sends with the api-key header and checks the key by reading the account", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(url.endsWith("/account") ? "{}" : '{"messageId":"<1@x>"}', { status: url.endsWith("/account") ? 200 : 201 });
    }) as unknown as typeof fetch;
    const m = brevoMailer("xkeysib-secret", "Blueprint <me@gmail.com>", fake);
    await m.send({ to: "ada@example.test", subject: "Confirm your e-mail", text: "Open the link." });
    await m.verify!();
    expect(calls[0].url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(calls[0].init).toMatchObject({ method: "POST", headers: { "api-key": "xkeysib-secret", "content-type": "application/json" } });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      sender: { email: "me@gmail.com", name: "Blueprint" }, to: [{ email: "ada@example.test" }], subject: "Confirm your e-mail", textContent: "Open the link.",
    });
    expect(calls[1].url).toBe("https://api.brevo.com/v3/account");
  });

  it("fails with Brevo's status and error code only", async () => {
    const fake = (async () => new Response('{"code":"unauthorized","message":"Key not found"}', { status: 401 })) as unknown as typeof fetch;
    const err = await brevoMailer("bad", "me@gmail.com", fake).send({ to: "ada@example.test", subject: "s", text: "t" }).catch((e: Error & { code?: string }) => e);
    expect(err).toMatchObject({ message: "Brevo answered 401 (unauthorized)", code: "unauthorized" });
  });
});
