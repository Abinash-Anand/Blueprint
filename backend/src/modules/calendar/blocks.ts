/**
 * What Blueprint's events look like in Google Calendar (docs/Google-Calendar-MVP-Plan.md §3, §8), worked out in code
 * only. Per city and day there are up to two: the recalls due (each with a link that opens it in Blueprint) and the
 * study block (study and practice tasks, the stage, a link to the city). A day's events are laid out one after another
 * across cities (`layoutDay`); finished blocks get a ✓ and turn grey.
 */
import { createHash } from "node:crypto";
import type { ISODate } from "../../domain/dates.js";
import type { EventBody, EventTime } from "./google.js";

export type BlockKind = "STUDY" | "RECALL";
export interface StudyTask { title: string; minutes: number; done: boolean }
export interface RecallItem { subtopicId: number; name: string; topic: string; minutes: number; done: boolean; lastReview: ISODate | null; overdueSince: ISODate | null }
export interface Ctx { cityId: string; cityName: string; day: ISODate; timeZone: string; appUrl: string; reminderMinutes: number }

/** Google's event colours: Peacock for study, Grape for recall, Graphite once done. */
export const COLORS = { STUDY: "7", RECALL: "3", DONE: "8" } as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (iso: ISODate) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const FOOT = "Planned by Blueprint. Move this block to another time or day and Blueprint follows.";

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

function frame(c: Ctx, kind: BlockKind, startMinute: number, minutes: number, done: boolean): EventBody {
  return {
    start: { dateTime: wallClock(c.day, startMinute), timeZone: c.timeZone },
    end: { dateTime: wallClock(c.day, startMinute + minutes), timeZone: c.timeZone },
    colorId: done ? COLORS.DONE : COLORS[kind],
    reminders: { useDefault: false, overrides: c.reminderMinutes > 0 ? [{ method: "popup", minutes: c.reminderMinutes }] : [] },
    extendedProperties: { private: { bp: "1", bpCity: c.cityId, bpDay: c.day, bpKind: kind } },
  };
}

const link = (c: Ctx, path: string) => `${c.appUrl}/#/${path}${path.includes("?") ? "&" : "?"}city=${encodeURIComponent(c.cityId)}`;

/** The study block: study and practice tasks with the stage; null when there are none. */
export function studyBody(c: Ctx & { stage: string | null; tasks: StudyTask[] }, startMinute: number): EventBody | null {
  const total = c.tasks.reduce((s, t) => s + t.minutes, 0);
  if (!c.tasks.length || total <= 0) return null;
  const done = c.tasks.every((t) => t.done);
  const lines = c.tasks.map((t) => `${t.done ? "✓" : "•"} ${t.title} · ${hm(t.minutes)}`);
  return {
    summary: `${done ? "✓ " : ""}${c.cityName} · Study · ${hm(total)}`,
    description: [...(c.stage ? [`Stage: ${c.stage}`, ""] : []), ...lines, "", `Open in Blueprint: ${link(c, "today")}`, "", FOOT].join("\n"),
    ...frame(c, "STUDY", startMinute, total, done),
  };
}

/** The recall event: one line per sub-topic due, each with a link that opens it; null when none is due. */
export function recallBody(c: Ctx & { items: RecallItem[] }, startMinute: number): EventBody | null {
  const total = c.items.reduce((s, t) => s + t.minutes, 0);
  if (!c.items.length || total <= 0) return null;
  const done = c.items.every((t) => t.done);
  const when = (r: RecallItem) => (r.done ? "done" : r.overdueSince ? `overdue since ${dm(r.overdueSince)}` : r.lastReview ? `last recalled ${dm(r.lastReview)}` : "first recall");
  const lines = c.items.flatMap((r, i) => [`${i + 1}. ${r.done ? "✓ " : ""}${r.name} (${r.topic}) · ${when(r)}`, ...(r.done ? [] : [`   ${link(c, `recall/${r.subtopicId}`)}`])]);
  const n = c.items.length;
  return {
    summary: `${done ? "✓ " : ""}${c.cityName} · Recall · ${n} sub-topic${n === 1 ? "" : "s"}`,
    description: ["Recall from memory first, then check in Blueprint.", "", ...lines, "", FOOT].join("\n"),
    ...frame(c, "RECALL", startMinute, total, done),
  };
}

/** What was written, as a short hash: an unchanged event is never written again. */
export const hashBody = (b: EventBody) =>
  createHash("sha256").update(JSON.stringify([b.summary, b.description, b.start, b.end, b.colorId, b.reminders])).digest("hex").slice(0, 32);

/**
 * A day's events, one after another from `start` in the order given. An event the learner moved keeps its time
 * (`fixed`), and the others are placed around it. Answers each event's start, in the same order.
 */
export function layoutDay(start: number, blocks: { minutes: number; fixed: number | null }[]): number[] {
  const taken = blocks.filter((b) => b.fixed !== null).map((b) => [b.fixed!, b.fixed! + b.minutes] as const);
  let cursor = start;
  return blocks.map((b) => {
    if (b.fixed !== null) return b.fixed;
    let at = cursor;
    for (let moved = true; moved;) {
      moved = false;
      for (const [s, e] of taken) {
        if (at < e && at + b.minutes > s) {
          at = e;
          moved = true;
        }
      }
    }
    cursor = at + b.minutes;
    return at;
  });
}

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
