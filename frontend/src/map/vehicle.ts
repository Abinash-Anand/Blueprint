/**
 * Vehicle placement (LLD §11.3). The car drives through the visible gap in front of the
 * current district, advancing with that district's demonstrated core progress.
 */
import type { Road } from "../api/types";
import { type Layout, type Pt, ZONE_CLEAR } from "./geometry";

export interface CarPos {
  x: number;
  y: number;
  /** Road axis the car is aligned with. */
  ax: "x" | "y";
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** Start and end of the drivable zone in front of district i, along the road axis. */
export function zone(L: Layout, i: number): { ax: "x" | "y"; start: number; end: number; fixed: number } {
  const a = L.W[i], b = L.W[i + 1];
  const ax = a[0] !== b[0] ? "x" : "y";
  const k = ax === "x" ? 0 : 1;
  const cur = L.blocks[i];
  const prev = L.blocks[i - 1];
  const start = i === 0 || !prev ? a[k] + 0.6 : (k === 0 ? prev.x1 : prev.y1) + ZONE_CLEAR;
  const end = (k === 0 ? cur.x0 : cur.y0) - ZONE_CLEAR;
  return { ax, start, end: Math.max(end, start), fixed: b[1 - k] };
}

export function carPosition(L: Layout, road: Pick<Road, "currentDistrictIndex" | "districtFraction">): CarPos {
  const i = road.currentDistrictIndex;
  if (i >= L.blocks.length || i < 0) {
    const e = L.W[L.W.length - 1];
    return { x: e[0], y: e[1] - 1.6, ax: "y" };
  }
  const z = zone(L, i);
  const p = z.start + clamp01(road.districtFraction) * (z.end - z.start);
  return z.ax === "x" ? { x: p, y: z.fixed, ax: "x" } : { x: z.fixed, y: p, ax: "y" };
}

/**
 * The road between two car positions: the start, every road corner passed on the way (forwards or backwards), the end.
 * The car in district i drives on road segment W[i] → W[i+1]; the goal sits on the last segment.
 */
export function carPath(L: Layout, a: { pos: CarPos; idx: number }, b: { pos: CarPos; idx: number }): Pt[] {
  const pts: Pt[] = [[a.pos.x, a.pos.y]];
  if (b.idx > a.idx) for (let k = a.idx + 1; k <= b.idx; k++) pts.push(L.W[k]);
  else if (b.idx < a.idx) for (let k = a.idx; k > b.idx; k--) pts.push(L.W[k]);
  pts.push([b.pos.x, b.pos.y]);
  return pts;
}

/** The point at fraction p (0..1) of the path's length, aligned with the road segment it is on. */
export function alongPath(pts: Pt[], p: number, fallbackAx: "x" | "y"): CarPos {
  const lens = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
  const total = lens.reduce((a, b) => a + b, 0);
  if (total === 0) return { x: pts[0][0], y: pts[0][1], ax: fallbackAx };
  if (p >= 1) {
    // Exactly the end point (no rounding drift), aligned with the last segment.
    const [x0, y0] = pts[pts.length - 2], [x1, y1] = pts[pts.length - 1];
    return { x: x1, y: y1, ax: x1 !== x0 && Math.abs(x1 - x0) >= Math.abs(y1 - y0) ? "x" : y1 !== y0 ? "y" : fallbackAx };
  }
  let d = clamp01(p) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const f = lens[i] ? Math.min(1, d / lens[i]) : 1;
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const ax = Math.abs(x1 - x0) >= Math.abs(y1 - y0) ? (x1 !== x0 ? "x" : fallbackAx) : "y";
      return f >= 1 ? { x: x1, y: y1, ax } : { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, ax };
    }
    d -= lens[i];
  }
  const e = pts[pts.length - 1];
  return { x: e[0], y: e[1], ax: fallbackAx };
}

/** Length of a path in map units (to scale the animation's duration). */
export const pathLength = (pts: Pt[]) => pts.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0);
