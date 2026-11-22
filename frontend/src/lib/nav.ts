/**
 * Pages that open on top of a view get their own address, so Back, reload and bookmarks work: the recall flow
 * (#/recall/<sub-topic>) and recall over time (#/revision/history/<sub-topic>, #/progress/history/<sub-topic>).
 * Closing one goes back to where it was opened from; opened directly, it goes to a sensible view instead.
 */
export const recallHash = (subtopicId: number) => `#/recall/${subtopicId}`;
export const historyHash = (view: "revision" | "progress", subtopicId: number) => `#/${view}/history/${subtopicId}`;
/** Your hours, study days and pace (docs/Availability-Phase3-Plan.md). */
export const YOUR_TIME = "#/your-time";

export function openPage(hash: string) {
  if (location.hash === hash) return;
  history.pushState({ from: location.hash || "#/today" }, "", hash);
  dispatchEvent(new HashChangeEvent("hashchange"));
}

/** Where the page was opened from, when it was opened inside the app (null after a reload or a direct link). */
export const openedFrom = (): string | null => {
  const s = history.state as { from?: unknown } | null;
  return s && typeof s.from === "string" ? s.from : null;
};

export function closePage(fallback: string) {
  if (openedFrom()) history.back();
  else location.hash = fallback;
}

const NAMES: Record<string, string> = { today: "Today", week: "Week", revision: "Revision", city: "City", progress: "Progress" };
/** The name of the view a page goes back to, for its back button ("Revision", "Today", …). */
export const backName = (fallback: string) => NAMES[(openedFrom() ?? fallback).replace(/^#\//, "").split(/[/?]/)[0]] ?? NAMES[fallback.replace(/^#\//, "")] ?? "Back";
