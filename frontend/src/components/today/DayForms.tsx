/**
 * Adding a task to a day (#/add-task/<date>) and logging study time on a day (#/log-time/<date>): pages of their own,
 * opened from Today, each with one Save.
 */
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../api/client";
import type { Today } from "../../api/types";
import { longDate } from "../../lib/format";
import { useAppData } from "../../state/AppData";
import { Back } from "../recall/icons";
import { Loading } from "../ui";

interface PageProps { date: string; backLabel: string; onClose: () => void }

/** The day the page is for (rest day or not, its tasks, where you are), reloaded when data changes. */
function useDay(date: string) {
  const { version } = useAppData();
  const [day, setDay] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.today(date).then((d) => live && (setDay(d), setError(null)), (e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [date, version]);
  return { day, error };
}

function DayPage({ date, title, backLabel, onClose, error, children }: PageProps & { title: string; error: string | null; children: ReactNode }) {
  const { notice } = useAppData();
  return (
    <main className="view gl gl-bg">
      <div className="wrap tp">
        <button type="button" className="g-link rh-back" onClick={onClose} aria-label={`Back to ${backLabel}`}><Back />{backLabel}</button>
        {(notice || error) && <p className="g-err tp-err" role="alert">{notice ?? error}</p>}
        <section className="g-card tp-card" aria-labelledby="dp-title">
          <div className="kick">{longDate(date)}</div>
          <h2 id="dp-title" className="g-t2 tp-title">{title}</h2>
          {children}
        </section>
      </div>
    </main>
  );
}

export function AddTaskPage(p: PageProps & { topicId?: string }) {
  const { mutate, topicById, districtById } = useAppData();
  const start = p.topicId ? topicById.get(p.topicId) : undefined;
  // The day can be changed here: a building's panel opens this page on today, for a topic studied on any day.
  const [when, setWhen] = useState(p.date);
  const { day, error } = useDay(when);
  const [title, setTitle] = useState(start ? `Study: ${start.name}` : "");
  const [minutes, setMinutes] = useState(60);
  const [topicId, setTopicId] = useState(start?.id ?? "");
  const [busy, setBusy] = useState(false);
  const valid = !!title.trim() && !!when && minutes >= 5 && minutes <= 720;

  const add = async () => {
    if (!day || !valid) return;
    setBusy(true);
    const r = await mutate(() =>
      api.createTask({ title: title.trim(), scheduledDate: when, estimatedMinutes: minutes, topicId: topicId || undefined, kind: day.isRestDay ? "REVISION" : "STUDY" }),
    );
    setBusy(false);
    if (r) p.onClose();
  };

  return (
    <DayPage {...p} date={when || p.date} title="Add a task" error={error}>
      {!day ? !error && <Loading /> : (
        <form className="tp-form tp-stack" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <label className="full">
            Title
            <input className="inp" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Revise generics" autoFocus />
          </label>
          <label>
            Day
            <input className="inp" type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <label>
            Minutes
            <input className="inp" type="number" min={5} max={720} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </label>
          <label className="grow">
            Topic (optional)
            <select className="inp" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
              <option value="">None</option>
              {[...topicById.values()].map((t) => <option key={t.id} value={t.id}>{districtById.get(t.districtId)?.name} · {t.name}</option>)}
            </select>
          </label>
          <div className="tp-acts full">
            <button type="submit" className="btn primary big" disabled={!valid || busy} aria-busy={busy}>{busy ? "Adding…" : "Add task"}</button>
          </div>
        </form>
      )}
    </DayPage>
  );
}

export function LogTimePage(p: PageProps) {
  const { mutate, topicById } = useAppData();
  const { day, error } = useDay(p.date);
  const [minutes, setMinutes] = useState(30);
  // "" = other study (on the current topic), else a task's id. Starts on the first open task of the day.
  const [what, setWhat] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tasks = day ? day.tasks.filter((t) => !t.recall && !t.revision && t.status !== "SKIPPED") : [];
  const choice = what ?? String(tasks.find((t) => t.status === "TODO")?.id ?? "");
  const current = day?.current.topicId ? topicById.get(day.current.topicId) : undefined;
  const valid = minutes >= 5 && minutes <= 720;

  const save = async () => {
    if (!day || !valid) return;
    setBusy(true);
    const r = await mutate(() =>
      api.logTime(choice ? { date: p.date, minutes, taskId: Number(choice) } : { date: p.date, minutes, topicId: day.current.topicId ?? undefined }),
    );
    setBusy(false);
    if (r !== undefined) p.onClose();
  };

  return (
    <DayPage {...p} title="Log study time" error={error}>
      {!day ? !error && <Loading /> : (
        <form className="tp-form tp-stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="full">
            What you studied
            <select className="inp" value={choice} onChange={(e) => setWhat(e.target.value)}>
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}{t.topic ? ` (${t.topic.name})` : ""}</option>)}
              <option value="">Other study{current ? ` (${current.name})` : ""}</option>
            </select>
          </label>
          <label>
            Minutes
            <input className="inp" type="number" min={5} max={720} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </label>
          <div className="tp-acts full">
            <button type="submit" className="btn primary big" disabled={!valid || busy} aria-busy={busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </form>
      )}
    </DayPage>
  );
}
