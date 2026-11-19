/** The semantic palette stays readable: every tone's text, solid and icon colours meet WCAG AA (sprint palette). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast } from "../lib/contrast";

const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
const token = (name: string) => {
  const all = [...css.matchAll(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`, "g"))];
  expect(all.length, name).toBeGreaterThan(0);
  return all[all.length - 1][1]; // the last definition wins
};
const PAPER = "#f6f4ef", PAGE = "#e9e6df", WHITE = "#ffffff";
const TONES = ["success", "warning", "danger", "info", "neutral", "ai"];

describe("semantic palette contrast (WCAG 2.2 AA)", () => {
  it.each(TONES)("%s: text on soft fill, paper and white ≥ 4.5; white on solid ≥ 4.5; icons ≥ 3", (t) => {
    const strong = token(`--${t}`), bg = token(`--${t}-bg`), mid = token(`--${t}-mid`), solid = token(`--${t}-solid`);
    expect(contrast(strong, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(strong, PAPER)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(strong, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(WHITE, solid)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(mid, bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(mid, WHITE)).toBeGreaterThanOrEqual(3);
  });

  it("keeps a visible focus ring and readable primary buttons", () => {
    expect(contrast(token("--focus"), PAGE)).toBeGreaterThanOrEqual(3);
    expect(contrast(token("--focus"), PAPER)).toBeGreaterThanOrEqual(3);
    expect(contrast(WHITE, token("--accent"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(WHITE, token("--accent-hover"))).toBeGreaterThanOrEqual(4.5);
  });

  it("uses six distinct tones", () => {
    expect(new Set(TONES.map((t) => token(`--${t}`))).size).toBe(6);
  });
});
