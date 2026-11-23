/** Calendar sync pieces worked out in code: token encryption, block layout, local times, settings. */
import { describe, expect, it } from "vitest";
import { hashBody, hm, layoutDay, localStart, recallBody, studyBody } from "../../src/modules/calendar/blocks.js";
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

  it("writes a study block and a recall event, each with what it holds and links into Blueprint", () => {
    const c = { cityId: "c1", cityName: "Angular City", day: "2026-11-23" as const, timeZone: "Europe/Berlin", appUrl: "https://bp.example", reminderMinutes: 10 };
    const b = studyBody({ ...c, stage: "Components", tasks: [{ title: "Signals", minutes: 90, done: true }, { title: "Effects", minutes: 45, done: false }] }, 22 * 60 + 30)!;
    expect(b.summary).toBe("Angular City · Study · 2 h 15 min");
    expect(b.start).toEqual({ dateTime: "2026-11-23T22:30:00", timeZone: "Europe/Berlin" });
    expect(b.end).toEqual({ dateTime: "2026-11-24T00:45:00", timeZone: "Europe/Berlin" });
    expect(b.description!.split("\n").slice(0, 4)).toEqual(["Stage: Components", "", "✓ Signals · 1 h 30 min", "• Effects · 45 min"]);
    expect(b.description).toContain("Open in Blueprint: https://bp.example/#/today?city=c1");
    expect(b).toMatchObject({ colorId: "7", reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] } });
    expect(b.extendedProperties!.private).toEqual({ bp: "1", bpCity: "c1", bpDay: "2026-11-23", bpKind: "STUDY" });
    expect(studyBody({ ...c, stage: null, tasks: [{ title: "x", minutes: 30, done: true }] }, 0)).toMatchObject({ summary: "✓ Angular City · Study · 30 min", colorId: "8" });
    expect(studyBody({ ...c, stage: null, tasks: [] }, 0)).toBeNull();

    const r = recallBody({ ...c, reminderMinutes: 0, items: [
      { subtopicId: 7, name: "Signals basics", topic: "Signals", minutes: 10, done: false, lastReview: "2026-11-12", overdueSince: null },
      { subtopicId: 8, name: "Guards", topic: "Router", minutes: 10, done: false, lastReview: null, overdueSince: "2026-11-20" },
      { subtopicId: 9, name: "Pipes", topic: "Templates", minutes: 10, done: true, lastReview: null, overdueSince: null },
    ] }, 18 * 60)!;
    expect(r.summary).toBe("Angular City · Recall · 3 sub-topics");
    expect(r.end!.dateTime).toBe("2026-11-23T18:30:00");
    expect(r.description!.split("\n").slice(2, 7)).toEqual([
      "1. Signals basics (Signals) · last recalled 12 Nov", "   https://bp.example/#/recall/7?city=c1",
      "2. Guards (Router) · overdue since 20 Nov", "   https://bp.example/#/recall/8?city=c1",
      "3. ✓ Pipes (Templates) · done",
    ]);
    expect(r).toMatchObject({ colorId: "3", reminders: { useDefault: false, overrides: [] } });
    expect(hashBody(b)).toBe(hashBody({ ...b }));
    expect(hashBody(b)).not.toBe(hashBody({ ...b, colorId: "8" }));
    expect(hm(60)).toBe("1 h");
  });

  it("lays a day out: each city from its own slot, nothing overlapping, around events the learner moved", () => {
    const at = (earliest: number, minutes: number, fixed: number | null = null) => ({ earliest, minutes, fixed });
    // Same start (no slots of their own): one after another.
    expect(layoutDay([at(1080, 20), at(1080, 90), at(1080, 60)])).toEqual([1080, 1100, 1190]);
    // Angular from 09:00, German from 18:00: each in its own time.
    expect(layoutDay([at(540, 10), at(540, 180), at(1080, 10), at(1080, 180)])).toEqual([540, 550, 1080, 1090]);
    // Moved to 18:30–19:30: the others go around it.
    expect(layoutDay([at(1080, 20), at(1080, 60, 1110), at(1080, 45)])).toEqual([1080, 1110, 1170]);
    expect(layoutDay([at(1080, 60, 1070), at(1080, 30)])).toEqual([1070, 1130]);
  });

  it("flags a day that holds more than the city's study time", () => {
    const c = { cityId: "c1", cityName: "Angular City", day: "2026-11-23" as const, timeZone: "Europe/Berlin", appUrl: "https://bp.example", reminderMinutes: 10 };
    const b = studyBody({ ...c, over: { minutes: 240, slot: 180 }, stage: null, tasks: [{ title: "Signals", minutes: 420, done: false }] }, 540)!;
    expect(b.summary).toBe("⚠ Angular City · Study · 7 h");
    expect(b.description!.split("\n")[0]).toBe("⚠ This day holds 7 h: 4 h more than your 3 h study time (work carried over from earlier days lands here).");
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
    expect(local).toMatchObject({ enabled: true, webhookUrl: null, appUrl: "http://localhost", redirectUri: "http://localhost/api/calendar/google/callback" });
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
