/**
 * The isometric city (DESIGN.md §3–§6). Rendering is a pure string renderer injected into one <g>;
 * this component owns the camera (view box), input handling, car animation and the topic panel.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Curriculum, Progress } from "../api/types";
import { esc } from "../lib/color";
import { PRIORITY_LABEL, monthRange } from "../lib/format";
import { BASE, FH, type Building, type Layout, cityBox, districtBox, iso } from "../map/geometry";
import { renderCity, roadSVG } from "../map/render";
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
  today: string;
  onOpenTopic: (id: string) => void;
  onClose: () => void;
}

interface View { cx: number; cy: number; k: number }
let savedView: View | null = null; // camera survives switching tabs

const clampK = (k: number) => Math.max(0.3, Math.min(2.6, k));
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

export function CityMap({ layout: L, curriculum, progress, currentTopicId, selectedId, focus, today, onOpenTopic, onClose }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const layerRef = useRef<SVGGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const view = useRef<View>(savedView ?? { cx: 0, cy: 0, k: 1 });
  const anim = useRef<number | null>(null);
  const carAnim = useRef<number | null>(null);
  const carShown = useRef<{ pos: CarPos; idx: number } | null>(null);

  const road = useMemo(() => roadSVG(L.W), [L]);
  const signs = useMemo(() => signposts(curriculum), [curriculum]);
  const byId = useMemo(() => new Map(L.route.map((b) => [b.topic.id, b])), [L]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  /* ---------------- camera ---------------- */
  const applyView = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const w = svg.clientWidth || 1, h = svg.clientHeight || 1, v = view.current;
    svg.setAttribute("viewBox", `${v.cx - w / 2 / v.k} ${v.cy - h / 2 / v.k} ${w / v.k} ${h / v.k}`);
    savedView = { ...v };
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

  const panelOffset = useCallback(() => {
    const p = panelRef.current;
    if (!p) return { x: 0, y: 0 };
    return innerWidth <= 820 ? { x: 0, y: p.offsetHeight / 2 } : { x: (p.offsetWidth + 14) / 2, y: 0 };
  }, []);

  const flyToDistrict = useCallback((idx: number) => {
    const b = L.blocks[idx], svg = svgRef.current;
    if (!b || !svg) return;
    const bb = districtBox(b), o = panelOffset();
    const k = clampK(Math.min((svg.clientWidth * 0.8) / bb.w, (svg.clientHeight * 0.78) / bb.h));
    flyTo(bb.x + bb.w / 2 + o.x / k, bb.y + bb.h / 2 + o.y / k, k);
  }, [L, flyTo, panelOffset]);

  const flyToBuilding = useCallback((b: Building) => {
    const H = BASE + b.topic.subtopics.length * FH;
    const [x, y] = iso((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, H / 2);
    const k = Math.max(view.current.k, 1.05), o = panelOffset();
    flyTo(x + o.x / k, y + o.y / k, k);
  }, [flyTo, panelOffset]);

  const fitAll = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const bb = cityBox(L), o = panelOffset();
    const k = clampK(Math.min(((svg.clientWidth - o.x * 2) * 0.92) / bb.w, ((svg.clientHeight - o.y * 2) * 0.92) / bb.h));
    flyTo(bb.x + bb.w / 2 + o.x / k, bb.y + bb.h / 2 + o.y / k, k);
  }, [L, flyTo, panelOffset]);

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
      },
      road,
    );
  }, [L, floors, selectedId, currentTopicId, passed, progress.road.currentDistrictIndex, signs, road, states]);

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

  // Initial camera: restore the previous view, or frame the current district.
  useEffect(() => {
    if (savedView) {
      applyView();
      return;
    }
    const svg = svgRef.current!;
    const i = progress.road.currentDistrictIndex;
    if (i >= L.blocks.length) {
      fitAll();
      return;
    }
    const bb = districtBox(L.blocks[i]);
    const k = clampK(Math.min((svg.clientWidth * 0.8) / bb.w, (svg.clientHeight * 0.78) / bb.h));
    view.current = { cx: bb.x + bb.w / 2, cy: bb.y + bb.h / 2, k };
    applyView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => applyView()) : null;
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
      <div className="topbar">
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
      <div className="ctrls">
        <button className="btn" aria-label="Zoom in" onClick={() => zoomAt(1.25, ...mid())}>+</button>
        <button className="btn" aria-label="Zoom out" onClick={() => zoomAt(0.8, ...mid())}>−</button>
        <button className="btn" onClick={fitAll}>Whole city</button>
        <button className="btn" onClick={whereAmI}>Where am I</button>
      </div>
      <div className="tip" ref={tipRef} />
    </main>
  );
}
