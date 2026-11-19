/** Mail settings: outbox by default, SMTP from separate fields or a URL, TLS by port, no password in descriptions. */
import { describe, expect, it } from "vitest";
import { describeMail, loadMailConfig } from "../../src/config.js";
import { createMailer } from "../../src/modules/auth/mailer.js";

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
