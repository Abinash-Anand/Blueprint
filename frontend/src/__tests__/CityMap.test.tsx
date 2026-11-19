/** The map component's camera (B2, B5) and GOAL caption (B3), in jsdom with a stubbed viewport size. */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Curriculum, District, Progress } from "../api/types";
import { CityMap } from "../components/CityMap";
import { cityBox, districtBox } from "../map/bounds";
import { type CameraStore, FILL, type View, cameraStore, fitView, visibleRect } from "../map/camera";
import { type Box, layout } from "../map/geometry";
import { estimateMeter, wrapCaption } from "../map/text";
import { REAL, city } from "./cityShapes";

const vp = { w: 950, h: 744 };
const saved: PropertyDescriptor[] = [];
beforeAll(() => {
  saved.push(Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth")!, Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!);
  Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, get: () => vp.w });
  Object.defineProperty(Element.prototype, "clientHeight", { configurable: true, get: () => vp.h });
  document.documentElement.dataset.motion = "reduce"; // camera moves land at once
});
afterAll(() => {
  Object.defineProperty(Element.prototype, "clientWidth", saved[0]);
  Object.defineProperty(Element.prototype, "clientHeight", saved[1]);
  delete document.documentElement.dataset.motion;
});
afterEach(() => {
  vp.w = 950;
  vp.h = 744;
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

const GERMAN = city(REAL["German Language"], "de"), ANGULAR = city(REAL["Angular City"], "ng");
const GOALS: Record<string, string> = { de: "I want to reach to german C1 level so that i can speak like a native speaker", ng: "Become Strong in angular development" };

function progress(currentDistrictIndex: number): Progress {
  return { today: "2026-11-19", districts: [], road: { currentDistrictIndex, districtFraction: 0.3, overall: 0.1, currentTopicId: null } } as unknown as Progress;
}

/** The map as App mounts it: the camera bound to one account and one city in the session's store. */
function mount(store: CameraStore, user: string, ds: District[], current = 1) {
  const cityId = ds[0].id.slice(0, 2);
  const camera = { load: () => store.get(user, cityId), save: (v: View) => store.set(user, cityId, v) };
  const curriculum: Curriculum = { districts: ds, stages: [] };
  return render(
    <CityMap
      layout={layout(ds)} curriculum={curriculum} progress={progress(current)} currentTopicId={null} selectedId={null} focus={null}
      goal={GOALS[cityId]} camera={camera} today="2026-11-19" onOpenTopic={() => {}} onClose={() => {}}
    />,
  );
}

/** The camera as the SVG shows it. */
function shown(): View | null {
  const vb = document.querySelector("svg.world")?.getAttribute("viewBox");
  if (!vb) return null;
  const [x, y, w, h] = vb.split(" ").map(Number);
  return { cx: x + w / 2, cy: y + h / 2, k: vp.w / w };
}
const near = (a: View | null, b: View) => {
  expect(a).not.toBeNull();
  expect(a!.cx).toBeCloseTo(b.cx, 3);
  expect(a!.cy).toBeCloseTo(b.cy, 3);
  expect(a!.k).toBeCloseTo(b.k, 4);
};
const contains = (o: Box, i: Box) => i.x >= o.x - 1e-6 && i.y >= o.y - 1e-6 && i.x + i.w <= o.x + o.w + 1e-6 && i.y + i.h <= o.y + o.h + 1e-6;
const districtView = (ds: District[], i: number) => fitView(districtBox(layout(ds).blocks[i]), vp, undefined, FILL.district);
const wholeCity = (ds: District[]) => cityBox(layout(ds), { signs: ds.map(() => []), caption: wrapCaption(GOALS[ds[0].id.slice(0, 2)], estimateMeter) });

describe("city map camera", () => {
  it("opens on the current district of a city it has not shown before", () => {
    mount(cameraStore(), "u1", GERMAN, 2);
    near(shown(), districtView(GERMAN, 2));
  });

  it("opens on the whole city once every district is passed", () => {
    mount(cameraStore(), "u1", ANGULAR, ANGULAR.length);
    near(shown(), fitView(wholeCity(ANGULAR), vp, undefined, FILL.city));
  });

  it("'Whole city' frames every drawn element, at several viewport sizes", () => {
    for (const size of [{ w: 950, h: 744 }, { w: 375, h: 560 }, { w: 740, h: 320 }, { w: 1600, h: 950 }]) {
      Object.assign(vp, size);
      const { unmount } = mount(cameraStore(), "u1", GERMAN);
      fireEvent.click(screen.getByRole("button", { name: "Whole city" }));
      const v = shown()!;
      expect(contains(visibleRect(v, vp), wholeCity(GERMAN))).toBe(true);
      unmount();
    }
  });

  it("never carries one city's camera into another, and restores each city's own", () => {
    const store = cameraStore();
    // German: zoom out to the whole city, then switch city.
    const de = mount(store, "u1", GERMAN, 0);
    fireEvent.click(screen.getByRole("button", { name: "Whole city" }));
    const germanWhole = shown()!;
    de.unmount();
    // Angular opens on its own current district, not on the German whole-city view.
    const ng = mount(store, "u1", ANGULAR, 1);
    near(shown(), districtView(ANGULAR, 1));
    expect(shown()!.k).not.toBeCloseTo(germanWhole.k, 2);
    ng.unmount();
    // Back in German, its own camera is still there.
    mount(store, "u1", GERMAN, 0).unmount();
    expect(store.get("u1", "de")).toEqual(germanWhole);
  });

  it("keeps the camera when switching tabs within the same city", () => {
    const store = cameraStore();
    const a = mount(store, "u1", GERMAN, 0);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const zoomed = shown()!;
    a.unmount(); // the City tab is left
    mount(store, "u1", GERMAN, 0); // and opened again
    near(shown(), zoomed);
  });

  it("does not reuse a camera after sign-out or for another account", () => {
    const store = cameraStore();
    const a = mount(store, "u1", GERMAN, 0);
    fireEvent.click(screen.getByRole("button", { name: "Whole city" }));
    a.unmount();
    // Another account with a city of the same id starts fresh.
    const b = mount(store, "u2", GERMAN, 3);
    near(shown(), districtView(GERMAN, 3));
    b.unmount();
    // Sign-out empties the store (Session calls clear()); the next sign-in starts fresh too.
    store.clear();
    mount(store, "u1", GERMAN, 0);
    near(shown(), districtView(GERMAN, 0));
  });

  it("waits for the map to have a size before framing it (a hidden or not yet laid out map)", () => {
    let notify: () => void = () => {};
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      constructor(cb: () => void) { notify = cb; }
      observe() {}
      disconnect() {}
    };
    vp.w = 0;
    vp.h = 0;
    const store = cameraStore();
    mount(store, "u1", ANGULAR, 1);
    expect(store.get("u1", "ng")).toBeNull(); // nothing framed against a 0×0 map
    vp.w = 950;
    vp.h = 744;
    notify();
    near(shown(), districtView(ANGULAR, 1));
  });
});

describe("GOAL caption", () => {
  it("shows each city's own goal", () => {
    const a = mount(cameraStore(), "u1", ANGULAR);
    const svg = document.querySelector("svg.world")!.innerHTML;
    expect(svg).toContain("Become Strong in angular development");
    expect(svg).not.toContain("Strong full-stack engineer");
    a.unmount();
    mount(cameraStore(), "u1", GERMAN);
    const de = [...document.querySelectorAll("svg.world text.goalcap")].map((t) => t.textContent).join(" ");
    expect(de.startsWith("I want to reach to german")).toBe(true);
  });
});
