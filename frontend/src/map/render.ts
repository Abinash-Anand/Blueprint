/**
 * SVG-string renderer, ported from the original page (DESIGN.md §2.3, §3).
 * Pure: (layout, state) → markup for one <g>. Every text value goes through esc().
 */
import { ACCENT, INK, PAPER, esc, mix } from "../lib/color";
import { BASE, FH, FP, type Block, type Building, type Layout, type Pt, iso } from "./geometry";
import { type CarPos, zone } from "./vehicle";

export interface RenderState {
  /** Learned sub-topics per topic id. */
  floors: (topicId: string) => number;
  selectedId: string | null;
  /** The selection just changed: play the short selection lift once (not on every redraw). */
  selectionEnter?: boolean;
  /** The backend's presentation state per topic (e.g. "topic.demonstrated"), exposed as data-state for styling hooks. */
  stateOf?: (topicId: string) => string | undefined;
  currentTopicId: string | null;
  /** Checkpoint passed per district index. */
  passed: boolean[];
  currentIdx: number;
  car: CarPos;
  /** Month signposts per district index, e.g. ["JAN–MAR"]. */
  signs: string[][];
}

const P = (pts: Pt[]) => pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");

function box(x0: number, y0: number, x1: number, y1: number, z0: number, h: number, cT: string, cL: string, cR: string, cls?: string) {
  const z1 = z0 + h, k = cls ? ` class="${cls}"` : "";
  return (
    `<polygon${k} fill="${cL}" points="${P([iso(x0, y1, z0), iso(x1, y1, z0), iso(x1, y1, z1), iso(x0, y1, z1)])}"/>` +
    `<polygon${k} fill="${cR}" points="${P([iso(x1, y0, z0), iso(x1, y1, z0), iso(x1, y1, z1), iso(x1, y0, z1)])}"/>` +
    `<polygon${k} fill="${cT}" points="${P([iso(x0, y0, z1), iso(x1, y0, z1), iso(x1, y1, z1), iso(x0, y1, z1)])}"/>`
  );
}

export function roadSVG(W: Pt[]): string {
  let s = "";
  const hw = 0.6;
  for (let i = 0; i < W.length - 1; i++) {
    const a = W[i], b = W[i + 1];
    const xa = Math.min(a[0], b[0]) - hw, xb = Math.max(a[0], b[0]) + hw, ya = Math.min(a[1], b[1]) - hw, yb = Math.max(a[1], b[1]) + hw;
    s += `<polygon fill="#d9d4c9" points="${P([iso(xa, ya), iso(xb, ya), iso(xb, yb), iso(xa, yb)])}"/>`;
  }
  s += `<polyline fill="none" stroke="#f3f0ea" stroke-width="2" stroke-dasharray="7 9" stroke-linecap="round" points="${P(W.map((p) => iso(p[0], p[1])))}"/>`;
  const st = iso(W[0][0] - 0.3, W[0][1] - 1.0);
  s += `<text class="roadtext" text-anchor="middle" x="${st[0]}" y="${st[1]}">START</text>`;
  const e = W[W.length - 1], [gx, gy] = iso(e[0], e[1] + 0.4);
  s +=
    `<line x1="${gx}" y1="${gy}" x2="${gx}" y2="${gy - 64}" stroke="${INK}" stroke-width="2"/>` +
    `<path d="M${gx} ${gy - 64} l30 9 l-30 9z" fill="#5f7480"/>` +
    `<text class="roadtext" text-anchor="middle" x="${gx}" y="${gy + 24}" style="fill:${INK}">GOAL</text>` +
    `<text text-anchor="middle" x="${gx}" y="${gy + 42}" font-size="12" fill="#6c6f71">Strong full-stack engineer</text>`;
  return s;
}

/** Month signposts beside the road gap in front of each district (DESIGN.md §8 "Do"). */
function signsSVG(L: Layout, signs: string[][]): string {
  let s = "";
  L.blocks.forEach((_, i) => {
    const lines = signs[i];
    if (!lines?.length) return;
    const z = zone(L, i);
    const mid = (z.start + z.end) / 2;
    const [x, y] = z.ax === "x" ? iso(mid, z.fixed - 1.25) : iso(z.fixed - 1.25, mid);
    s += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y - 14}" stroke="#b9b4a9" stroke-width="1"/>`;
    lines.forEach((t, li) => {
      s += `<text class="signtext" text-anchor="middle" x="${x}" y="${y - 19 - (lines.length - 1 - li) * 13}">${esc(t)}</text>`;
    });
  });
  return s;
}

