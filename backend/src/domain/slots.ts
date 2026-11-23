/**
 * Study slots (docs/Google-Calendar-MVP-Plan.md §9): each city has a time of day its study starts at, and lasts the
 * day's hours. Two cities whose slots overlap on a shared study day clash. Pure functions, worked out in code only.
 */
export interface Slot {
  name: string;
  /** Minutes after midnight. */
  start: number;
  /** Minutes on each ISO weekday (1 = Monday); 0 or missing = no study that day. */
  minutes: Record<number, number>;
}
export interface Clash { city: string; from: string; to: string; days: number[] }

export const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const toMinute = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** The other cities whose slots overlap this one, and on which weekdays. */
export function clashes(mine: Slot, others: Slot[]): Clash[] {
  const out: Clash[] = [];
  for (const o of others) {
    const days: number[] = [];
    let longest = 0;
    for (let d = 1; d <= 7; d++) {
      const a = mine.minutes[d] ?? 0, b = o.minutes[d] ?? 0;
      if (a > 0 && b > 0 && mine.start < o.start + b && o.start < mine.start + a) {
        days.push(d);
        longest = Math.max(longest, b);
      }
    }
    if (days.length) out.push({ city: o.name, from: hhmm(o.start), to: hhmm(o.start + longest), days });
  }
  return out;
}

/**
 * The first start from `mine.start` on (in 15-minute steps) at which this slot clashes with nothing and still ends by
 * midnight; null when there is none that day.
 */
export function nextFree(mine: Slot, others: Slot[]): number | null {
  const longest = Math.max(0, ...Object.values(mine.minutes));
  for (let s = Math.ceil(mine.start / 15) * 15; s + longest <= 24 * 60; s += 15) {
    if (!clashes({ ...mine, start: s }, others).length) return s;
  }
  return null;
}
