/** Calendar sync pieces worked out in code: token encryption, block layout, local times, settings. */
import { describe, expect, it } from "vitest";
import { blockBody, hashBody, hm, localStart } from "../../src/modules/calendar/blocks.js";
import { decrypt, encrypt, parseKey } from "../../src/modules/calendar/crypto.js";
import { loadCalendarConfig } from "../../src/modules/calendar/google.js";
import { backoffMs } from "../../src/modules/calendar/service.js";

describe("calendar sync, in code", () => {
  it("encrypts tokens so a changed value fails instead of decrypting to something else", () => {
    const key = Buffer.alloc(32, 3);
    const a = encrypt(key, "refresh-token");
    expect(a).not.toContain("refresh-token");
    expect(encrypt(key, "refresh-token")).not.toBe(a);
    expect(decrypt(key, a)).toBe("refresh-token");
    const parts = a.split(".");
    parts[3] = Buffer.from("other").toString("base64url");
    expect(() => decrypt(key, parts.join("."))).toThrow();
    expect(() => decrypt(Buffer.alloc(32, 4), a)).toThrow();
    expect(() => parseKey("c2hvcnQ=")).toThrow(/32 bytes/);
    expect(parseKey(Buffer.alloc(32).toString("base64"))!.length).toBe(32);
  });

  it("lays a day out as one block at the start time, as long as the day's work, past midnight if need be", () => {
    const b = blockBody({ cityId: "c1", cityName: "Angular City", day: "2026-11-23", timeZone: "Europe/Berlin", startMinute: 22 * 60 + 30,
      tasks: [{ title: "Signals", minutes: 90, done: true }, { title: "Effects", minutes: 45, done: false }] })!;
    expect(b.summary).toBe("Angular City · 2 h 15 min");
    expect(b.start).toEqual({ dateTime: "2026-11-23T22:30:00", timeZone: "Europe/Berlin" });
    expect(b.end).toEqual({ dateTime: "2026-11-24T00:45:00", timeZone: "Europe/Berlin" });
    expect(b.description!.split("\n").slice(0, 2)).toEqual(["✓ Signals · 1 h 30 min", "• Effects · 45 min"]);
    expect(b.extendedProperties!.private).toEqual({ bp: "1", bpCity: "c1", bpDay: "2026-11-23" });
    expect(blockBody({ cityId: "c1", cityName: "x", day: "2026-11-23", timeZone: "UTC", startMinute: 0, tasks: [] })).toBeNull();
    expect(hashBody(b)).toBe(hashBody({ ...b }));
    expect(hm(60)).toBe("1 h");
  });

  it("reads where an event starts in the city's time zone", () => {
    expect(localStart({ dateTime: "2026-11-23T07:30:00", timeZone: "Europe/Berlin" }, "Europe/Berlin")).toEqual({ day: "2026-11-23", minute: 450 });
    // Google answers with an offset: 23:30 UTC is already the next day in Berlin.
    expect(localStart({ dateTime: "2026-11-23T23:30:00Z" }, "Europe/Berlin")).toEqual({ day: "2026-11-24", minute: 30 });
    expect(localStart({ date: "2026-11-25" }, "Europe/Berlin")).toEqual({ day: "2026-11-25", minute: null });
    expect(localStart(undefined, "UTC")).toBeNull();
  });

  it("is on only with the Google client and a key; uses webhooks only on a public https address", () => {
    const key = Buffer.alloc(32).toString("base64");
    expect(loadCalendarConfig({}, "http://localhost", parseKey).enabled).toBe(false);
    expect(loadCalendarConfig({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" }, "http://localhost", parseKey).enabled).toBe(false);
    const local = loadCalendarConfig({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s", CALENDAR_TOKEN_KEY: key }, "http://localhost:80/", parseKey);
    expect(local).toMatchObject({ enabled: true, webhookUrl: null, redirectUri: "http://localhost/api/calendar/google/callback" });
    const render = loadCalendarConfig({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s", CALENDAR_TOKEN_KEY: key }, "https://blueprint-client.onrender.com", parseKey);
    expect(render.webhookUrl).toBe("https://blueprint-client.onrender.com/api/calendar/google/webhook");
    expect(loadCalendarConfig({ GOOGLE_CALENDAR_FAKE: "true" }, "http://localhost:5173", parseKey)).toMatchObject({ enabled: true, fake: true });
  });

  it("backs off 30 s, 1 min, 2 min … up to an hour, with jitter", () => {
    expect(backoffMs(1)).toBeGreaterThanOrEqual(22_500);
    expect(backoffMs(1)).toBeLessThanOrEqual(37_500);
    expect(backoffMs(20)).toBeLessThanOrEqual(4_500_000);
  });
});

describe("the request log", () => {
  it("never records OAuth codes, states or one-time tokens", async () => {
    const { logPath } = await import("../../src/lib/http.js");
    expect(logPath("/api/calendar/google/callback?code=4/abc&state=xyz")).toBe("/api/calendar/google/callback?code=%E2%80%A6&state=%E2%80%A6");
    expect(logPath("/api/auth/verify?token=secret&x=1")).toBe("/api/auth/verify?token=%E2%80%A6&x=1");
    expect(logPath("/api/calendar")).toBe("/api/calendar");
  });
});
