/**
 * Isometric engine constants and layout (DESIGN.md §3 — do not change without approval).
 */
import type { District, Topic } from "../api/types";

export const STEP = 1.4, FP = 0.9, MARGIN = 0.8, FH = 0.3, BASE = 0.1, S = 10;
export const TW = 32, TH = 16, ZU = 34; // 2:1 isometric tile, 34 px per height unit
export const ORIGINS: [number, number][] = [[0, 0], [S, 0], [S, S], [2 * S, S], [2 * S, 2 * S], [3 * S, 2 * S], [3 * S, 3 * S]];

export type Pt = [number, number];
export const iso = (x: number, y: number, z = 0): Pt => [(x - y) * TW, (x + y) * TH - z * ZU];

export interface Block {
  district: District;
  idx: number;
  x0: number; y0: number; x1: number; y1: number;
  buildings: Building[];
}

export interface Building {
  topic: Topic;
  block: Block;
  /** Index in the full route order (all buildings, district by district). */
  ri: number;
  x0: number; y0: number; x1: number; y1: number;
}

export interface Layout {
  blocks: Block[];
  route: Building[];
  /** Road waypoints: START, one per district (origin + (3,3)), GOAL. */
  W: Pt[];
}

export function layout(districts: District[]): Layout {
  const route: Building[] = [];
  const blocks = districts.slice(0, ORIGINS.length).map((d, idx) => {
    const [ox, oy] = ORIGINS[idx];
    const rows = Math.max(1, Math.ceil(d.topics.length / d.cols));
    const block: Block = {
      district: d, idx, x0: ox, y0: oy,
      x1: ox + 2 * MARGIN + (d.cols - 1) * STEP + FP,
      y1: oy + 2 * MARGIN + (rows - 1) * STEP + FP,
      buildings: [],
    };
    block.buildings = d.topics.map((topic, bi) => {
      const c = bi % d.cols, r = Math.floor(bi / d.cols);
      const x0 = ox + MARGIN + c * STEP, y0 = oy + MARGIN + r * STEP;
      const b: Building = { topic, block, ri: route.length, x0, y0, x1: x0 + FP, y1: y0 + FP };
      route.push(b);
      return b;
    });
    return block;
  });
  const W: Pt[] = [[-4, 3], ...ORIGINS.slice(0, blocks.length).map(([x, y]): Pt => [x + 3, y + 3]), [3 * S + 3, 3 * S + 9]];
  return { blocks, route, W };
}

export interface Box { x: number; y: number; w: number; h: number }

export function bounds(pts: Pt[]): Box {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (const p of pts) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }
  return { x: a, y: b, w: c - a, h: d - b };
}

export const districtBox = (b: Block): Box =>
  bounds([iso(b.x0, b.y0, 3.2), iso(b.x1, b.y0, 0), iso(b.x0, b.y1, 0), iso(b.x1, b.y1, -0.4), iso(b.x0, b.y0, -1.8)]);

export function cityBox(L: Layout): Box {
  const pts: Pt[] = [];
  for (const b of L.blocks) { const x = districtBox(b); pts.push([x.x, x.y], [x.x + x.w, x.y + x.h]); }
  for (const p of L.W) pts.push(iso(p[0], p[1]));
  return bounds(pts);
}
