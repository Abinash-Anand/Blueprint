/** Camera maths (B2) and camera ownership per account and city (B5). */
import { describe, expect, it } from "vitest";
import { cityBox, districtBox } from "../map/bounds";
import { FILL, type Insets, ZOOM, cameraStore, centreOn, fitView, visibleRect } from "../map/camera";
import { type Box, layout } from "../map/geometry";
import { estimateMeter, wrapCaption } from "../map/text";
import { REAL, assorted, city } from "./cityShapes";

const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x - 1e-6 && inner.y >= outer.y - 1e-6 && inner.x + inner.w <= outer.x + outer.w + 1e-6 && inner.y + inner.h <= outer.y + outer.h + 1e-6;

const VIEWPORTS = { phone: { w: 375, h: 560 }, "phone landscape": { w: 740, h: 320 }, tablet: { w: 768, h: 900 }, laptop: { w: 950, h: 744 }, desktop: { w: 1600, h: 950 } };
const INSETS: Record<string, Insets> = {
  none: { top: 0, right: 0, bottom: 0, left: 0 },
  "top bar and controls": { top: 50, right: 0, bottom: 48, left: 0 },
  "topic panel beside": { top: 50, right: 374, bottom: 48, left: 0 },
};
const cities = [...[1, 2, 3, 4, 5, 6, 7].map((n) => city(assorted(n))), ...Object.values(REAL).map((s) => city(s))];

describe("Whole city framing", () => {
  it("shows the whole city inside the free area at every viewport size, centred in it", () => {
    for (const ds of cities) {
      const L = layout(ds);
      const box = cityBox(L, { caption: wrapCaption("A goal for this city", estimateMeter) });
      for (const s of Object.values(VIEWPORTS)) for (const ins of Object.values(INSETS)) {
        if (s.w - ins.left - ins.right < 200) continue; // the panel covers a phone's map below, not beside it
        const v = fitView(box, s, ins, FILL.city);
        expect(v.k).toBeGreaterThanOrEqual(ZOOM.min);
        // The free area in world units.
        const free: Box = { x: v.cx - (s.w / 2 - ins.left) / v.k, y: v.cy - (s.h / 2 - ins.top) / v.k, w: (s.w - ins.left - ins.right) / v.k, h: (s.h - ins.top - ins.bottom) / v.k };
        expect(contains(free, box)).toBe(true);
        expect(contains(visibleRect(v, s), box)).toBe(true);
        // As large as allowed: the box fills the free area's limiting dimension.
        expect(Math.max(box.w / free.w, box.h / free.h)).toBeCloseTo(FILL.city, 2);
        expect(box.x + box.w / 2).toBeCloseTo(free.x + free.w / 2, 6);
      }
    }
  });

  it("gives smaller cities a closer view than larger ones", () => {
    const s = VIEWPORTS.laptop;
    const k = (ds: ReturnType<typeof city>) => fitView(cityBox(layout(ds)), s).k;
    expect(k(city(assorted(1)))).toBeGreaterThan(k(city(assorted(4))));
    expect(k(city(REAL["Angular City"]))).toBeGreaterThan(k(city(REAL["Engineering City"])));
  });

  it("frames a district with the same rules ('Where am I')", () => {
    const L = layout(city(REAL["German Language"]));
    const s = VIEWPORTS.laptop, ins = INSETS["topic panel beside"];
    for (const b of L.blocks) {
      const box = districtBox(b);
      expect(contains(visibleRect(fitView(box, s, ins, FILL.district), s), box)).toBe(true);
    }
  });

  it("centres a point in the free area, beside an open panel", () => {
    const v = centreOn([100, 50], 2, { top: 0, right: 300, bottom: 0, left: 0 });
    // The free area's centre is 150 px left of the viewport centre, i.e. 75 world units at zoom 2.
    expect(v).toEqual({ cx: 175, cy: 50, k: 2 });
  });
});

describe("camera store", () => {
  it("keeps one camera per account and city", () => {
    const st = cameraStore();
    st.set("u1", "german", { cx: 155, cy: 522, k: 0.543 });
    expect(st.get("u1", "german")).toEqual({ cx: 155, cy: 522, k: 0.543 });
    expect(st.get("u1", "angular")).toBeNull(); // another city never inherits it
    expect(st.get("u2", "german")).toBeNull(); // nor another account, even for the same city id
  });

  it("forgets everything on clear (sign-out, account change)", () => {
    const st = cameraStore();
    st.set("u1", "german", { cx: 1, cy: 2, k: 1 });
    st.clear();
    expect(st.get("u1", "german")).toBeNull();
  });

  it("hands out copies, so a moving camera cannot change a stored one", () => {
    const st = cameraStore();
    const v = { cx: 1, cy: 2, k: 1 };
    st.set("u1", "c", v);
    v.cx = 99;
    const got = st.get("u1", "c")!;
    got.k = 5;
    expect(st.get("u1", "c")).toEqual({ cx: 1, cy: 2, k: 1 });
  });
});