function platform(b: Block): string {
  const c = b.district.color;
  let s = `<polygon fill="rgba(60,55,45,.07)" points="${P([iso(b.x0 + 0.35, b.y0 + 0.35, -0.32), iso(b.x1 + 0.35, b.y0 + 0.35, -0.32), iso(b.x1 + 0.35, b.y1 + 0.35, -0.32), iso(b.x0 + 0.35, b.y1 + 0.35, -0.32)])}"/>`;
  s += box(b.x0, b.y0, b.x1, b.y1, -0.32, 0.32, mix(c, PAPER, 0.74), mix(c, PAPER, 0.42), mix(c, PAPER, 0.25));
  const [lx, ly] = iso(b.x0 + 0.32, b.y1 - 0.2);
  s += `<text class="dlabel" fill="${mix(c, INK, 0.5)}" transform="matrix(0.894 0.447 -0.894 0.447 ${lx.toFixed(1)} ${ly.toFixed(1)})">${esc(b.district.name.toUpperCase())}</text>`;
  return s;
}

export function buildingSVG(b: Building, st: RenderState): string {
  const t = b.topic, c = b.block.district.color, n = t.subtopics.length;
  const demonstrated = t.status === "DEMONSTRATED";
  // A demonstrated topic is drawn complete with its roof cap (FR-MAP-06).
  const k = demonstrated ? n : Math.min(st.floors(t.id), n);
  const H = BASE + n * FH, h = BASE + k * FH;
  const { x0, y0, x1, y1 } = b;
  const label = `${b.block.district.name}: ${t.name}, ${k} of ${n} floors${demonstrated ? ", demonstrated" : ""}`;
  const sel = t.id === st.selectedId;
  const state = st.stateOf?.(t.id);
  let s =
    `<g class="bld${sel ? " sel" : ""}${sel && st.selectionEnter ? " enter" : ""}" data-t="${esc(t.id)}"` +
    `${state ? ` data-state="${esc(state)}"` : ""} tabindex="0" role="button" aria-label="${esc(label)}"${sel ? ' aria-current="true"' : ""}>`;
  // The ground outline stays put; the building itself (.vis) lifts on hover and selection, the hit area never moves.
  if (sel) {
    const e = 0.2;
    s += `<polygon fill="none" stroke="${INK}" stroke-width="1.6" points="${P([iso(x0 - e, y0 - e), iso(x1 + e, y0 - e), iso(x1 + e, y1 + e), iso(x0 - e, y1 + e)])}"/>`;
  } else if (t.id === st.currentTopicId) {
    const e = 0.22;
    s += `<polygon class="curring" fill="none" stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="4 3" points="${P([iso(x0 - e, y0 - e), iso(x1 + e, y0 - e), iso(x1 + e, y1 + e), iso(x0 - e, y1 + e)])}"/>`;
  }
  s += `<g class="vis">`;
  if (k === 0) {
    s += box(x0, y0, x1, y1, 0, BASE, mix(c, PAPER, 0.55), mix(c, PAPER, 0.35), mix(c, PAPER, 0.2), "face");
  } else {
    s += box(x0, y0, x1, y1, 0, h, mix(c, "#ffffff", 0.3), c, mix(c, "#000000", 0.16), "face");
    const ln = mix(c, "#000000", 0.3);
    for (let f = 1; f < k; f++) {
      const z = BASE + f * FH;
      s += `<polyline fill="none" stroke="${ln}" stroke-opacity=".35" stroke-width="1" points="${P([iso(x0, y1, z), iso(x1, y1, z), iso(x1, y0, z)])}"/>`;
    }
    if (demonstrated) {
      const e = 0.16;
      s += box(x0 + e, y0 + e, x1 - e, y1 - e, h, 0.07, mix(c, INK, 0.25), mix(c, INK, 0.35), mix(c, INK, 0.45), "face");
    }
  }
  if (k < n) {
    const g = mix(c, INK, 0.25);
    s +=
      `<path fill="none" stroke="${g}" stroke-opacity=".5" stroke-width="1" stroke-dasharray="3 3" d="` +
      `M${P([iso(x0, y0, H)])} L${P([iso(x1, y0, H)])} L${P([iso(x1, y1, H)])} L${P([iso(x0, y1, H)])} Z ` +
      `M${P([iso(x0, y1, h)])} L${P([iso(x0, y1, H)])} M${P([iso(x1, y1, h)])} L${P([iso(x1, y1, H)])} M${P([iso(x1, y0, h)])} L${P([iso(x1, y0, H)])}"/>`;
  }
  s += `</g><polygon class="hit" points="${P([iso(x0, y1), iso(x1, y1), iso(x1, y0), iso(x1, y0, H + 0.1), iso(x0, y0, H + 0.1), iso(x0, y1, H + 0.1)])}"/>`;
  return s + "</g>";
}

