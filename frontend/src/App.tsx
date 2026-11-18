import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api/client";
import type { Today } from "./api/types";
import { CityMap, type Focus } from "./components/CityMap";
import { ProgressView } from "./components/ProgressView";
import { RevisionView } from "./components/RevisionView";
import { Sidebar } from "./components/Sidebar";
import { TodayView } from "./components/TodayView";
import { WeekView } from "./components/WeekView";
import { Loading } from "./components/ui";
import { shortDate } from "./lib/format";
import { layout } from "./map/geometry";
import { useAppData } from "./state/AppData";

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

  const openRevision = useCallback(() => {
    setSideOpen(false);
    go({ view: "revision", param: null });
  }, [go]);
  // In-app indicator (FR-REV-22): revisions due by today, from the same Today summary the sidebar uses.
  const revDue = today?.revision.dueCount ?? 0;
  const revOverdue = today?.revision.overdueCount ?? 0;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setSideOpen(false);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, []);

  if (loadError && !curriculum) {
    return (
      <div className="loading">
        <div>
          <p>Engineering City can't reach its server.</p>
          <p style={{ fontSize: 13 }}>{loadError} Is <code>docker compose up</code> running?</p>
          <button className="btn primary" onClick={() => void reload()}>Try again</button>
        </div>
      </div>
    );
  }
  if (!curriculum || !progress || !L) return <Loading text="Loading Engineering City…" />;

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
        onOpenRevision={openRevision}
      />
      <div className="main">
        <header className="vbar">
          <button className="btn menu" aria-label="Open districts" onClick={() => setSideOpen(true)}>☰</button>
          <nav className="tabs" role="tablist" aria-label="Views">
            {VIEWS.map((v) => {
              const badge = v.id === "revision" && revDue > 0;
              return (
                <button
                  key={v.id}
                  role="tab"
                  aria-selected={view === v.id}
                  aria-label={badge ? `Revision, ${revDue} due${revOverdue ? `, ${revOverdue} overdue` : ""}` : undefined}
                  onClick={() => go({ view: v.id, param: v.id === "city" ? param && view === "city" ? param : null : null })}
                >
                  {v.label}
                  {badge && <span className={`tbadge${revOverdue ? " late" : ""}`} aria-hidden="true">{revDue}</span>}
                </button>
              );
            })}
          </nav>
          <span className="vdate">{today ? `${shortDate(today.today)} · Europe/Berlin` : ""}</span>
        </header>
        {view === "today" && <TodayView date={param} onDate={(d) => go({ view: "today", param: d }, true)} onOpenTopic={openTopic} onOpenRevision={openRevision} />}
        {view === "revision" && <RevisionView onOpenTopic={openTopic} />}
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
            today={today?.today ?? progress.today}
            onOpenTopic={openTopic}
            onClose={() => go({ view: "city", param: null }, true)}
          />
        )}
        {view === "progress" && <ProgressView onOpenDistrict={openDistrict} onOpenRevision={openRevision} />}
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
