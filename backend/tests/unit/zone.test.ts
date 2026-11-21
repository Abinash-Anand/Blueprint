/** "Today" in the city's own time zone (lib/zone.ts), Europe/Berlin outside a city. */
import { describe, expect, it } from "vitest";
import { dateIn } from "../../src/domain/dates.js";
import { systemClock } from "../../src/lib/clock.js";
import { currentTimeZone, withTimeZone } from "../../src/lib/zone.js";

describe("today per time zone", () => {
  it("counts today in the zone of the work at hand, and in Europe/Berlin outside it", async () => {
    const clock = systemClock();
    expect(clock.today()).toBe(dateIn("Europe/Berlin", new Date()));
    // UTC+14 and UTC−11 are always on different calendar days.
    const east = withTimeZone("Pacific/Kiritimati", () => clock.today());
    const west = withTimeZone("Pacific/Pago_Pago", () => clock.today());
    expect(east).not.toBe(west);
    expect(east).toBe(dateIn("Pacific/Kiritimati", new Date()));
    // Carries through awaits, as a request's handlers and background jobs do.
    expect(await withTimeZone("Asia/Tokyo", async () => { await Promise.resolve(); return currentTimeZone(); })).toBe("Asia/Tokyo");
  });

  it("falls back to Europe/Berlin for a missing or unknown zone", () => {
    expect(withTimeZone(null, currentTimeZone)).toBe("Europe/Berlin");
    expect(withTimeZone("Mars/Olympus", currentTimeZone)).toBe("Europe/Berlin");
  });
});
