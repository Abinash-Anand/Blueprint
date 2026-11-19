/**
 * Camera maths (pure). The camera is a centre and a zoom in iso pixels; the SVG viewBox follows from it and the
 * viewport size. Framing fits a box into the part of the viewport not covered by overlays (insets).
 */
import type { Box } from "./geometry";

export interface View { cx: number; cy: number; k: number }
export interface Size { w: number; h: number }
/** Parts of the viewport covered by overlays (top bar, controls, topic panel), in screen px. */
export interface Insets { top: number; right: number; bottom: number; left: number }
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Zoom limits. The lower limit lets "Whole city" fit the largest city into a short (landscape phone) map. */
export const ZOOM = { min: 0.15, max: 2.6 } as const;
export const clampK = (k: number) => Math.max(ZOOM.min, Math.min(ZOOM.max, Number.isFinite(k) ? k : 1));

/** How much of the free area a framed box may fill. */
export const FILL = { city: 0.92, district: { x: 0.8, y: 0.78 } } as const;

export const viewBoxOf = (v: View, s: Size) => `${v.cx - s.w / 2 / v.k} ${v.cy - s.h / 2 / v.k} ${s.w / v.k} ${s.h / v.k}`;

/** The world rectangle the camera shows. */
export const visibleRect = (v: View, s: Size): Box => ({ x: v.cx - s.w / 2 / v.k, y: v.cy - s.h / 2 / v.k, w: s.w / v.k, h: s.h / v.k });

/** Centre and zoom that show `box` as large as `fill` allows inside the free area, centred in it. */
export function fitView(box: Box, s: Size, ins: Insets = NO_INSETS, fill: number | { x: number; y: number } = FILL.city): View {
  const f = typeof fill === "number" ? { x: fill, y: fill } : fill;
  const aw = Math.max(1, s.w - ins.left - ins.right), ah = Math.max(1, s.h - ins.top - ins.bottom);
  const k = clampK(Math.min((aw * f.x) / Math.max(1, box.w), (ah * f.y) / Math.max(1, box.h)));
  return centreOn([box.x + box.w / 2, box.y + box.h / 2], k, ins);
}

/** Puts world point `p` in the middle of the free area at zoom k. */
export function centreOn(p: [number, number], k: number, ins: Insets = NO_INSETS): View {
  // Offset of the free area's centre from the viewport centre, in screen px.
  const sx = (ins.left - ins.right) / 2, sy = (ins.top - ins.bottom) / 2;
  return { cx: p[0] - sx / k, cy: p[1] - sy / k, k };
}

/** A camera kept per signed-in account and per city, for as long as the page lives (never across accounts). */
export interface CameraStore {
  get(owner: string, city: string): View | null;
  set(owner: string, city: string, v: View): void;
  clear(): void;
}

export function cameraStore(): CameraStore {
  const views = new Map<string, View>();
  const key = (owner: string, city: string) => `${owner}\u0000${city}`;
  return {
    get: (owner, city) => {
      const v = views.get(key(owner, city));
      return v ? { ...v } : null;
    },
    set: (owner, city, v) => void views.set(key(owner, city), { ...v }),
    clear: () => views.clear(),
  };
}