export function carSVG(p: CarPos): string {
  const lx = p.ax === "x" ? 0.78 : 0.44, ly = p.ax === "x" ? 0.44 : 0.78;
  const [gx, gy] = iso(p.x, p.y);
  let s = `<ellipse class="pulse" cx="${gx}" cy="${gy}" rx="34" ry="17" fill="none" stroke="${ACCENT}" stroke-width="2"/>`;
  s += box(p.x - lx / 2, p.y - ly / 2, p.x + lx / 2, p.y + ly / 2, 0.05, 0.24, "#6d808a", "#4f616a", "#3f4f57");
  const cx = lx * 0.28, cy = ly * 0.28;
  s += box(p.x - lx / 2 + cx, p.y - ly / 2 + cy, p.x + lx / 2 - cx, p.y + ly / 2 - cy, 0.29, 0.17, "#a9b9c0", "#7f939c", "#6c7f88");
  return `<g class="car" aria-hidden="true">${s}</g>`;
}

function badge(b: Block, st: RenderState): string {
  const [x, y] = iso(b.x0 - 0.35, b.y1 + 0.35);
  const c = b.district.color;
  const state = st.passed[b.idx] ? "done" : b.idx === st.currentIdx ? "cur" : "later";
  const fill = state === "done" ? mix(c, INK, 0.15) : PAPER;
  const stroke = state === "cur" ? INK : mix(c, INK, 0.3);
  const tcol = state === "done" ? PAPER : INK;
  const label = `Checkpoint ${b.idx + 1}: ${b.district.name}${state === "done" ? ", passed" : state === "cur" ? ", current" : ""}`;
  return (
    `<g class="badge" data-d="${b.idx}" role="button" tabindex="0" aria-label="${esc(label)}">` +
    `<line x1="${x}" y1="${y}" x2="${x}" y2="${y - 40}" stroke="${mix(c, INK, 0.35)}" stroke-width="1.5"/>` +
    `<circle cx="${x}" cy="${y - 54}" r="14" fill="${fill}" stroke="${stroke}" stroke-width="${state === "cur" ? 2.2 : 1.4}"/>` +
    `<text x="${x}" y="${y - 49.5}" text-anchor="middle" font-size="13" font-weight="700" fill="${tcol}">${state === "done" ? "✓" : b.idx + 1}</text></g>`
  );
}

/** Draw order (DESIGN.md §3): road → platforms → buildings and car by depth → badges. */
export function renderCity(L: Layout, st: RenderState, road = roadSVG(L.W)): string {
  const out = [road, signsSVG(L, st.signs)];
  for (const b of L.blocks) out.push(platform(b));
  const objs: { z: number; f: () => string }[] = L.route.map((b) => ({ z: b.x0 + b.y0 + FP, f: () => buildingSVG(b, st) }));
  objs.push({ z: st.car.x + st.car.y, f: () => carSVG(st.car) });
  objs.sort((a, b) => a.z - b.z).forEach((o) => out.push(o.f()));
  for (const b of L.blocks) out.push(badge(b, st));
  return out.join("");
}
