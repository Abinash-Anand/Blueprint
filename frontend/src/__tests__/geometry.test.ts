/** Data-driven layout (B1 and the spacing guard): any number of districts, any grid, a straight road to GOAL. */
import { describe, expect, it } from "vitest";
import {
  type Layout, type Pt, CORNER, GOAL_CLEAR, GOAL_RUN, ROAD_HALF, SPACING, START, ZONE_MIN, layout, roadQuads,
} from "../map/geometry";
import { roadSVG } from "../map/render";
import { alongPath, carPath, carPosition, zone } from "../map/vehicle";
import { REAL, assorted, city } from "./cityShapes";
import { districts as seven } from "./fixtures";

const SIZES = [1, 2, 3, 4, 5, 6, 7];
const layouts: [string, Layout][] = [
  ...SIZES.map((n): [string, Layout] => [`${n} assorted districts`, layout(city(assorted(n)))]),
  ...SIZES.map((n): [string, Layout] => [`${n} uniform districts`, layout(seven.slice(0, n))]),
  ...Object.entries(REAL).map(([name, shape]): [string, Layout] => [name, layout(city(shape))]),
];

const overlaps = (a: { x0: number; y0: number; x1: number; y1: number }, b: typeof a) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Point in a convex quadrilateral (map units), with a small tolerance. */
function inQuad(p: Pt, q: Pt[]) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4];
    const c = (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
    if (Math.abs(c) < 1e-6) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

describe("city layout for every supported size", () => {
  it.each(layouts)("%s: one block per district, every topic placed inside its platform", (_, L) => {
    expect(L.blocks.length).toBeGreaterThan(0);
    for (const b of L.blocks) {
      expect(b.buildings).toHaveLength(b.district.topics.length);
      for (const bd of b.buildings) {
        expect(bd.x0).toBeGreaterThanOrEqual(b.x0);
        expect(bd.y0).toBeGreaterThanOrEqual(b.y0);
        expect(bd.x1).toBeLessThanOrEqual(b.x1 + 1e-9);
        expect(bd.y1).toBeLessThanOrEqual(b.y1 + 1e-9);
      }
    }
    expect(L.route).toHaveLength(L.blocks.reduce((a, b) => a + b.buildings.length, 0));
  });

  it.each(layouts)("%s: platforms never overlap and every district keeps a gap for the car", (_, L) => {
    for (let i = 0; i < L.blocks.length; i++) for (let j = i + 1; j < L.blocks.length; j++) expect(overlaps(L.blocks[i], L.blocks[j])).toBe(false);
    L.blocks.forEach((_, i) => {
      const z = zone(L, i);
      expect(z.end - z.start).toBeGreaterThanOrEqual(i === 0 ? 0 : ZONE_MIN - 1e-9);
    });
  });

  it.each(layouts)("%s: the road runs START → one corner per district → GOAL, every segment straight along x or y", (_, L) => {
    expect(L.W).toHaveLength(L.blocks.length + 2);
    expect(L.W[0]).toEqual(START);
    L.blocks.forEach((b, i) => expect(L.W[i + 1]).toEqual([b.x0 + CORNER, b.y0 + CORNER]));
    for (let i = 0; i < L.W.length - 1; i++) {
      const [a, b] = [L.W[i], L.W[i + 1]];
      expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
    }
  });

  it.each(layouts)("%s: GOAL follows the last district, straight on from its corner and clear of its platform", (_, L) => {
    const last = L.blocks[L.blocks.length - 1];
    const corner = L.W[L.W.length - 2], goal = L.W[L.W.length - 1];
    expect(goal[0]).toBe(corner[0]);
    expect(goal[1]).toBe(Math.max(corner[1] + GOAL_RUN, last.y1 + GOAL_CLEAR));
    // Never further than needed (the old fixed GOAL left up to 26 units of empty road).
    expect(goal[1] - Math.max(corner[1], last.y1)).toBeLessThanOrEqual(GOAL_RUN);
  });

  it.each(layouts)("%s: the car drives on the road from START to GOAL, through every corner", (_, L) => {
    const n = L.blocks.length;
    const quads = roadQuads(L.W);
    const from = { pos: carPosition(L, { currentDistrictIndex: 0, districtFraction: 0 }), idx: 0 };
    const to = { pos: carPosition(L, { currentDistrictIndex: n, districtFraction: 1 }), idx: n };
    const path = carPath(L, from, to);
    for (let k = 0; k <= 100; k++) {
      const p = alongPath(path, k / 100, "x");
      expect(quads.some((q) => inQuad([p.x, p.y], q))).toBe(true);
    }
    // The parked car at the end stands on the last segment, facing along it.
    expect(to.pos.x).toBe(L.W[n + 1][0]);
    expect(to.pos.ax).toBe("y");
  });

  it("is deterministic: the same curriculum always gives the same map", () => {
    const shape = assorted(6);
    expect(JSON.stringify(layout(city(shape)).W)).toBe(JSON.stringify(layout(city(shape)).W));
  });

  it("keeps the original 7-district city exactly where it was (spacing 10, GOAL at [33, 39])", () => {
    const L = layout(seven);
    expect(L.blocks.map((b) => [b.x0, b.y0])).toEqual([[0, 0], [10, 0], [10, 10], [20, 10], [20, 20], [30, 20], [30, 30]]);
    expect(L.W).toEqual([[-4, 3], [3, 3], [13, 3], [13, 13], [23, 13], [23, 23], [33, 23], [33, 33], [33, 39]]);
    const eng = layout(city(REAL["Engineering City"]));
    expect(eng.W[eng.W.length - 1]).toEqual([33, 39]);
  });

  it("widens the spacing only for districts too big for it: 6 columns, or 1 column with many topics", () => {
    const L = layout(city([
      { name: "wide", cols: 6, topics: 18, subtopics: 2 },
      { name: "tall", cols: 1, topics: 9, subtopics: 2 },
      { name: "small", cols: 2, topics: 2, subtopics: 2 },
    ]));
    expect(L.blocks[1].x0 - L.blocks[0].x0).toBeGreaterThan(SPACING); // 6 columns are 9.5 wide
    expect(L.blocks[2].y0 - L.blocks[1].y0).toBeGreaterThan(SPACING); // 9 rows are 12.3 deep
    const normal = layout(city([{ name: "a", cols: 4, topics: 8, subtopics: 2 }, { name: "b", cols: 4, topics: 8, subtopics: 2 }]));
    expect(normal.blocks[1].x0).toBe(SPACING);
  });
});

describe("road geometry", () => {
  const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  it("draws every segment as a strip of the same width, diagonal ones included", () => {
    const W: Pt[] = [[0, 0], [10, 0], [10, 10], [20, 30]]; // the last segment is diagonal
    for (const q of roadQuads(W)) {
      expect(dist(q[0], q[3])).toBeCloseTo(2 * ROAD_HALF);
      expect(dist(q[1], q[2])).toBeCloseTo(2 * ROAD_HALF);
    }
    const diag = roadQuads(W)[2];
    // Its area is its length times its width, not the bounding rectangle of its ends (the old grey diamond).
    const area = Math.abs(diag.reduce((s, a, i) => { const b = diag[(i + 1) % 4]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
    expect(area).toBeCloseTo((Math.hypot(10, 20) + 2 * ROAD_HALF) * 2 * ROAD_HALF);
    expect(area).toBeLessThan(0.15 * 11.2 * 21.2);
  });

  it("is the familiar rectangle for straight segments, with ends that overlap at the corners", () => {
    const [q] = roadQuads([[3, 3], [13, 3]]);
    const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([2.4, 13.6, 2.4, 3.6]);
  });

  it.each(SIZES)("renders no road polygon larger than a straight segment needs (%i districts)", (n) => {
    const L = layout(city(assorted(n)));
    const svg = roadSVG(L.W);
    const polys = [...svg.matchAll(/<polygon class="road"[^>]*points="([^"]+)"/g)].map((m) => m[1].split(" ").map((p) => p.split(",").map(Number)));
    expect(polys).toHaveLength(L.W.length - 1);
    for (const [i, q] of polys.entries()) {
      const len = dist(L.W[i], L.W[i + 1]);
      const area = Math.abs(q.reduce((s, a, j) => { const b = q[(j + 1) % q.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
      // Area on screen = area in map units × 1024 (the projection's determinant).
      expect(area).toBeCloseTo((len + 2 * ROAD_HALF) * 2 * ROAD_HALF * 1024, 0);
    }
  });
});
