/**
 * Pace follows the week you give a goal (hours a day × study days), and choosing a pace sets that week:
 * Light up to 8 hours a week, Steady over 8 and up to 16, Intensive over 16 (with at least 5 study days).
 * The share of new material per pace (60 / 75 / 90 %) is unchanged: heavier weeks put more of their hours into new
 * material while revision stays about the same in hours.
 */
export type PaceBand = "LIGHT" | "STEADY" | "INTENSIVE";

/** Weekly hours each pace covers: (above, up to]. */
export const PACE_BANDS: Record<PaceBand, [number, number]> = { LIGHT: [0, 8], STEADY: [8, 16], INTENSIVE: [16, Infinity] };
/** The hours a day a pace suggests when you choose it. */
export const PACE_HOURS: Record<PaceBand, number> = { LIGHT: 1.5, STEADY: 3, INTENSIVE: 4.5 };

export function paceFor(weeklyHours: number): PaceBand {
  return weeklyHours <= PACE_BANDS.LIGHT[1] ? "LIGHT" : weeklyHours <= PACE_BANDS.STEADY[1] ? "STEADY" : "INTENSIVE";
}

const fits = (pace: PaceBand, weekly: number) => weekly > PACE_BANDS[pace][0] && weekly <= PACE_BANDS[pace][1];

/**
 * The week a chosen pace sets: the hours a day closest to the pace's usual hours that put the week in its band, in
 * half hours, keeping the study days; days are added only when no hours fit (Intensive always has at least 5).
 */
export function weekForPace(pace: PaceBand, weekdays: number[], maxHours = 8): { hoursPerDay: number; weekdays: number[] } {
  let days = [...weekdays].sort((a, b) => a - b);
  const addDay = () => {
    const next = [1, 2, 3, 4, 5, 6, 7].find((d) => !days.includes(d));
    if (next) days = [...days, next].sort((a, b) => a - b);
  };
  if (pace === "INTENSIVE") while (days.length < 5) addDay();
  if (!days.length) addDay();
  for (;;) {
    const options: number[] = [];
    for (let h = 0.5; h <= maxHours + 1e-9; h += 0.5) if (fits(pace, h * days.length)) options.push(h);
    if (options.length) {
      const best = options.reduce((a, b) => (Math.abs(b - PACE_HOURS[pace]) < Math.abs(a - PACE_HOURS[pace]) ? b : a));
      return { hoursPerDay: best, weekdays: days };
    }
    if (days.length >= 7) return { hoursPerDay: maxHours, weekdays: days };
    addDay();
  }
}

/** "up to 8 h a week", "8–16 h a week", "over 16 h a week". */
export const bandText = (pace: PaceBand) =>
  pace === "LIGHT" ? `up to ${PACE_BANDS.LIGHT[1]} h a week` : pace === "STEADY" ? `${PACE_BANDS.STEADY[0]}–${PACE_BANDS.STEADY[1]} h a week` : `over ${PACE_BANDS.INTENSIVE[0]} h a week`;
