/**
 * The isometric city (DESIGN.md §3–§6). Rendering is a pure string renderer injected into one <g>;
 * this component owns the camera (view box), input handling, car animation and the topic panel.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Curriculum, Progress } from "../api/types";
import { esc } from "../lib/color";
import { PRIORITY_LABEL, monthRange } from "../lib/format";
import { cityBox, districtBox } from "../map/bounds";
import { FILL, type Insets, type Size, type View, centreOn, clampK, fitView, viewBoxOf } from "../map/camera";
import { type Building, type Layout, buildingHeight, iso } from "../map/geometry";
import { renderCity, roadSVG } from "../map/render";
import { canvasMeter, wrapCaption } from "../map/text";
import { type CarPos, alongPath, carPath, carPosition, pathLength } from "../map/vehicle";
import { MOTION, easeInOut, prefersReducedMotion, useAnimatedNumber } from "../lib/motion";
import { TopicPanel } from "./TopicPanel";

export interface Focus {
  kind: "topic" | "district" | "here";
  id?: string;
  idx?: number;
  n: number;
}

interface Props {
  layout: Layout;
  curriculum: Curriculum;
  progress: Progress;
  currentTopicId: string | null;
  selectedId: string | null;
  focus: Focus | null;
  /** The city's goal, shown under GOAL (nothing when empty). */
  goal?: string | null;
  /** Where this city's camera is kept (per account and city); without one the camera starts fresh each time. */
  camera?: { load: () => View | null; save: (v: View) => void };
  today: string;
  onOpenTopic: (id: string) => void;
  onClose: () => void;
}

const reduceMotion = prefersReducedMotion;

/** Month signposts from the main stages of each district (plus the parallel track). */
function signposts(c: Curriculum): string[][] {
  return c.districts.map((d) => {
    const st = c.stages.filter((s) => s.districtIds.includes(d.id));
    const main = st.filter((s) => s.kind === "MAIN").map((s) => monthRange(s.startDate, s.endDate));
    const par = st.filter((s) => s.kind === "PARALLEL").map((s) => `SAT ${monthRange(s.startDate, s.endDate)}`);
    return [...par, ...main];
  });
}

