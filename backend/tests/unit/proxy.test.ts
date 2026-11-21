/** Hosting behind proxies (Render): the request guard's page origin, and the client address for sign-in limits. */
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { trustProxyHops } from "../../src/config.js";
import { errorHandler } from "../../src/lib/http.js";
import { requestGuardFor } from "../../src/lib/guard.js";
import { clientIp } from "../../src/modules/auth/security.js";

const guarded = (publicUrl?: string) => {
  const app = express();
  app.use(requestGuardFor(publicUrl));
  app.post("/x", (_req, res) => void res.json({ ok: true }));
  app.use(errorHandler);
  return app;
};

describe("request guard behind a proxying frontend", () => {
  const app = guarded("https://blueprint-web.onrender.com");
  const post = (origin: string, host = "blueprint-api.onrender.com") => request(app).post("/x").set("Host", host).set("Origin", origin).set("Sec-Fetch-Site", "same-origin");

  it("accepts the page origin named by PUBLIC_URL, with the Blueprint header", async () => {
    await post("https://blueprint-web.onrender.com").set("X-Blueprint", "1").expect(200);
    await post("https://blueprint-web.onrender.com").expect(403); // no X-Blueprint
  });

  it("still refuses any other origin, and still accepts its own host", async () => {
    expect((await post("https://evil.example").set("X-Blueprint", "1").expect(403)).body.error.code).toBe("FORBIDDEN_ORIGIN");
    await post("https://blueprint-api.onrender.com").set("X-Blueprint", "1").expect(200);
  });

  it("adds nothing for a localhost PUBLIC_URL (the default)", async () => {
    await request(guarded("http://localhost")).post("/x").set("Host", "api.example").set("Origin", "http://localhost").set("X-Blueprint", "1").expect(403);
  });
});

describe("client address for sign-in limits", () => {
  const ipApp = (hops: number) => {
    const app = express();
    app.set("trust proxy", hops);
    app.get("/ip", (req, res) => void res.json({ ip: clientIp(req) }));
    return app;
  };

  it("reads X-Forwarded-For as far as the trusted proxies go, and never a client-chosen X-Real-IP", async () => {
    const xff = "203.0.113.7, 198.51.100.9";
    expect((await request(ipApp(1)).get("/ip").set("X-Forwarded-For", xff).set("X-Real-IP", "1.1.1.1")).body.ip).toBe("198.51.100.9");
    expect((await request(ipApp(2)).get("/ip").set("X-Forwarded-For", xff)).body.ip).toBe("203.0.113.7");
  });

  it("takes TRUST_PROXY as a small whole number, 1 by default", () => {
    expect(trustProxyHops(undefined)).toBe(1);
    expect(trustProxyHops("2")).toBe(2);
    expect(() => trustProxyHops("yes")).toThrow(/TRUST_PROXY/);
    expect(() => trustProxyHops("9")).toThrow(/TRUST_PROXY/);
  });
});
