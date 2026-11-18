/** Colour helpers from the original page (DESIGN.md §2.2: all shades come from mix()). */
export const INK = "#2e3133";
export const PAPER = "#f6f4ef";
export const ACCENT = "#3f5a66";

const hx = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export function mix(a: string, b: string, t: number): string {
  const A = hx(a);
  const B = hx(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escape text before it is placed in SVG markup. */
export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