export function CityMap({ layout: L, curriculum, progress, currentTopicId, selectedId, focus, goal, camera, today, onOpenTopic, onClose }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const layerRef = useRef<SVGGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const ctrlsRef = useRef<HTMLDivElement>(null);
  // This city's camera from earlier in the session (switching tabs), if any.
  const saved = useRef(camera?.load() ?? null);
  const view = useRef<View>(saved.current ?? { cx: 0, cy: 0, k: 1 });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const anim = useRef<number | null>(null);
  const carAnim = useRef<number | null>(null);
  const carShown = useRef<{ pos: CarPos; idx: number } | null>(null);

  // Text is measured in the page's own font, so labels and the GOAL caption fit what is actually drawn.
  const meter = useMemo(() => canvasMeter(getComputedStyle(document.body).fontFamily || "sans-serif"), []);
  const caption = useMemo(() => wrapCaption(goal, meter), [goal, meter]);
  const road = useMemo(() => roadSVG(L.W, caption), [L, caption]);
  const signs = useMemo(() => signposts(curriculum), [curriculum]);
  const byId = useMemo(() => new Map(L.route.map((b) => [b.topic.id, b])), [L]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  /* ---------------- camera ---------------- */
  const size = (): Size => ({ w: svgRef.current?.clientWidth || 1, h: svgRef.current?.clientHeight || 1 });
  const applyView = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.setAttribute("viewBox", viewBoxOf(view.current, size()));
    cameraRef.current?.save(view.current);
  }, []);

  const stopAnim = () => {
    if (anim.current) cancelAnimationFrame(anim.current);
    anim.current = null;
  };

  const flyTo = useCallback((cx: number, cy: number, k: number) => {
    stopAnim();
    k = clampK(k);
    if (reduceMotion()) {
      view.current = { cx, cy, k };
      applyView();
      return;
    }
    const s = { ...view.current }, t0 = performance.now(), dur = MOTION.travel;
    const step = (t: number) => {
      const p = easeInOut(Math.min(1, (t - t0) / dur));
      view.current = { cx: s.cx + (cx - s.cx) * p, cy: s.cy + (cy - s.cy) * p, k: s.k + (k - s.k) * p };
      applyView();
      anim.current = p < 1 ? requestAnimationFrame(step) : null;
    };
    anim.current = requestAnimationFrame(step);
  }, [applyView]);

  /** Screen px covered by the top bar, the zoom controls and the topic panel (beside the map on wide screens, below on narrow). */
  const insets = useCallback((): Insets => {
    const ins = { top: 0, right: 0, bottom: 0, left: 0 };
    const top = topRef.current, ctrls = ctrlsRef.current, p = panelRef.current;
    if (top) ins.top = top.offsetTop + top.offsetHeight;
    if (ctrls && ctrls.offsetHeight) ins.bottom = ctrls.offsetHeight + 14;
    if (p) {
      if (innerWidth <= 820) ins.bottom = Math.max(ins.bottom, p.offsetHeight + 8);
      else ins.right = p.offsetWidth + 14;
    }
    return ins;
  }, []);

  const districtView = useCallback((idx: number) => {
    const b = L.blocks[idx];
    return b ? fitView(districtBox(b), size(), insets(), FILL.district) : null;
  }, [L, insets]);
  const cityView = useCallback(() => fitView(cityBox(L, { signs, caption }), size(), insets(), FILL.city), [L, signs, caption, insets]);

  const flyToDistrict = useCallback((idx: number) => {
    const v = districtView(idx);
    if (v) flyTo(v.cx, v.cy, v.k);
  }, [districtView, flyTo]);

  const flyToBuilding = useCallback((b: Building) => {
    const p = iso((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, buildingHeight(b.topic) / 2);
    const v = centreOn(p, Math.max(view.current.k, 1.05), insets());
    flyTo(v.cx, v.cy, v.k);
  }, [flyTo, insets]);

  const fitAll = useCallback(() => {
    const v = cityView();
    flyTo(v.cx, v.cy, v.k);
  }, [cityView, flyTo]);

  const whereAmI = useCallback(() => {
    const i = progress.road.currentDistrictIndex;
    if (i >= L.blocks.length) fitAll();
    else flyToDistrict(i);
  }, [progress.road.currentDistrictIndex, L, fitAll, flyToDistrict]);

  const zoomAt = useCallback((f: number, px: number, py: number) => {
    stopAnim();
    const svg = svgRef.current!;
    const w = svg.clientWidth, h = svg.clientHeight, v = view.current;
    const wx = v.cx + (px - w / 2) / v.k, wy = v.cy + (py - h / 2) / v.k;
    const k = clampK(v.k * f);
    view.current = { cx: wx - (px - w / 2) / k, cy: wy - (py - h / 2) / k, k };
    applyView();
  }, [applyView]);

  /* ---------------- rendering ---------------- */
  const floors = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of curriculum.districts) for (const t of d.topics) m.set(t.id, t.subtopics.filter((s) => s.completedAt).length);
    return m;
  }, [curriculum]);
  const passed = useMemo(() => L.blocks.map((b) => progress.districts.find((d) => d.id === b.district.id)?.passed ?? false), [L, progress]);
  const states = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of curriculum.districts) for (const t of d.topics) if (t.presentation) m.set(t.id, t.presentation.state);
    return m;
  }, [curriculum]);
  const drawnSelection = useRef<string | null | undefined>(undefined);

  const draw = useCallback((car: CarPos) => {
    if (!layerRef.current) return;
    const selectionEnter = drawnSelection.current !== undefined && drawnSelection.current !== selectedId;
    drawnSelection.current = selectedId;
    layerRef.current.innerHTML = renderCity(
      L,
      {
        floors: (id) => floors.get(id) ?? 0,
        selectedId,
        selectionEnter,
        stateOf: (id) => states.get(id),
        currentTopicId,
        passed,
        currentIdx: progress.road.currentDistrictIndex,
        car,
        signs,
        meter,
      },
      road,
    );
  }, [L, floors, selectedId, currentTopicId, passed, progress.road.currentDistrictIndex, signs, road, states, meter]);

  // Draw, driving the car along the road to its new position when progress changes (across districts too).
  useEffect(() => {
    const target = carPosition(L, progress.road);
    const idx = progress.road.currentDistrictIndex;
    const prev = carShown.current;
    if (carAnim.current) cancelAnimationFrame(carAnim.current);
    if (!prev || reduceMotion() || (prev.idx === idx && prev.pos.x === target.x && prev.pos.y === target.y)) {
      carShown.current = { pos: target, idx };
      draw(target);
      return;
    }
    const path = carPath(L, prev, { pos: target, idx });
    // Longer trips take a little longer, never more than travelMax.
    const dur = Math.min(MOTION.travelMax, MOTION.travel + pathLength(path) * 25);
    const t0 = performance.now();
    const step = (t: number) => {
      const p = easeInOut(Math.min(1, (t - t0) / dur));
      const pos = p < 1 ? alongPath(path, p, target.ax) : target;
      // The car belongs to the segment it is on, so a stop mid-way (a new change) resumes from the right place.
      carShown.current = { pos, idx: p < 1 ? (p < 0.5 ? prev.idx : idx) : idx };
      draw(pos);
      carAnim.current = p < 1 ? requestAnimationFrame(step) : null;
    };
    carAnim.current = requestAnimationFrame(step);
  }, [L, progress.road, draw]);

  // Initial camera: this city's camera from earlier in the session, or its current district (the whole city once
  // every district is passed). Framing needs the map's real size, so it waits until the map has been laid out.
  const framed = useRef(false);
  const frameInitial = useCallback(() => {
    const svg = svgRef.current;
    if (framed.current || !svg) return;
    if (!saved.current && (!svg.clientWidth || !svg.clientHeight)) return; // not laid out yet: the resize observer retries
    framed.current = true;
    if (!saved.current) {
      const i = progress.road.currentDistrictIndex;
      view.current = (i < L.blocks.length ? districtView(i) : null) ?? cityView();
    }
    applyView();
  }, [L, progress.road.currentDistrictIndex, districtView, cityView, applyView]);
  const frameRef = useRef(frameInitial);
  frameRef.current = frameInitial;
  useEffect(() => {
    frameRef.current();
  }, []);

  // External focus requests (sidebar, Today view, deep links).
  useEffect(() => {
    if (!focus) return;
    if (focus.kind === "topic" && focus.id) {
      const b = byId.get(focus.id);
      if (b) flyToBuilding(b);
    } else if (focus.kind === "district" && focus.idx !== undefined) flyToDistrict(focus.idx);
    else if (focus.kind === "here") whereAmI();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);

  /* ---------------- input ---------------- */
  const latest = useRef({ onOpenTopic, flyToDistrict, byId, floors, onClose, selectedId });
  latest.current = { onOpenTopic, flyToDistrict, byId, floors, onClose, selectedId };

  useEffect(() => {
    const svg = svgRef.current!, tip = tipRef.current!;
    const ptrs = new Map<number, [number, number]>();
    let drag: { moved: number; target: Element } | null = null;
    let pinch: { d: number } | null = null;
    const rel = (e: { clientX: number; clientY: number }) => {
      const r = svg.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const activate = (t: Element | null) => {
      const g = t?.closest?.(".bld"), bd = t?.closest?.(".badge");
      if (g) latest.current.onOpenTopic(g.getAttribute("data-t")!);
      else if (bd) latest.current.flyToDistrict(Number(bd.getAttribute("data-d")));
    };
    const down = (e: PointerEvent) => {
      stopAnim();
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      if (ptrs.size === 1) drag = { moved: 0, target: e.target as Element };
      else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) };
        if (drag) drag.moved = 99;
      }
    };
    const move = (e: PointerEvent) => {
      if (!ptrs.has(e.pointerId)) {
        const g = e.pointerType !== "touch" && (e.target as Element).closest?.(".bld");
        if (g) {
          const b = latest.current.byId.get(g.getAttribute("data-t")!);
          if (b) {
            const [x, y] = rel(e);
            const k = latest.current.floors.get(b.topic.id) ?? 0;
            tip.innerHTML = `${esc(b.topic.name)}<small>${k}/${b.topic.subtopics.length} · ${PRIORITY_LABEL[b.topic.priority]}</small>`;
            tip.style.left = x + "px";
            tip.style.top = y + "px";
            tip.classList.add("on");
          }
        } else tip.classList.remove("on");
        return;
      }
      const prev = ptrs.get(e.pointerId)!;
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 1 && drag) {
        const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
        drag.moved += Math.abs(dx) + Math.abs(dy);
        if (drag.moved > 5) { svg.classList.add("dragging"); tip.classList.remove("on"); }
        const v = view.current;
        view.current = { ...v, cx: v.cx - dx / v.k, cy: v.cy - dy / v.k };
        applyView();
      } else if (ptrs.size === 2 && pinch) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const r = svg.getBoundingClientRect();
        zoomAt(d / pinch.d, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top);
        pinch.d = d;
      }
    };
    const end = (e: PointerEvent) => {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (ptrs.size === 0) {
        svg.classList.remove("dragging");
        if (drag && drag.moved < 6 && e.type === "pointerup") activate(drag.target);
        drag = null;
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      tip.classList.remove("on");
      if (e.ctrlKey || e.metaKey) {
        const [x, y] = rel(e);
        zoomAt(Math.exp(-e.deltaY * 0.0022), x, y);
      } else {
        stopAnim();
        const v = view.current;
        view.current = { ...v, cx: v.cx + e.deltaX / v.k, cy: v.cy + e.deltaY / v.k };
        applyView();
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = e.target as Element;
      if (t.closest(".bld") || t.closest(".badge")) {
        e.preventDefault();
        activate(t);
      }
    };
    const leave = () => tip.classList.remove("on");
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && latest.current.selectedId && !document.querySelector("aside.open")) latest.current.onClose();
    };
    svg.addEventListener("pointerdown", down);
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("pointerleave", leave);
    svg.addEventListener("wheel", wheel, { passive: false });
    svg.addEventListener("keydown", key);
    document.addEventListener("keydown", onEsc);
    const ro = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => (framed.current ? applyView() : frameRef.current()))
      : null;
    ro?.observe(svg);
    return () => {
      svg.removeEventListener("pointerdown", down);
      svg.removeEventListener("pointermove", move);
      svg.removeEventListener("pointerup", end);
      svg.removeEventListener("pointercancel", end);
      svg.removeEventListener("pointerleave", leave);
      svg.removeEventListener("wheel", wheel);
      svg.removeEventListener("keydown", key);
      document.removeEventListener("keydown", onEsc);
      ro?.disconnect();
      stopAnim();
      if (carAnim.current) cancelAnimationFrame(carAnim.current);
    };
  }, [applyView, zoomAt]);

  const mid = () => [svgRef.current!.clientWidth / 2, svgRef.current!.clientHeight / 2] as const;
  const road0 = progress.road;
  const curDistrict = L.blocks[road0.currentDistrictIndex]?.district;
  const roadPct = useAnimatedNumber(road0.overall * 100);

  return (
    <main className="map" aria-label="City map">
      <svg ref={svgRef} className="world" role="img" aria-label="Isometric city map of the roadmap. Each district is a skill domain and each building a topic.">
        <g ref={layerRef} />
      </svg>
      <div className="topbar" ref={topRef}>
        <span className="chip">
          Road <b aria-hidden="true">{Math.round(roadPct)}%</b>
          <span className="sr">{Math.round(road0.overall * 100)}%</span>
          {curDistrict ? <> · checkpoint {road0.currentDistrictIndex + 1}: {curDistrict.name}</> : <> · goal reached</>}
        </span>
        <span className="chip hint">Drag or scroll to travel · Ctrl + scroll to zoom · Click a building</span>
      </div>
      {selected && (
        <TopicPanel
          ref={panelRef}
          key="panel"
          building={selected}
          route={L.route}
          today={today}
          onOpenTopic={onOpenTopic}
          onClose={onClose}
        />
      )}
      <div className="ctrls" ref={ctrlsRef}>
        <button className="btn" aria-label="Zoom in" onClick={() => zoomAt(1.25, ...mid())}>+</button>
        <button className="btn" aria-label="Zoom out" onClick={() => zoomAt(0.8, ...mid())}>−</button>
        <button className="btn" onClick={fitAll}>Whole city</button>
        <button className="btn" onClick={whereAmI}>Where am I</button>
      </div>
      <div className="tip" ref={tipRef} />
    </main>
  );
}
