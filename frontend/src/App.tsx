import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "./api/client";
import type { Today } from "./api/types";
import { CityMap, type Focus } from "./components/CityMap";
import { ProgressView } from "./components/ProgressView";
import { RevisionView } from "./components/RevisionView";
import { Sidebar } from "./components/Sidebar";
import { TodayView } from "./components/TodayView";
import { WeekView } from "./components/WeekView";
import { Loading } from "./components/ui";
import { TopBar } from "./Root";
import { shortDate } from "./lib/format";
import type { View as MapView } from "./map/camera";
import { layout } from "./map/geometry";
import { useAppData } from "./state/AppData";
import { useSession } from "./state/Session";

type View = "today" | "week" | "revision" | "city" | "progress";
const VIEWS: { id: View; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "revision", label: "Revision" },
  { id: "city", label: "City" },
  { id: "progress", label: "Progress" },
];

interface Route { view: View; param: string | null }

/** Hash routing without a router library: #/today[/date], #/week[/date], #/revision, #/city[/topic], #/progress */
export function parseHash(hash: string): Route {
  const [, v, p] = hash.replace(/^#/, "").split("/");
  const known = VIEWS.find((x) => x.id === v);
  // An unknown view falls back to Today and drops its parameter (it isn't a date).
  return { view: (known?.id ?? "today") as View, param: known && p ? decodeURIComponent(p) : null };
}
const toHash = (r: Route) => `#/${r.view}${r.param ? `/${encodeURIComponent(r.param)}` : ""}`;

export function App() {
  const { curriculum, progress, loadError, reload, version, notice, setNotice } = useAppData();
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  const [today, setToday] = useState<Today | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [focus, setFocus] = useState<Focus | null>(null);
  const nonce = useRef(0);
  const tabsRef = useRef<HTMLElement>(null);
  const indRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);

  const go = useCallback((r: Route, replace = false) => {
    const h = toHash(r);
    if (location.hash !== h) {
      if (replace) history.replaceState(null, "", h);
      else history.pushState(null, "", h);
    }
    setRoute(r);
  }, []);

  // Sidebar "Today" card: always the real today.
  useEffect(() => {
    api.today().then(setToday, () => setToday(null));
  }, [version]);

  // Deep link to a topic: fly there once the map is ready.
  useEffect(() => {
    if (route.view === "city" && route.param && curriculum) setFocus({ kind: "topic", id: route.param, n: ++nonce.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curriculum === null]);

  const L = useMemo(() => (curriculum ? layout(curriculum.districts) : null), [curriculum]);
  // The map camera belongs to this account and this city (kept while switching tabs, never shared between cities).
  const { user, city, cameras } = useSession();
  const camera = useMemo(
    () => (user && city ? { load: () => cameras.get(user.id, city.id), save: (v: MapView) => cameras.set(user.id, city.id, v) } : undefined),
    [user, city, cameras],
  );

  const openTopic = useCallback((id: string) => {
    setSideOpen(false);
    go({ view: "city", param: id });
    setFocus({ kind: "topic", id, n: ++nonce.current });
  }, [go]);
  const openDistrict = useCallback((idx: number) => {
    setSideOpen(false);
    go({ view: "city", param: route.view === "city" ? route.param : null });
    setFocus({ kind: "district", idx, n: ++nonce.current });
  }, [go, route]);


  // Sliding indicator under the active tab: measured, then moved with a transform (no layout work while it moves).
  const ready = !!curriculum && !!progress;
  useLayoutEffect(() => {
    const nav = tabsRef.current, ind = indRef.current;
    if (!nav || !ind) return;
    const place = () => {
      const b = nav.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!b) return;
      ind.style.setProperty("--x", `${b.offsetLeft}px`);
      ind.style.setProperty("--w", `${b.offsetWidth}px`);
    };
    place();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    ro?.observe(nav);
    nav.querySelectorAll("button").forEach((b) => ro?.observe(b));
    return () => ro?.disconnect();
  }, [route.view, ready]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setSideOpen(false);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, []);

  if (loadError && !curriculum) {
    return (
      <div className="loading">
        <div>
          <p>Blueprint can't load this city.</p>
          <p style={{ fontSize: 13 }}>{loadError} Is <code>docker compose up</code> running?</p>
          <button className="btn primary" onClick={() => void reload()}>Try again</button>
        </div>
      </div>
    );
  }
  if (!curriculum || !progress || !L) return <Loading text="Loading your city…" />;

  const { view, param } = route;
  return (
    <div className="app">
      <Sidebar
        today={today}
        selectedId={view === "city" ? param : null}
        open={sideOpen}
        onOpenTopic={openTopic}
        onOpenDistrict={openDistrict}
        onOpenToday={() => { setSideOpen(false); go({ view: "today", param: null }); }}
        onOpenRevision={() => { setSideOpen(false); go({ view: "revision", param: null }); }}
      />
      <div className="main">
        <header className="vbar">
          <button className="btn menu" aria-label="Open districts" onClick={() => setSideOpen(true)}>☰</button>
          <nav className="tabs has-ind" role="tablist" aria-label="Views" ref={tabsRef}>
            <span className="tab-ind" ref={indRef} aria-hidden="true" />
            {VIEWS.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={view === v.id}
                onClick={() => go({ view: v.id, param: v.id === "city" ? param && view === "city" ? param : null : null })}
              >
                {v.label}
                {v.id === "revision" && !!today?.recall.dueCount && (
                  <span className={`tbadge t-${today.recall.overdueCount ? "danger" : "info"}`} aria-label={`${today.recall.dueCount} to recall${today.recall.overdueCount ? `, ${today.recall.overdueCount} overdue` : ""}`}>{today.recall.dueCount}</span>
                )}
              </button>
            ))}
          </nav>
          <span className="vdate">{today ? `${shortDate(today.today)} · Europe/Berlin` : ""}</span>
          <TopBar />
        </header>
        {view === "today" && <TodayView date={param} onDate={(d) => go({ view: "today", param: d }, true)} onOpenTopic={openTopic} onOpenRevision={() => go({ view: "revision", param: null })} />}
        {view === "revision" && <RevisionView />}
        {view === "week" && (
          <WeekView date={param} onDate={(d) => go({ view: "week", param: d }, true)} onOpenDay={(d) => go({ view: "today", param: d === today?.today ? null : d })} onOpenTopic={openTopic} />
        )}
        {view === "city" && (
          <CityMap
            layout={L}
            curriculum={curriculum}
            progress={progress}
            currentTopicId={progress.road.currentTopicId}
            selectedId={param}
            focus={focus}
            goal={city?.goal ?? null}
            camera={camera}
            today={today?.today ?? progress.today}
            onOpenTopic={openTopic}
            onClose={() => go({ view: "city", param: null }, true)}
          />
        )}
        {view === "progress" && <ProgressView onOpenDistrict={openDistrict} />}
      </div>
      <div className={`scrim${sideOpen ? " on" : ""}`} onClick={() => setSideOpen(false)} />
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button aria-label="Dismiss" onClick={() => setNotice(null)}>×</button>
        </div>
      )}
    </div>
  );
}
