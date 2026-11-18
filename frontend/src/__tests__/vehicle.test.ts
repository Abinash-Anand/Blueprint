import { describe, expect, it } from "vitest";
import { layout } from "../map/geometry";
import { alongPath, carPath, carPosition, pathLength, zone } from "../map/vehicle";
import { districts } from "./fixtures";

const L = layout(districts);

describe("car position (LLD §11.3)", () => {
  it("starts near START, in front of the first district", () => {
    const p = carPosition(L, { currentDistrictIndex: 0, districtFraction: 0 });
    expect(p.ax).toBe("x");
    expect(p.x).toBeCloseTo(-3.4);
    expect(p.x).toBeLessThan(L.blocks[0].x0);
  });

  it("advances monotonically with progress and stays in the gap between platforms", () => {
    for (let i = 0; i < 7; i++) {
      const z = zone(L, i);
      let prev = -Infinity;
      for (const f of [0, 0.25, 0.5, 0.8, 1]) {
        const p = carPosition(L, { currentDistrictIndex: i, districtFraction: f });
        const v = z.ax === "x" ? p.x : p.y;
        expect(v).toBeGreaterThanOrEqual(prev);
        expect(v).toBeLessThan(z.ax === "x" ? L.blocks[i].x0 : L.blocks[i].y0);
        if (i > 0) expect(v).toBeGreaterThan(z.ax === "x" ? L.blocks[i - 1].x1 : L.blocks[i - 1].y1);
        prev = v;
      }
    }
  });

  it("clamps bad fractions and parks at the goal when finished", () => {
    expect(carPosition(L, { currentDistrictIndex: 2, districtFraction: 5 })).toEqual(
      carPosition(L, { currentDistrictIndex: 2, districtFraction: 1 }),
    );
    const goal = L.W[L.W.length - 1];
    expect(carPosition(L, { currentDistrictIndex: 7, districtFraction: 1 })).toEqual({ x: goal[0], y: goal[1] - 1.6, ax: "y" });
  });
});

describe("car travel along the road", () => {
  it("follows the road corners when progress moves to a later district, and back", () => {
    const a = { pos: carPosition(L, { currentDistrictIndex: 0, districtFraction: 0.5 }), idx: 0 };
    const b = { pos: carPosition(L, { currentDistrictIndex: 2, districtFraction: 0.2 }), idx: 2 };
    const path = carPath(L, a, b);
    expect(path).toEqual([[a.pos.x, a.pos.y], L.W[1], L.W[2], [b.pos.x, b.pos.y]]);
    expect(carPath(L, b, a)).toEqual([[b.pos.x, b.pos.y], L.W[2], L.W[1], [a.pos.x, a.pos.y]]);
    expect(alongPath(path, 0, "x")).toMatchObject({ x: a.pos.x, y: a.pos.y });
    expect(alongPath(path, 1, "x")).toMatchObject({ x: b.pos.x, y: b.pos.y });
    // Every point on the way lies on a road segment (axis-aligned between corners).
    for (const p of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const q = alongPath(path, p, "x");
      const onSegment = path.slice(1).some(([x1, y1], i) => {
        const [x0, y0] = path[i];
        return (Math.abs(q.x - x0) < 1e-9 && Math.abs(q.x - x1) < 1e-9) || (Math.abs(q.y - y0) < 1e-9 && Math.abs(q.y - y1) < 1e-9);
      });
      expect(onSegment).toBe(true);
    }
    expect(pathLength(path)).toBeGreaterThan(0);
  });

  it("drives straight within one district", () => {
    const a = { pos: carPosition(L, { currentDistrictIndex: 1, districtFraction: 0 }), idx: 1 };
    const b = { pos: carPosition(L, { currentDistrictIndex: 1, districtFraction: 1 }), idx: 1 };
    expect(carPath(L, a, b)).toHaveLength(2);
    expect(alongPath(carPath(L, a, b), 0.5, a.pos.ax).ax).toBe(a.pos.ax);
  });
});
