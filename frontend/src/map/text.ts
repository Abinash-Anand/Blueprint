/**
 * Text on the map: measuring, fitting district labels to their platform edge and wrapping the GOAL caption.
 * The renderer builds SVG strings and cannot measure, so a Meter is passed in: canvasMeter() in the browser (the real
 * font), estimateMeter in tests and as the fallback. Both return the width of the glyphs only; letter-spacing is added here.
 */

/** Width in px of `text` at `px` font size and `weight`, without letter-spacing. */
export type Meter = (text: string, px: number, weight: number) => number;

/** Deterministic, slightly generous estimate (bold uppercase ≈ 0.61 em per character, regular mixed case ≈ 0.44 em). */
export const estimateMeter: Meter = (text, px, weight) => text.length * px * (weight >= 600 ? 0.64 : 0.5);

/** Measures with the page's own font through an offscreen canvas; falls back to the estimate where there is no canvas. */
export function canvasMeter(fontFamily: string): Meter {
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  try {
    ctx = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(1, 1).getContext("2d") : null;
  } catch {
    ctx = null;
  }
  if (!ctx) return estimateMeter;
  const cache = new Map<string, number>();
  return (text, px, weight) => {
    const key = `${weight}|${px}|${text}`;
    let w = cache.get(key);
    if (w === undefined) {
      ctx!.font = `${weight} ${px}px ${fontFamily}`;
      w = ctx!.measureText(text).width;
      cache.set(key, w);
    }
    return w;
  };
}

/** Width with letter-spacing (in em), which SVG adds after every character. */
export const spacedWidth = (m: Meter, text: string, px: number, weight: number, spacingEm: number) =>
  m(text, px, weight) + spacingEm * px * text.length;

/* ---------------- district labels ---------------- */

/** The label style of styles.css `.dlabel`, and how far it may give way before the name is shortened. */
export const LABEL = { size: 15, minSize: 12, weight: 700, spacing: 0.16, minSpacing: 0.06 } as const;

export interface FittedLabel {
  text: string;
  size: number;
  spacing: number;
  /** The name was shortened (the full name stays available to assistive technology and the sidebar). */
  truncated: boolean;
}

/**
 * Fits an (uppercase) district name into `avail` px, changing as little as possible: the full style if it fits;
 * otherwise a smaller font (down to LABEL.minSize), then tighter letter-spacing; only then the name is shortened
 * at a word boundary where possible, with an ellipsis.
 */
export function fitLabel(name: string, avail: number, m: Meter): FittedLabel {
  const { size, minSize, weight, spacing, minSpacing } = LABEL;
  const width = (t: string, px: number, sp: number) => spacedWidth(m, t, px, weight, sp);
  if (width(name, size, spacing) <= avail) return { text: name, size, spacing, truncated: false };
  // The size at which the name fits with the normal spacing (width scales with the font size).
  const scaled = Math.floor(((size * avail) / width(name, size, spacing)) * 10) / 10;
  if (scaled >= minSize) return { text: name, size: scaled, spacing, truncated: false };
  for (const sp of [0.11, minSpacing]) if (width(name, minSize, sp) <= avail) return { text: name, size: minSize, spacing: sp, truncated: false };
  return { text: shorten(name, (t) => width(t, minSize, minSpacing) <= avail), size: minSize, spacing: minSpacing, truncated: true };
}

/** Joining words and punctuation a shortened text should not end on. */
const DANGLING = /[\s:,;·–—&+/-]+$/;

/**
 * The longest prefix plus "…" that passes `fits`. It ends at a word boundary when that keeps at least 75% of what
 * fits, so "FOUNDATIONS: SURVIVAL…" rather than "FOUNDATIONS: SURVIVAL GE…", but "ROUTING & NAVI…" rather than "ROUTING…".
 */
function shorten(text: string, fits: (t: string) => boolean): string {
  let byChar = "";
  for (let n = text.length - 1; n >= 1; n--) {
    const t = text.slice(0, n).replace(DANGLING, "");
    if (t && fits(t + "…")) { byChar = t; break; }
  }
  if (!byChar) return "…";
  const words = text.split(/\s+/);
  for (let n = words.length - 1; n >= 1; n--) {
    const t = words.slice(0, n).join(" ").replace(DANGLING, "");
    if (t && fits(t + "…")) return t.length >= 0.75 * byChar.length ? t + "…" : byChar + "…";
  }
  return byChar + "…";
}

/* ---------------- GOAL caption ---------------- */

/** Caption under the GOAL flag: the city's goal in up to two centred lines no wider than maxWidth. */
export const CAPTION = { size: 12, weight: 400, lineHeight: 15, maxWidth: 220, maxLines: 2 } as const;

export function wrapCaption(goal: string | null | undefined, m: Meter): string[] {
  const text = (goal ?? "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const { size, weight, maxWidth, maxLines } = CAPTION;
  const fits = (t: string) => m(t, size, weight) <= maxWidth;
  const lines: string[] = [];
  let line = "";
  const words = text.split(" ");
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (fits(next)) { line = next; continue; }
    if (!line) { line = next; continue; } // a single word wider than the line: shortened when the line is closed
    lines.push(fits(line) ? line : shorten(line, fits));
    line = words[i];
    if (lines.length === maxLines - 1) {
      // Last line: the rest of the text, shortened to fit.
      const rest = [line, ...words.slice(i + 1)].join(" ");
      lines.push(fits(rest) ? rest : shorten(rest, fits));
      return lines;
    }
  }
  lines.push(fits(line) ? line : shorten(line, fits));
  return lines;
}
