/**
 * Isometric engine: constants and the data-driven city layout (DESIGN.md §3).
 *
 * Every spatial property comes from the curriculum (district order, grid columns, topic and sub-topic counts) and the
 * design constants below; nothing depends on a city's identity or on a fixed number of districts. Districts follow a
 * staircase (+x, +y, +x, …). The step between two districts is SPACING, widened only when a district is too big to
 * leave the car its gap, so the original 7-district city keeps its exact geometry.
 */
import type { District, Topic } from "../api/types";

/* ---------------- design constants (map units unless noted) ---------------- */

/** Building pitch, footprint, platform margin, floor height and ground slab height. */
export const STEP = 1.4, FP = 0.9, MARGIN = 0.8, FH = 0.3, BASE = 0.1;
/** Preferred distance between neighbouring district origins along the road. */
export const SPACING = 10;
/** 2:1 isometric tile (px per unit along x and y) and px per height unit. */
export const TW = 32, TH = 16, ZU = 34;
/** Road half-width, and where the road turns inside each district (offset from its origin). */
export const ROAD_HALF = 0.6, CORNER = 3;
/** The car's gap in front of each district: clearance from both platforms, and its shortest allowed length. */
export const ZONE_CLEAR = 0.7, ZONE_MIN = 0.5;
/** START sits before the first district; GOAL follows the last one, at least GOAL_RUN after its corner and clear of its platform. */
export const START: Pt = [-4, CORNER];
export const GOAL_RUN = 6, GOAL_CLEAR = 2.5;

export type Pt = [number, number];
export const iso = (x: number, y: number, z = 0): Pt => [(x - y) * TW, (x + y) * TH - z * ZU];
/** Length in px of one map unit along the x (or y) axis on screen. */
export const AXIS_PX = Math.hypot(TW, TH);

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
  /** Road waypoints: START, one corner per district, GOAL. Every segment is parallel to the x or the y axis. */
  W: Pt[];
}

/** Platform size for a district: a grid of `cols` columns, as many rows as its topics need. */
export function platformSize(d: Pick<District, "cols"> & { topics: unknown[] }): { w: number; h: number } {
  const cols = Math.max(1, d.cols);
  const rows = Math.max(1, Math.ceil(d.topics.length / cols));
  return { w: 2 * MARGIN + (cols - 1) * STEP + FP, h: 2 * MARGIN + (rows - 1) * STEP + FP };
}

/** The road turns along x after even-indexed districts and along y after odd ones (the staircase). */
export const stepsAlongX = (idx: number) => idx % 2 === 0;

/** Distance from one district's origin to the next: SPACING, or more when the platform would leave the car too little gap. */
export function spacingAfter(b: Pick<Block, "idx" | "x0" | "x1" | "y0" | "y1">): number {
  const extent = stepsAlongX(b.idx) ? b.x1 - b.x0 : b.y1 - b.y0;
  return Math.max(SPACING, extent + 2 * ZONE_CLEAR + ZONE_MIN);
}

export function layout(districts: District[]): Layout {
  const route: Building[] = [];
  const blocks: Block[] = [];
  for (const [idx, d] of districts.entries()) {
    const prev = blocks[idx - 1];
    let ox = 0, oy = 0;
    if (prev) {
      const step = spacingAfter(prev);
      ox = prev.x0 + (stepsAlongX(prev.idx) ? step : 0);
      oy = prev.y0 + (stepsAlongX(prev.idx) ? 0 : step);
    }
    const { w, h } = platformSize(d);
    const cols = Math.max(1, d.cols);
    const block: Block = { district: d, idx, x0: ox, y0: oy, x1: ox + w, y1: oy + h, buildings: [] };
    block.buildings = d.topics.map((topic, bi) => {
      const c = bi % cols, r = Math.floor(bi / cols);
      const x0 = ox + MARGIN + c * STEP, y0 = oy + MARGIN + r * STEP;
      const b: Building = { topic, block, ri: route.length, x0, y0, x1: x0 + FP, y1: y0 + FP };
      route.push(b);
      return b;
    });
    blocks.push(block);
  }
  const corners = blocks.map((b): Pt => [b.x0 + CORNER, b.y0 + CORNER]);
  return { blocks, route, W: [START, ...corners, goalPoint(blocks, corners)] };
}

/** GOAL: straight on along +y from the last district's corner, past the front of its platform. */
function goalPoint(blocks: Block[], corners: Pt[]): Pt {
  const last = blocks[blocks.length - 1];
  if (!last) return [CORNER, CORNER];
  const [cx, cy] = corners[corners.length - 1];
  return [cx, Math.max(cy + GOAL_RUN, last.y1 + GOAL_CLEAR)];
}

/**
 * The road as one quadrilateral per segment, ROAD_HALF wide on each side and extended by ROAD_HALF past both ends so
 * corners join. Works for any direction; for axis-parallel segments it is the familiar rectangle.
 */
export function roadQuads(W: Pt[], hw = ROAD_HALF): Pt[][] {
  const quads: Pt[][] = [];
  for (let i = 0; i < W.length - 1; i++) {
    const [ax, ay] = W[i], [bx, by] = W[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len === 0) continue;
    const dx = ((bx - ax) / len) * hw, dy = ((by - ay) / len) * hw; // along the segment
    const nx = -dy, ny = dx; // across it
    quads.push([
      [ax - dx + nx, ay - dy + ny],
      [bx + dx + nx, by + dy + ny],
      [bx + dx - nx, by + dy - ny],
      [ax - dx - nx, ay - dy - ny],
    ]);
  }
  return quads;
}

export interface Box { x: number; y: number; w: number; h: number }

export function bounds(pts: Pt[]): Box {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (const p of pts) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); }
  return { x: a, y: b, w: c - a, h: d - b };
}

/** Height of a topic's building when complete (its dashed target outline): one floor per sub-topic. */
export const buildingHeight = (t: Pick<Topic, "subtopics">) => BASE + t.subtopics.length * FH;
