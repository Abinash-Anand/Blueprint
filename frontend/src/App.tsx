import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api/client";
import type { Today } from "./api/types";
import { CityMap, type Focus } from "./components/CityMap";
import { ProgressView } from "./components/ProgressView";
import { RevisionView } from "./components/RevisionView";
import { Sidebar } from "./components/Sidebar";
import { TodayView } from "./components/TodayView";
import { WeekView } from "./components/WeekView";
import { RecallHistory } from "./components/recall/RecallHistory";
import { RecallPage } from "./components/recall/RecallPage";
import { YourTimePage } from "./components/time/YourTime";
import { StagePage } from "./components/StagePage";
import { AddTaskPage, LogTimePage } from "./components/today/DayForms";
import { TaskPage } from "./components/today/TaskPage";
import { Loading } from "./components/ui";
import { TopBar } from "./Root";
import { backName, closePage } from "./lib/nav";
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

interface Route {
  view: View; param: string | null; sub?: string | null; recall?: number | null; yourTime?: boolean; stage?: string | null;
  /** A page of its own for one day, opened from Today: a task, adding a task, or logging time. */
  day?: { page: "task" | "add-task" | "log-time"; date: string; id?: number; topic?: string } | null;
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Hash routing without a router library: #/today[/date], #/week[/date], #/revision, #/city[/topic], #/progress,
 * #/recall/<sub-topic> (the recall flow, a page of its own) and #/revision/history/<sub-topic> or
 * #/progress/history/<sub-topic> (recall over time, inside its tab), and #/your-time (your hours, days and pace, a page of
 * its own), #/stage/<id> (a stage's dates, opened from Progress), and #/task/<date>/<id>, #/add-task/<date>[/<topic>]
 * and #/log-time/<date> (pages of their own, opened from Today, or from a building's panel for adding a task on its topic).
 */
