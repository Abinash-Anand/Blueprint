import { describe, expect, it } from "vitest";
import { layout } from "../map/geometry";
import { carPosition, zone } from "../map/vehicle";
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
