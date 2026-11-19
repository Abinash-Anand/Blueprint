/** City and district boxes (B2): they contain everything drawn and are not dominated by empty road. */
import { describe, expect, it } from "vitest";
import { cityBox, districtBox } from "../map/bounds";
import { type Box, type Layout, buildingHeight, iso, layout } from "../map/geometry";
import { type RenderState, renderCity, roadSVG } from "../map/render";
import { CAPTION, estimateMeter, wrapCaption } from "../map/text";
import { carPosition } from "../map/vehicle";
import { REAL, assorted, city } from "./cityShapes";

const signsFor = (L: Layout) => L.blocks.map((_, i) => (i % 2 ? ["SAT NOV–FEB", "MAR–MAY"] : ["JAN–MAR"]));
const cases: [string, Layout, string][] = [
  ...[1, 2, 3, 4, 5, 6, 7].map((n): [string, Layout, string] => [`${n} assorted districts`, layout(city(assorted(n))), "Hold everyday conversations in German with confidence at work and with friends"]),
  ...Object.entries(REAL).map(([name, shape]): [string, Layout, string] => [name, layout(city(shape)), `${name} goal`]),
];

function state(L: Layout, over: Partial<RenderState> = {}): RenderState {
  return {
    floors: () => 0, selectedId: null, currentTopicId: null, passed: L.blocks.map(() => false), currentIdx: 0,
    car: carPosition(L, { currentDistrictIndex: 0, districtFraction: 0 }), signs: signsFor(L), ...over,
  };
}

/** Every coordinate the renderer writes, with text widened to its estimated extent. */
function drawnPoints(svg: string): [number, number][] {
  const pts: [number, number][] = [];
  for (const m of svg.matchAll(/points="([^"]+)"/g)) for (const p of m[1].trim().split(/\s+/)) pts.push(p.split(",").map(Number) as [number, number]);
  for (const m of svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)) pts.push([+m[1], +m[2]], [+m[3], +m[4]]);
  for (const m of svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"/g)) pts.push([+m[1] - +m[3], +m[2] - +m[3]], [+m[1] + +m[3], +m[2] + +m[3]]);
  for (const m of svg.matchAll(/<ellipse[^>]*cx="([-\d.]+)" cy="([-\d.]+)" rx="([\d.]+)" ry="([\d.]+)"/g)) pts.push([+m[1] - +m[3], +m[2] - +m[4]], [+m[1] + +m[3], +m[2] + +m[4]]);
  for (const m of svg.matchAll(/<path d="M([-\d.]+) ([-\d.]+) l([-\d.]+) ([-\d.]+) l([-\d.]+) ([-\d.]+)z"/g)) {
    const x = +m[1], y = +m[2];
    pts.push([x, y], [x + +m[3], y + +m[4]], [x + +m[3] + +m[5], y + +m[4] + +m[6]]);
  }
  // Centred texts: road and goal texts, signposts, badge numbers.
  for (const m of svg.matchAll(/<text([^>]*)text-anchor="middle"([^>]*)x="([-\d.]+)" y="([-\d.]+)"[^>]*>([^<]*)<\/text>/g)) {
    const tag = m[0];
    // Size, weight and letter-spacing of each kind of centred text (styles.css and render.ts).
    const [size, weight, spacing] = /goalcap/.test(tag) ? [CAPTION.size, CAPTION.weight, 0]
      : /signtext/.test(tag) ? [10.5, 600, 0.16]
      : /font-size="13"/.test(tag) ? [13, 700, 0]
      : [12, 600, 0.18];
    const half = (estimateMeter(m[5], size, weight) + spacing * size * m[5].length) / 2;
    pts.push([+m[3] - half, +m[4] - size], [+m[3] + half, +m[4] + 3]);
  }
  return pts;
}

const inside = (b: Box, [x, y]: [number, number]) => x >= b.x - 0.5 && x <= b.x + b.w + 0.5 && y >= b.y - 0.5 && y <= b.y + b.h + 0.5;

describe("city bounds", () => {
  it.each(cases)("%s: everything the renderer draws lies inside the Whole-city box", (_, L, goal) => {
    const caption = wrapCaption(goal, estimateMeter);
    // The car at START (its widest reach left) and parked at GOAL.
    for (const car of [carPosition(L, { currentDistrictIndex: 0, districtFraction: 0 }), carPosition(L, { currentDistrictIndex: L.blocks.length, districtFraction: 1 })]) {
      const svg = renderCity(L, state(L, { car }), roadSVG(L.W, caption));
      const box = cityBox(L, { signs: signsFor(L), caption });
      const outside = drawnPoints(svg).filter((p) => !inside(box, p));
      expect(outside).toEqual([]);
    }
  });

  it.each(cases)("%s: each district box holds its platform, its tallest building and its badge", (_, L) => {
    for (const b of L.blocks) {
      const box = districtBox(b);
      for (const bd of b.buildings) expect(inside(box, iso(bd.x0, bd.y0, buildingHeight(bd.topic)))).toBe(true);
      expect(inside(box, iso(b.x0, b.y1, -0.32))).toBe(true);
      expect(inside(box, iso(b.x1, b.y0, 0))).toBe(true);
    }
  });

  it.each(cases)("%s: the districts fill most of the frame; GOAL adds only its flag and caption", (_, L, goal) => {
    const caption = wrapCaption(goal, estimateMeter);
    const box = cityBox(L, { signs: signsFor(L), caption });
    const d = L.blocks.map(districtBox);
    const bottom = Math.max(...d.map((x) => x.y + x.h)), top = Math.min(...d.map((x) => x.y));
    expect((bottom - top) / box.h).toBeGreaterThan(0.7);
    expect(box.y + box.h - bottom).toBeLessThan(260); // the old fixed GOAL added up to 500 px of empty road
  });

  it("frames tall buildings: a 20-floor tower is inside its district box", () => {
    const L = layout(city([{ name: "Towers", cols: 2, topics: 4, subtopics: 20 }]));
    const box = districtBox(L.blocks[0]);
    const top = Math.min(...L.blocks[0].buildings.map((b) => iso(b.x0, b.y0, buildingHeight(b.topic))[1]));
    expect(top).toBeGreaterThanOrEqual(box.y);
  });
});
