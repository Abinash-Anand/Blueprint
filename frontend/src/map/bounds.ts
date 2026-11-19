/**
 * Where the map's decorations sit (shared by the renderer) and the boxes the camera frames. A box contains everything
 * that is drawn for it: platforms and their shadow, every building at full height (plus its hover lift), checkpoint
 * badges, district labels, the road with the car's pulse, month signposts, START, and the GOAL flag with its caption.
 * Text widths use the deterministic estimate, which is never narrower than the real font, so boxes never clip text.
 */
import { AXIS_PX, type Block, type Box, type Layout, type Pt, ROAD_HALF, bounds, buildingHeight, iso, roadQuads } from "./geometry";
import { CAPTION, estimateMeter, spacedWidth } from "./text";
import { zone } from "./vehicle";

/* ---------------- anchors (px) ---------------- */

/** District label: starts near the left end of the platform's front edge and may use the edge minus a margin at both ends. */
export const LABEL_INSET = 0.32;
export const labelAnchor = (b: Block): Pt => iso(b.x0 + LABEL_INSET, b.y1 - 0.2);
export const labelSpace = (b: Block) => (b.x1 - b.x0 - 2 * LABEL_INSET) * AXIS_PX;

/** Checkpoint badge: a post with a numbered disc, at the platform's left corner. */
export const BADGE = { post: 40, cy: 54, r: 14, stroke: 2.2 } as const;
export const badgeAnchor = (b: Block): Pt => iso(b.x0 - 0.35, b.y1 + 0.35);

/** START label beside the first waypoint. */
export const START_TEXT = { size: 12, spacing: 0.18, weight: 600 } as const;
export const startAnchor = (W: Pt[]): Pt => iso(W[0][0] - 0.3, W[0][1] - 1.0);

/** GOAL: flag post, flag, the word GOAL, then the caption lines. */
export const GOAL_MARK = { post: 64, flag: 30, flagH: 18, word: 24, caption: 42 } as const;
export const goalAnchor = (W: Pt[]): Pt => { const e = W[W.length - 1]; return iso(e[0], e[1] + 0.4); };

/** Month signposts beside the gap in front of each district. */
export const SIGN = { size: 10.5, spacing: 0.16, weight: 600, post: 14, first: 19, line: 13 } as const;
export function signAnchor(L: Layout, i: number): Pt {
  const z = zone(L, i);
  const mid = (z.start + z.end) / 2;
  return z.ax === "x" ? iso(mid, z.fixed - 1.25) : iso(z.fixed - 1.25, mid);
}

/** The car's pulse ring (px) around any point of the road. */
export const PULSE = { rx: 34, ry: 17 } as const;
/** Hover and selection lift buildings by a few px (styles.css .bld .vis). */
const LIFT = 4;

/* ---------------- boxes ---------------- */

/** Corners of a text box for centred text at baseline y. */
function textBox(cx: number, y: number, width: number, size: number): Pt[] {
  return [[cx - width / 2, y - size * 0.85], [cx + width / 2, y + size * 0.3]];
}

function districtPoints(b: Block): Pt[] {
  const pts: Pt[] = [];
  // Platform, its slab (z −0.32) and shadow (offset 0.35).
  for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]] as Pt[]) {
    pts.push(iso(x, y, 0), iso(x, y, -0.32), iso(x + 0.35, y + 0.35, -0.32));
  }
  // Every building at full height (the dashed outline of unbuilt floors), with a little room for the roof and the lift.
  for (const bd of b.buildings) {
    const H = buildingHeight(bd.topic) + 0.1;
    for (const [x, y] of [[bd.x0, bd.y0], [bd.x1, bd.y0], [bd.x0, bd.y1]] as Pt[]) {
      const [px, py] = iso(x, y, H);
      pts.push([px, py - LIFT]);
    }
  }
  // Checkpoint badge.
  const [bx, by] = badgeAnchor(b);
  const r = BADGE.r + BADGE.stroke;
  pts.push([bx - r, by - BADGE.cy - r], [bx + r, by]);
  return pts;
}

/** Everything drawn for one district ("Where am I", checkpoint badges, district focus). */
export const districtBox = (b: Block): Box => bounds(districtPoints(b));

export interface CityDecor {
  /** Month signposts per district index, as rendered. */
  signs?: string[][];
  /** Lines of the GOAL caption, as rendered (wrapCaption). */
  caption?: string[];
}

/** Everything drawn for the whole city ("Whole city"). */
export function cityBox(L: Layout, decor: CityDecor = {}): Box {
  const m = estimateMeter;
  const pts: Pt[] = L.blocks.flatMap(districtPoints);
  // The road, and the car's pulse wherever it drives.
  for (const q of roadQuads(L.W, ROAD_HALF)) for (const [x, y] of q) {
    const [px, py] = iso(x, y);
    pts.push([px - PULSE.rx, py - PULSE.ry], [px + PULSE.rx, py + PULSE.ry]);
  }
  // START.
  const [sx, sy] = startAnchor(L.W);
  pts.push(...textBox(sx, sy, spacedWidth(m, "START", START_TEXT.size, START_TEXT.weight, START_TEXT.spacing), START_TEXT.size));
  // GOAL flag, the word GOAL and the caption.
  const [gx, gy] = goalAnchor(L.W);
  pts.push([gx - 2, gy - GOAL_MARK.post], [gx + GOAL_MARK.flag, gy - GOAL_MARK.post + GOAL_MARK.flagH]);
  pts.push(...textBox(gx, gy + GOAL_MARK.word, spacedWidth(m, "GOAL", START_TEXT.size, START_TEXT.weight, START_TEXT.spacing), START_TEXT.size));
  (decor.caption ?? []).forEach((line, i) => {
    pts.push(...textBox(gx, gy + GOAL_MARK.caption + i * CAPTION.lineHeight, Math.min(CAPTION.maxWidth, m(line, CAPTION.size, CAPTION.weight)), CAPTION.size));
  });
  // Signposts.
  L.blocks.forEach((_, i) => {
    const lines = decor.signs?.[i];
    if (!lines?.length) return;
    const [x, y] = signAnchor(L, i);
    lines.forEach((t, li) => {
      pts.push(...textBox(x, y - SIGN.first - (lines.length - 1 - li) * SIGN.line, spacedWidth(m, t, SIGN.size, SIGN.weight, SIGN.spacing), SIGN.size));
    });
  });
  return bounds(pts);
}
