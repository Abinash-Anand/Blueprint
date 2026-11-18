/**
 * Vehicle placement (LLD §11.3). The car drives through the visible gap in front of the
 * current district, advancing with that district's demonstrated core progress.
 */
import type { Road } from "../api/types";
import type { Layout } from "./geometry";

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
  const start = i === 0 || !prev ? a[k] + 0.6 : (k === 0 ? prev.x1 : prev.y1) + 0.7;
  const end = (k === 0 ? cur.x0 : cur.y0) - 0.7;
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
