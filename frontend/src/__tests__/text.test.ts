/** District labels fitted to their platform (B4) and the GOAL caption from the city's own goal (B3). */
import { describe, expect, it } from "vitest";
import { labelSpace } from "../map/bounds";
import { layout } from "../map/geometry";
import { renderCity, roadSVG } from "../map/render";
import { CAPTION, LABEL, type Meter, estimateMeter, fitLabel, spacedWidth, wrapCaption } from "../map/text";
import { carPosition } from "../map/vehicle";
import { REAL, city } from "./cityShapes";

const width = (m: Meter, f: { text: string; size: number; spacing: number }) => spacedWidth(m, f.text, f.size, LABEL.weight, f.spacing);
/** A narrower meter, like the real font (the label must use the room it has, not the estimate's). */
const narrow: Meter = (t, px, w) => estimateMeter(t, px, w) * 0.9;
const EDGES = { "2 columns": 128.8, "3 columns": 178.9, "4 columns": 229, "5 columns": 279.1 };

describe("district labels", () => {
  it("leaves short names exactly as styled", () => {
    for (const name of ["DATABASE", "AI ENGINEERING", "BASICS"]) {
      expect(fitLabel(name, 178, estimateMeter)).toEqual({ text: name, size: LABEL.size, spacing: LABEL.spacing, truncated: false });
    }
  });

  const names = [...REAL["German Language"], ...REAL["Angular City"], ...REAL["Tech City"], ...REAL["Engineering City"]].map((s) => s.name.toUpperCase());
  it.each(Object.entries(EDGES))("fits every reproduced name on a %s platform, never below the minimum size", (_, avail) => {
    for (const m of [estimateMeter, narrow]) for (const name of names) {
      const f = fitLabel(name, avail, m);
      expect(width(m, f)).toBeLessThanOrEqual(avail + 1e-6);
      expect(f.size).toBeGreaterThanOrEqual(LABEL.minSize);
      expect(f.size).toBeLessThanOrEqual(LABEL.size);
      if (f.truncated) {
        expect(f.text.endsWith("…")).toBe(true);
        expect(name.startsWith(f.text.slice(0, -1).trimEnd())).toBe(true);
      } else expect(f.text).toBe(name);
    }
  });

  it("changes as little as needed: shrinks first, shortens only when even the smallest size is too long", () => {
    const slightly = fitLabel("FRONTEND ENGINEERING", 228, estimateMeter);
    expect(slightly.truncated).toBe(false);
    expect(slightly.size).toBeLessThan(LABEL.size);
    expect(slightly.size).toBeGreaterThan(LABEL.minSize);
    const long = fitLabel("INTERMEDIATE: INDEPENDENT COMMUNICATION", 228, estimateMeter);
    expect(long.truncated).toBe(true);
    expect(long.text.startsWith("INTERMEDIATE: INDEPEN")).toBe(true);
    const tiny = fitLabel("ROUTING & NAVIGATION DISTRICT", 117, estimateMeter);
    expect(tiny.text).toMatch(/^ROUTING & NA.*…$/); // keeps as much as fits, never "ROUTING &…"
    expect(tiny.text).not.toMatch(/&…$/);
    // A word boundary is used when it costs little.
    expect(fitLabel("FOUNDATIONS: SURVIVAL GERMAN", 217, estimateMeter).text).toBe("FOUNDATIONS: SURVIVAL…");
  });

  it.each(Object.keys(REAL))("%s: every rendered label fits its platform's front edge", (name) => {
    const L = layout(city(REAL[name]));
    const svg = renderCity(L, {
      floors: () => 0, selectedId: null, currentTopicId: null, passed: [], currentIdx: 0,
      car: carPosition(L, { currentDistrictIndex: 0, districtFraction: 0 }), signs: [],
    });
    const labels = [...svg.matchAll(/<text class="dlabel"([^>]*)>([^<]*)<\/text>/g)];
    expect(labels).toHaveLength(L.blocks.length);
    labels.forEach((m, i) => {
      const style = /style="font-size:([\d.]+)px;letter-spacing:([\d.]+)em"/.exec(m[1]);
      const size = style ? +style[1] : LABEL.size, spacing = style ? +style[2] : LABEL.spacing;
      const text = m[2].replace(/&amp;/g, "&");
      expect(spacedWidth(estimateMeter, text, size, LABEL.weight, spacing)).toBeLessThanOrEqual(labelSpace(L.blocks[i]) + 1e-6);
    });
    // A shortened label keeps the full name for assistive technology.
    for (const m of svg.matchAll(/<text class="dlabel"[^>]*aria-label="([^"]+)"[^>]*>([^<]*)</g)) expect(m[2].endsWith("…")).toBe(true);
  });
});

describe("GOAL caption", () => {
  it("shows the city's own goal, and nothing when there is none", () => {
    const W = layout(city(REAL["Angular City"])).W;
    expect(roadSVG(W, wrapCaption("Become Strong in angular development", estimateMeter))).toContain("Become Strong in angular development");
    expect(roadSVG(W, wrapCaption("", estimateMeter))).not.toContain("goalcap");
    expect(roadSVG(W, wrapCaption(null, estimateMeter))).not.toContain("goalcap");
    expect(roadSVG(W)).not.toMatch(/full-stack/);
  });

  it("wraps a long goal into at most two lines that fit, shortening the rest", () => {
    const goal = "I want to reach to german C1 level so that i can speak like a native speaker";
    for (const m of [estimateMeter, narrow]) {
      const lines = wrapCaption(goal, m);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.length).toBeLessThanOrEqual(CAPTION.maxLines);
      for (const l of lines) expect(m(l, CAPTION.size, CAPTION.weight)).toBeLessThanOrEqual(CAPTION.maxWidth);
      expect(goal.startsWith(lines[0])).toBe(true);
    }
    expect(wrapCaption("Full stack engineer", estimateMeter)).toEqual(["Full stack engineer"]);
    // One enormous word is shortened rather than overflowing.
    const [only] = wrapCaption("x".repeat(200), estimateMeter);
    expect(only.endsWith("…")).toBe(true);
    expect(estimateMeter(only, CAPTION.size, CAPTION.weight)).toBeLessThanOrEqual(CAPTION.maxWidth);
  });

  it("escapes the goal text", () => {
    const W = layout(city(REAL["Angular City"])).W;
    expect(roadSVG(W, ["<script>&"])).toContain("&lt;script&gt;&amp;");
  });
});
