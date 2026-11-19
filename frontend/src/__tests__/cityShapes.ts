/** City shapes for map tests: any number of districts, column counts, topic counts and sub-topic counts. */
import type { District } from "../api/types";
import { topic } from "./fixtures";

export interface Shape { name: string; cols: number; topics: number; subtopics: number | number[] }

const colors = ["#7f98a8", "#8ea58b", "#c2ab80", "#9c8ea6", "#7fa3a1", "#c4937f", "#a8a096"];

export function city(shape: Shape[], prefix = "c"): District[] {
  return shape.map((s, i) => {
    const id = `${prefix}${i}`;
    return {
      id, position: i, name: s.name, subtitle: "", layer: 1, color: colors[i % colors.length], cols: s.cols, goal: "", note: "",
      topics: Array.from({ length: s.topics }, (_, t) => {
        const n = Array.isArray(s.subtopics) ? s.subtopics[t % s.subtopics.length] : s.subtopics;
        return topic(`${id}.t${t}`, {
          position: t, districtId: id,
          subtopics: Array.from({ length: n }, (_, k) => ({ id: k + 1, position: k, name: `s${k}`, completedAt: null })),
        });
      }),
    };
  });
}

/** The shapes of the cities used in the runtime reproduction (district names as they appear there). */
export const REAL: Record<string, Shape[]> = {
  "German Language": [
    { name: "Foundations: Survival German", cols: 4, topics: 12, subtopics: [3, 4, 6] },
    { name: "Elementary: Building Sentences", cols: 4, topics: 12, subtopics: [4, 8, 5] },
    { name: "Intermediate: Independent Communication", cols: 4, topics: 12, subtopics: [5, 6] },
    { name: "Upper Intermediate: Nuance and Flow", cols: 4, topics: 11, subtopics: [5, 7] },
    { name: "Advanced: Native Mastery", cols: 4, topics: 10, subtopics: [6, 7] },
  ],
  "Angular City": [
    { name: "Foundation District", cols: 3, topics: 5, subtopics: 2 },
    { name: "Data Flow District", cols: 3, topics: 5, subtopics: 2 },
    { name: "Routing & Navigation District", cols: 2, topics: 3, subtopics: 2 },
    { name: "Engineering District", cols: 3, topics: 5, subtopics: 2 },
  ],
  "Tech City": [
    { name: "Foundations District", cols: 3, topics: 5, subtopics: [5, 8] },
    { name: "Java Backend District", cols: 3, topics: 7, subtopics: [6, 8] },
    { name: "Angular Frontend District", cols: 3, topics: 8, subtopics: [6, 8] },
    { name: "Integration Plaza", cols: 2, topics: 4, subtopics: 7 },
    { name: "DevOps Harbor", cols: 2, topics: 4, subtopics: 6 },
    { name: "Capstone Peak", cols: 2, topics: 4, subtopics: 8 },
  ],
  "Engineering City": [
    { name: "Frontend Engineering", cols: 4, topics: 13, subtopics: 5 },
    { name: "Backend Engineering", cols: 4, topics: 14, subtopics: 5 },
    { name: "Database", cols: 3, topics: 9, subtopics: 5 },
    { name: "Architecture & System Design", cols: 5, topics: 17, subtopics: 6 },
    { name: "Cloud Engineering", cols: 4, topics: 9, subtopics: 8 },
    { name: "AI Engineering", cols: 4, topics: 15, subtopics: 5 },
    { name: "Engineering Consolidation", cols: 3, topics: 6, subtopics: 6 },
  ],
};

/** Cities with 1–7 districts in assorted shapes: narrow and wide grids, few and many topics, low and tall buildings. */
export function assorted(n: number): Shape[] {
  const pool: Shape[] = [
    { name: "Basics", cols: 2, topics: 3, subtopics: 2 },
    { name: "A district with a fairly long name", cols: 6, topics: 20, subtopics: [1, 20] },
    { name: "Grid", cols: 4, topics: 13, subtopics: 5 },
    { name: "Tower district", cols: 1, topics: 7, subtopics: 20 },
    { name: "Wide", cols: 5, topics: 5, subtopics: 3 },
    { name: "Single", cols: 3, topics: 1, subtopics: 1 },
    { name: "Mixed heights", cols: 3, topics: 9, subtopics: [2, 8, 14] },
  ];
  return Array.from({ length: n }, (_, i) => pool[(i * 3 + n) % pool.length]);
}