export function parseHash(hash: string): Route {
  const [, v, p, q] = hash.replace(/^#/, "").split("?")[0].split("/");
  if (v === "recall" && /^\d+$/.test(p ?? "")) return { view: "revision", param: null, recall: Number(p) };
  if (v === "your-time") return { view: "progress", param: null, yourTime: true };
  if (v === "stage" && p) return { view: "progress", param: null, stage: decodeURIComponent(p) };
  if (v === "task" && DATE.test(p ?? "") && /^\d+$/.test(q ?? "")) return { view: "today", param: null, day: { page: "task", date: p, id: Number(q) } };
  if (v === "add-task" && DATE.test(p ?? "")) return { view: "today", param: null, day: { page: v, date: p, ...(q ? { topic: decodeURIComponent(q) } : {}) } };
  if (v === "log-time" && DATE.test(p ?? "")) return { view: "today", param: null, day: { page: v, date: p } };
  const known = VIEWS.find((x) => x.id === v);
  // An unknown view falls back to Today and drops its parameter (it isn't a date).
  return { view: (known?.id ?? "today") as View, param: known && p ? decodeURIComponent(p) : null, sub: known && p && q ? decodeURIComponent(q) : null };
}
const toHash = (r: Route) =>
  r.day ? `#/${r.day.page}/${r.day.date}${r.day.id != null ? `/${r.day.id}` : r.day.topic ? `/${encodeURIComponent(r.day.topic)}` : ""}` : r.stage ? `#/stage/${encodeURIComponent(r.stage)}` : r.recall != null ? `#/recall/${r.recall}` : r.yourTime ? "#/your-time" : `#/${r.view}${r.param ? `/${encodeURIComponent(r.param)}` : ""}${r.param && r.sub ? `/${encodeURIComponent(r.sub)}` : ""}`;

/** Narrow screens (the districts become a drawer), following the layout's own breakpoint. */
function useNarrow(query = "(max-width: 820px)") {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return narrow;
}
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function App() {
  const { curriculum, progress, loadError, reload, invalidate, version, notice, setNotice } = useAppData();
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  const [today, setToday] = useState<Today | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [focus, setFocus] = useState<Focus | null>(null);
  const nonce = useRef(0);
  const menuRef = useRef<HTMLButtonElement>(null);
  // On narrow screens the districts are a drawer: while it is closed it is out of reach for the keyboard and screen readers.
  const narrow = useNarrow();

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

  // The real today: the Revision tab's badge and the city's time zone.
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


  // The drawer takes focus when it opens and gives it back to its button when it closes.
  const drawerWasOpen = useRef(false);
  useEffect(() => {
    if (!narrow) return;
    if (sideOpen) document.querySelector<HTMLElement>("aside .side-close")?.focus();
    else if (drawerWasOpen.current) menuRef.current?.focus();
    drawerWasOpen.current = sideOpen;
  }, [sideOpen, narrow]);

  // Leaving the recall flow: every view and the tab badge pick up what the recall changed.
  const wasRecall = useRef(route.recall != null);
  useEffect(() => {
    if (wasRecall.current && route.recall == null) void invalidate();
    wasRecall.current = route.recall != null;
  }, [route.recall, invalidate]);

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
  // The recall flow is a focused page of its own, without the tabs and the districts.
  if (route.recall != null) return <RecallPage subtopicId={route.recall} backLabel={backName("#/revision")} onClose={() => closePage("#/revision")} />;
  if (route.stage) return <StagePage key={route.stage} id={route.stage} backLabel={backName("#/progress")} onClose={() => closePage("#/progress")} />;
  if (route.yourTime) return <YourTimePage backLabel={backName("#/progress")} onClose={() => closePage("#/progress")} />;
  if (route.day) {
    const { page, date, id, topic } = route.day;
    const back = { backLabel: backName("#/today"), onClose: () => closePage(today && date !== today.today ? `#/today/${date}` : "#/today") };
    if (page === "task" && id != null) return <TaskPage date={date} id={id} onOpenTopic={openTopic} {...back} />;
    if (page === "add-task") return <AddTaskPage date={date} topicId={topic} {...back} />;
    return <LogTimePage date={date} {...back} />;
  }
  const historyId = (view === "revision" || view === "progress") && param === "history" && /^\d+$/.test(route.sub ?? "") ? Number(route.sub) : null;
  return (
    <div className="app">
      <Sidebar
        selectedId={view === "city" ? param : null}
        open={sideOpen}
        hidden={narrow && !sideOpen}
        onClose={() => setSideOpen(false)}
        onOpenTopic={openTopic}
        onOpenDistrict={openDistrict}
      />
      <main className="main">
        <header className="vbar">
          <button ref={menuRef} className="btn menu" aria-label="Districts" aria-expanded={sideOpen} onClick={() => setSideOpen(true)}>☰</button>
          {/* Navigation between views, not ARIA tabs: the current view is the current page. */}
          <nav className="tabs" aria-label="Views">
            {VIEWS.map((v) => (
              <a
                key={v.id}
                href={`#/${v.id}${v.id === "city" && view === "city" && param ? `/${encodeURIComponent(param)}` : ""}`}
                aria-current={view === v.id ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  go({ view: v.id, param: v.id === "city" ? param && view === "city" ? param : null : null });
                }}
              >
                {v.label}
                {v.id === "revision" && !!today?.recall.dueCount && (
                  <>
                    <span className={`tbadge t-${today.recall.overdueCount ? "danger" : "info"}`} aria-hidden="true">{today.recall.dueCount}</span>
                    <span className="sr">, {today.recall.dueCount} to recall{today.recall.overdueCount ? `, ${today.recall.overdueCount} overdue` : ""}</span>
                  </>
                )}
              </a>
            ))}
          </nav>
          {/* The city's time zone, only when it differs from this device's (otherwise there is nothing to say). */}
          {today?.timezone && today.timezone !== deviceZone() && <span className="vdate">Times in {today.timezone}</span>}
          <TopBar />
        </header>
        {view === "today" && <TodayView date={param} onDate={(d) => go({ view: "today", param: d }, true)} onOpenTopic={openTopic} onOpenRevision={() => go({ view: "revision", param: null })} />}
        {historyId !== null && <RecallHistory subtopicId={historyId} backLabel={backName(`#/${view}`)} onBack={() => closePage(`#/${view}`)} />}
        {view === "revision" && historyId === null && <RevisionView />}
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
        {view === "progress" && historyId === null && <ProgressView onOpenDistrict={openDistrict} />}
      </main>
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
