/** Daily Mission Control (SRS §3.4). */
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Today } from "../api/types";
import { addDays, hm, longDate, plural } from "../lib/format";
import { useAppData } from "../state/AppData";
import { TaskRow } from "./TaskRow";
import { Bar, Loading } from "./ui";

interface Props {
  date: string | null; // null = today
  onDate: (date: string | null) => void;
  onOpenTopic: (id: string) => void;
}

export function TodayView({ date, onDate, onOpenTopic }: Props) {
  const { version, mutate, topicById, districtById, progress } = useAppData();
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", minutes: 60, topicId: "" });
  const [logForm, setLogForm] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    api.today(date ?? undefined).then(
      (d) => live && (setData(d), setError(null)),
      (e) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [date, version]);

  if (error) return <div className="view"><div className="wrap"><div className="card empty">{error}</div></div></div>;
  if (!data) return <div className="view"><Loading /></div>;

  const isToday = data.date === data.today;
  const topic = data.current.topicId ? topicById.get(data.current.topicId) : undefined;
  const district = data.current.districtId ? districtById.get(data.current.districtId) : undefined;
  const live = data.tasks.filter((t) => t.status !== "SKIPPED");
  const done = live.filter((t) => t.status === "DONE");
  const remaining = live.filter((t) => t.status === "TODO");
  const mainStage = data.stages.find((s) => s.kind === "MAIN");
  const sideStage = data.stages.find((s) => s.kind === "PARALLEL");
  const sessions = data.sessions;
  const allTopics = [...topicById.values()];

  const addTask = async () => {
    const r = await mutate(() =>
      api.createTask({
        title: form.title.trim(),
        scheduledDate: data.date,
        estimatedMinutes: form.minutes,
        topicId: form.topicId || undefined,
        kind: data.isRestDay ? "REVISION" : "STUDY",
      }),
    );
    if (r) {
      setAdding(false);
      setForm({ title: "", minutes: 60, topicId: "" });
    }
  };

  return (
    <div className="view">
      <div className="wrap">
        <div className="vhead">
          <div>
            <div className="kick">{isToday ? "Today" : data.date < data.today ? "Past day" : "Upcoming day"} · Mission Control</div>
            <h2>{longDate(data.date)}</h2>
            <div className="sub">
              {data.journey.status === "ACTIVE"
                ? `Day ${data.journey.day} of ${data.journey.totalDays}`
                : data.journey.status === "BEFORE"
                  ? "Before the journey starts"
                  : "After the journey"}
              {mainStage && ` · ${mainStage.name} stage`}
              {sideStage && data.weekday === 6 && ` · ${sideStage.name}`}
            </div>
          </div>
          <div className="nav">
            <button className="btn" aria-label="Previous day" onClick={() => onDate(addDays(data.date, -1))}>←</button>
            <button className="btn" disabled={isToday} onClick={() => onDate(null)}>Today</button>
            <button className="btn" aria-label="Next day" onClick={() => onDate(addDays(data.date, 1))}>→</button>
          </div>
        </div>

        <div className="grid3">
          <div className="card focus">
            <div className="kick">Where you are</div>
            <div className="t">
              {district && <><span className="swatch" style={{ background: district.color }} />{district.name}</>}
              <br />
              <b>{topic?.name ?? "—"}</b>
            </div>
            {data.next?.subtopic && <div className="sub">Next sub-topic: {data.next.subtopic}</div>}
            {topic && (
              <div className="row">
                <button className="btn" onClick={() => onOpenTopic(topic.id)}>Open topic</button>
              </div>
            )}
          </div>
          <div className="card stat">
            <div className="kick">Study time</div>
            <div className="v">
              {hm(data.actualMinutes)}
              {data.targetMinutes > 0 && <small>of {hm(data.targetMinutes)}</small>}
            </div>
            {data.isRestDay || data.targetMinutes === 0 ? (
              <div className="d">{data.isRestDay ? "Rest day: no target. Anything you do is a bonus." : "No target on this day."}</div>
            ) : (
              <>
                <Bar value={data.targetMinutes ? data.actualMinutes / data.targetMinutes : 0} />
                <div className="d">{hm(data.plannedMinutes)} assigned · {hm(Math.max(0, data.targetMinutes - data.actualMinutes))} to go</div>
              </>
            )}
          </div>
          <div className="card stat">
            <div className="kick">Assignments</div>
            <div className="v">
              {done.length}
              <small>of {live.length} done</small>
            </div>
            <Bar value={live.length ? done.length / live.length : 0} />
            <div className="d">
              {remaining.length ? `${plural(remaining.length, "task")} left · ${hm(remaining.reduce((a, t) => a + t.estimatedMinutes, 0))}` : live.length ? "All done for the day." : "Nothing assigned."}
            </div>
          </div>
        </div>

        {data.carriedOver.length > 0 && (
          <div className="section">
            <h3>
              Carried over · {plural(data.carriedOver.length, "unfinished task")}
              <button className="btn" onClick={() => void mutate(() => api.rescheduleOverdue())}>Move all forward</button>
            </h3>
            <ul className="tasks">
              {data.carriedOver.map((t) => <TaskRow key={t.id} task={t} today={data.today} onOpenTopic={onOpenTopic} compact />)}
            </ul>
            <div className="sub">"Move all forward" puts these on the next study days that have room. Their original dates are kept. Nothing is marked done for you.</div>
          </div>
        )}

        <div className="section">
          <h3>
            {data.isRestDay ? "Optional today" : "Today's assignments"}
            <button className="btn" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>{adding ? "Close" : "Add task"}</button>
          </h3>
          {adding && (
            <div className="form" style={{ marginTop: 0, marginBottom: 10 }}>
              <label className="grow">
                Title
                <input className="inp" value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Revise generics" />
              </label>
              <label>
                Minutes
                <input className="inp" type="number" min={5} max={720} step={15} value={form.minutes} style={{ width: 90 }} onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })} />
              </label>
              <label>
                Topic (optional)
                <select className="inp" value={form.topicId} onChange={(e) => setForm({ ...form, topicId: e.target.value })}>
                  <option value="">—</option>
                  {allTopics.map((t) => <option key={t.id} value={t.id}>{districtById.get(t.districtId)?.name} · {t.name}</option>)}
                </select>
              </label>
              <button className="btn primary" disabled={!form.title.trim() || form.minutes < 5} onClick={() => void addTask()}>Add</button>
            </div>
          )}
          {data.tasks.length > 0 ? (
            <ul className="tasks">
              {data.tasks.map((t) => <TaskRow key={t.id} task={t} today={data.today} onOpenTopic={onOpenTopic} />)}
            </ul>
          ) : data.journey.status !== "ACTIVE" ? (
            <div className="card rest">
              <h3>Outside the journey</h3>
              <p>The plan runs from {longDate(data.journey.start)} to {longDate(data.journey.end)}.</p>
            </div>
          ) : data.isRestDay ? (
            <div className="card rest">
              <h3>Rest day</h3>
              <p>Sunday has no assignments and no target. Rest is part of the plan. If you want to, catch up on carried-over tasks or revise a topic you marked for review.</p>
            </div>
          ) : data.isBufferDay ? (
            <div className="card rest">
              <h3>Buffer day</h3>
              <p>No new material is planned today. This day exists to absorb delays: use it for carried-over work, then revision.</p>
            </div>
          ) : (
            <div className="card empty">No tasks on this day.</div>
          )}
        </div>

        {(data.isRestDay || data.isBufferDay) && data.reviewTopics.length > 0 && (
          <div className="section">
            <h3>Marked for review</h3>
            <div className="card">
              <ul className="list">
                {data.reviewTopics.map((t) => (
                  <li key={t.id}>
                    <span>{districtById.get(t.districtId)?.name} · {t.name}</span>
                    <button className="btn" onClick={() => onOpenTopic(t.id)}>Open</button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="section">
          <h3>
            Time log · {hm(data.actualMinutes)}
            {data.date <= data.today && (
              <button className="btn" onClick={() => setLogForm((f) => (f === null ? 30 : null))}>{logForm === null ? "Log other time" : "Close"}</button>
            )}
          </h3>
          {logForm !== null && (
            <div className="form" style={{ marginTop: 0, marginBottom: 10 }}>
              <label>
                Minutes
                <input className="inp" type="number" min={1} max={720} step={5} value={logForm} style={{ width: 90 }} onChange={(e) => setLogForm(Number(e.target.value))} />
              </label>
              <button
                className="btn primary"
                disabled={logForm < 1 || logForm > 720}
                onClick={async () => {
                  const r = await mutate(() => api.logTime({ date: data.date, minutes: logForm, topicId: data.current.topicId ?? undefined }));
                  if (r) setLogForm(null);
                }}
              >
                Save{topic ? ` (${topic.name})` : ""}
              </button>
            </div>
          )}
          <div className="card">
            {sessions.length === 0 ? (
              <div className="empty" style={{ padding: 0 }}>No study time recorded{isToday ? " yet today" : ""}. Use "Log time" on a task after a study block.</div>
            ) : (
              <ul className="list">
                {sessions.map((s) => {
                  const task = data.tasks.find((t) => t.id === s.taskId);
                  return (
                    <li key={s.id}>
                      <span>{task?.title ?? (s.topicId ? topicById.get(s.topicId)?.name : "General study")}</span>
                      <span className="m">
                        {hm(s.minutes)}{" "}
                        <button className="x" aria-label={`Delete ${hm(s.minutes)} entry`} onClick={() => void mutate(() => api.deleteSession(s.id))}>×</button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {progress && isToday && (
          <p className="sub" style={{ marginTop: 22 }}>
            Learning progress moves the car; the calendar doesn't. Tick sub-topics in the topic panel when you've learned them, and mark a topic
            demonstrated once you've done its exercise on your own.
          </p>
        )}
      </div>
    </div>
  );
}
