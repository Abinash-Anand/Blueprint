/**
 * The city as it takes shape, at the top of every creation screen. It is drawn by the real map engine (layout and
 * renderCity), so it looks like the city will: districts in the same staircase and colours, one building per topic,
 * each as tall as its sub-topics, shown fully built: what the learner is building toward. Before the AI has written a
 * district it is a flat grey "ghost"; once written it takes its colour and its buildings rise. Decorative: the words beside it say the same thing for assistive technology.
 */
import { useEffect, useMemo, useRef } from "react";
import type { CurriculumDocumentView, District, Topic } from "../../../api/types";
import { cityBox } from "../../../map/bounds";
import { layout } from "../../../map/geometry";
import { renderCity, roadSVG } from "../../../map/render";
import { carPosition } from "../../../map/vehicle";

/** The colours generated cities get, in order (backend ai/curriculum/generator.ts COLOURS). */
export const DISTRICT_COLOURS = ["#7f98a8", "#8ea58b", "#c2ab80", "#9c8ea6", "#7fa3a1", "#c4937f", "#a8a096"];
const GHOST = "#d3cec4";

export interface PreviewDistrict {
  name: string;
  /** ghost: not written yet · planned: written (or, before building, what the learner confirmed). */
  state: "ghost" | "planned";
  /** Sub-topic count of each topic (building height). */
  topics: number[];
  color?: string;
}

/** Same column rule as the backend when a district has no explicit columns (cities/apply.ts). */
const colsFor = (n: number) => Math.min(6, Math.max(2, Math.ceil(Math.sqrt(Math.max(1, n)))));

function topic(id: string, districtId: string, position: number, subtopics: number): Topic {
  return {
    id, districtId, position, name: "", description: "", priority: "CORE", estimatedHours: 1, exercise: "", status: "NOT_STARTED",
    demonstratedAt: null, demonstrationNote: null, needsReview: false,
    subtopics: Array.from({ length: Math.max(1, subtopics) }, (_, k) => ({ id: k, position: k, name: "", completedAt: null })),
    resources: [], dependsOn: [], plannedMinutes: 0, loggedMinutes: 0, firstDate: null, lastDate: null,
  };
}

/** Map-engine districts for the preview (ids are local to the preview). */
export function previewDistricts(items: PreviewDistrict[]): District[] {
  return items.map((d, i) => {
    const id = `p${i}`;
    return {
      id, position: i, name: d.name, subtitle: "", layer: 1, goal: "", note: "", cols: colsFor(d.topics.length),
      color: d.state === "ghost" ? GHOST : d.color ?? DISTRICT_COLOURS[i % DISTRICT_COLOURS.length],
      topics: (d.state === "ghost" ? d.topics.map(() => 1) : d.topics).map((n, t) => topic(`${id}.t${t}`, id, t, n)),
    };
  });
}

/** The districts of a proposed curriculum, exactly as the city will have them. */
export const fromDocument = (doc: CurriculumDocumentView): PreviewDistrict[] =>
  doc.districts.map((d) => ({ name: d.name, state: "planned", color: d.color, topics: d.topics.map((t) => t.subtopics?.length || 1) }));

export function CityPreview({ districts, caption, empty = "Your city appears here" }: { districts: PreviewDistrict[]; caption?: string; empty?: string }) {
  // Districts that have just gone from ghost (or absent) to planned get the rise animation, once.
  const before = useRef<Map<string, PreviewDistrict["state"]> | null>(null);
  const fresh = useMemo(() => {
    const prev = before.current;
    return new Set(prev ? districts.filter((d, i) => d.state === "planned" && prev.get(`${i}:${d.name}`) === "ghost").map((d) => d.name) : []);
  }, [districts]);
  useEffect(() => {
    before.current = new Map(districts.map((d, i) => [`${i}:${d.name}`, d.state]));
  }, [districts]);

  const { svg, viewBox } = useMemo(() => {
    if (!districts.length) return { svg: "", viewBox: "0 0 10 10" };
    const L = layout(previewDistricts(districts));
    const box = cityBox(L);
    const pad = Math.max(box.w, box.h) * 0.06;
    // Written districts show the city as it will be when learned (every floor built); ghosts stay flat.
    const full = new Map(L.route.filter((b) => districts[b.block.idx]?.state === "planned").map((b) => [b.topic.id, b.topic.subtopics.length]));
    const markup = renderCity(L, {
      floors: (topicId) => full.get(topicId) ?? 0, selectedId: null, currentTopicId: null, passed: [], currentIdx: -1, signs: [],
      car: carPosition(L, { currentDistrictIndex: 0, districtFraction: 0 }),
      buildingClass: (b) => (fresh.has(b.block.district.name) ? "fresh" : undefined),
    }, roadSVG(L.W));
    return { svg: markup, viewBox: `${box.x - pad} ${box.y - pad} ${box.w + 2 * pad} ${box.h + 2 * pad}` };
  }, [districts, fresh]);

  return (
    <div className="cc-hero">
      {districts.length ? (
        <svg className="cc-hero-map" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="cc-hero-empty"><span>{empty}</span></div>
      )}
      {caption && <p className="cc-hero-cap" aria-live="polite">{caption}</p>}
    </div>
  );
}
