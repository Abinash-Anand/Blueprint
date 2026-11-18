import type { District, Presentation, Tone, Topic } from "../api/types";

/** Presentation metadata as the backend sends it (LLD §4.4); the frontend only renders it. */
export const pres = (state: string, tone: Tone, label: string, flags?: Presentation[]): Presentation => ({
  state, tone, variant: "soft", icon: "circle", label, ...(flags ? { flags } : {}),
});
export const WEAK = pres("revision.weak", "warning", "Weak");

export function topic(id: string, over: Partial<Topic> = {}): Topic {
  return {
    id, districtId: id.split(".")[0], position: 0, name: id, description: "d", priority: "CORE", estimatedHours: 4,
    exercise: "e", status: "NOT_STARTED", demonstratedAt: null, demonstrationNote: null, needsReview: false,
    subtopics: [1, 2, 3].map((i) => ({ id: i, position: i, name: `s${i}`, completedAt: null })),
    resources: [], dependsOn: [], plannedMinutes: 0, loggedMinutes: 0, firstDate: null, lastDate: null, ...over,
  };
}

const colors = ["#7f98a8", "#8ea58b", "#c2ab80", "#9c8ea6", "#7fa3a1", "#c4937f", "#a8a096"];
export const districts: District[] = ["fe", "be", "db", "ar", "cl", "ai", "ec"].map((id, i) => ({
  id, position: i, name: `District ${id}`, subtitle: "", layer: 1, color: colors[i], cols: 4, goal: "", note: "",
  topics: ["a", "b", "c", "d", "e"].map((s, p) => topic(`${id}.${s}`, { position: p })),
}));
