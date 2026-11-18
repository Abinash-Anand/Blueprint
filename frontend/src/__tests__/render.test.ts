import { describe, expect, it } from "vitest";
import { layout } from "../map/geometry";
import { buildingSVG, renderCity, type RenderState } from "../map/render";
import { carPosition } from "../map/vehicle";
import { districts, topic } from "./fixtures";

const base: RenderState = {
  floors: () => 0, selectedId: null, currentTopicId: null, passed: [], currentIdx: 0, signs: [], car: { x: 0, y: 0, ax: "x" },
};

describe("city renderer", () => {
  it("escapes curriculum text placed into SVG markup", () => {
    const ds = structuredClone(districts);
    ds[0].name = "<script>alert(1)</script>";
    ds[0].topics[0] = topic("fe.a", { name: '"><img src=x onerror=alert(1)>' });
    const L = layout(ds);
    const svg = renderCity(L, { ...base, car: carPosition(L, { currentDistrictIndex: 0, districtFraction: 0 }) });
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("<img");
    expect(svg).toContain("&lt;SCRIPT&gt;");
  });

  it("draws a roof cap only for demonstrated topics", () => {
    const L = layout(districts);
    const b = L.route[0];
    const learned = buildingSVG(b, { ...base, floors: () => 3 });
    const demo = buildingSVG({ ...b, topic: { ...b.topic, status: "DEMONSTRATED" } }, { ...base, floors: () => 3 });
    const faces = (s: string) => (s.match(/class="face"/g) ?? []).length;
    expect(faces(demo)).toBe(faces(learned) + 3); // one extra box = the roof cap
    expect(learned).toContain("3 of 3 floors");
    expect(demo).toContain("demonstrated");
  });

  it("marks the current building and shows the dashed target outline while incomplete", () => {
    const L = layout(districts);
    const s = buildingSVG(L.route[0], { ...base, currentTopicId: "fe.a" });
    expect(s).toContain('class="curring"');
    expect(s).toContain('stroke-dasharray="3 3"');
  });

  it("renders month signposts and the car", () => {
    const L = layout(districts);
    const svg = renderCity(L, { ...base, signs: [["NOV–DEC"]], car: carPosition(L, { currentDistrictIndex: 0, districtFraction: 0.5 }) });
    expect(svg).toContain("NOV–DEC");
    expect(svg).toContain('class="car"');
  });
});
