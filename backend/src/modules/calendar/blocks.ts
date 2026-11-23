/**
 * What a study block looks like in Google Calendar (docs/Google-Calendar-MVP-Plan.md §3), worked out in code only:
 * one event per city and day, starting at the chosen time in the city's time zone and lasting the day's planned
 * minutes, with the tasks in the description and Blueprint's markers in private extended properties.
 */
import { createHash } from "node:crypto";
import type { ISODate } from "../../domain/dates.js";
import type { EventBody, EventTime } from "./google.js";

export interface DayTask { title: string; minutes: number; done: boolean }

/** "3 h 45 min", "2 h", "45 min". */
export function hm(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** A local wall-clock time `minute` minutes after midnight of `day` (past midnight rolls into the next day). */
function wallClock(day: ISODate, minute: number) {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCMinutes(minute);
  return `${t.toISOString().slice(0, 10)}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:00`;
}

/** The event for a city's day, or null when nothing is planned that day. */
export function blockBody(o: { cityId: string; cityName: string; day: ISODate; timeZone: string; startMinute: number; tasks: DayTask[] }): EventBody | null {
  const total = o.tasks.reduce((s, t) => s + t.minutes, 0);
  if (!o.tasks.length || total <= 0) return null;
  const lines = o.tasks.map((t) => `${t.done ? "✓" : "•"} ${t.title} · ${hm(t.minutes)}`);
  return {
    summary: `${o.cityName} · ${hm(total)}`,
    description: `${lines.join("\n")}\n\nPlanned by Blueprint. Move this block to another time or day and Blueprint follows.`,
    start: { dateTime: wallClock(o.day, o.startMinute), timeZone: o.timeZone },
    end: { dateTime: wallClock(o.day, o.startMinute + total), timeZone: o.timeZone },
    extendedProperties: { private: { bp: "1", bpCity: o.cityId, bpDay: o.day } },
  };
}

/** What was written, as a short hash: an unchanged block is never written again. */
export const hashBody = (b: EventBody) => createHash("sha256").update(JSON.stringify([b.summary, b.description, b.start, b.end])).digest("hex").slice(0, 32);

/** The local day and minute an event starts at in `timeZone`; minute is null for an all-day event. */
export function localStart(t: EventTime | undefined, timeZone: string): { day: ISODate; minute: number | null } | null {
  if (t?.date) return { day: t.date as ISODate, minute: null };
  if (!t?.dateTime) return null;
  // A wall-clock time without an offset is already local to the event's own zone.
  if (!/(Z|[+-]\d\d:\d\d)$/.test(t.dateTime)) {
    const [d, time] = t.dateTime.split("T");
    const [h, m] = time.split(":").map(Number);
    return { day: d as ISODate, minute: h * 60 + m };
  }
  const at = new Date(t.dateTime);
  if (Number.isNaN(at.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(at).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}` as ISODate, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}
