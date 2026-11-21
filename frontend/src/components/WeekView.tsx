/** Weekly learning schedule (SRS §3.5). */
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Week } from "../api/types";
import { addDays, dayMonth, hm, hours1, plural, weekdayShort } from "../lib/format";
import { useAppData } from "../state/AppData";
import { Bar, Loading, Stat } from "./ui";
import { StatusBadge } from "./Status";

interface Props {
  date: string | null;
  onDate: (date: string | null) => void;
  onOpenDay: (date: string) => void;
  onOpenTopic: (id: string) => void;
}

export function WeekView({ date, onDate, onOpenDay, onOpenTopic }: Props) {
  const { version } = useAppData();
  const [w, setW] = useState<Week | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.week(date ?? undefined).then(
      (d) => live && (setW(d), setError(null)),
      (e) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [date, version]);

  if (error) return <div className="view"><div className="wrap"><div className="card empty">{error}</div></div></div>;
  if (!w) return <div className="view"><Loading /></div>;

  const t = w.totals;
  const thisWeek = w.today >= w.weekStart && w.today <= w.weekEnd;
  const studyDays = w.days.filter((d) => !d.isRestDay && d.inJourney);
  // The rest days come from the city's own week (Settings), never a fixed weekday.
  const restNames = w.days.filter((d) => d.isRestDay).map((d) => new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }));
  const rest = restNames.length === 0 ? "no rest day" : `${restNames.join(" and ")} ${restNames.length > 1 ? "are" : "is"} rest`;
  const todo = w.tasks.filter((x) => x.status === "TODO");

  return (
    <div className="view">
      <div className="wrap">
        <div className="vhead">
          <div>
            <div className="kick">{thisWeek ? "This week" : "Week"}</div>
            <h2>
              {dayMonth(w.weekStart)} – {dayMonth(w.weekEnd)}
            </h2>
            <div className="sub">
              {plural(studyDays.length, "study day")} × {hm(studyDays[0]?.targetMinutes ?? 0)} · {rest}{restNames.length ? ", no target" : ""}
            </div>
          </div>
          <div className="nav">
            <button className="btn" aria-label="Previous week" onClick={() => onDate(addDays(w.weekStart, -7))}>←</button>
            <button className="btn" disabled={thisWeek} onClick={() => onDate(null)}>This week</button>
            <button className="btn" aria-label="Next week" onClick={() => onDate(addDays(w.weekStart, 7))}>→</button>
          </div>
        </div>

        <div className="grid4">
          <Stat label="Target" value={hours1(t.targetMinutes)} detail={`${plural(studyDays.length, "study day")}, ${rest}`} />
          <Stat label="Planned" value={hours1(t.plannedMinutes)} detail={`${plural(w.tasks.filter((x) => x.status !== "SKIPPED").length, "assignment")}`} />
          <Stat
            label="Actual"
            value={hours1(t.actualMinutes)}
            detail={<Bar value={t.targetMinutes ? t.actualMinutes / t.targetMinutes : 0} />}
          />
          <Stat label="Completed" value={t.tasksDone} unit={`/ ${t.tasksDone + t.tasksRemaining}`} detail={t.tasksRemaining ? `${hm(t.remainingMinutes)} of work remaining` : "Nothing remaining"} />
        </div>

        <div className="section">
          <h3>Days</h3>
          <div className="wgrid">
            {w.days.map((d) => (
              <button
                key={d.date}
                className={`wday${d.date === w.today ? " today" : ""}${d.isRestDay || !d.inJourney ? " rest" : ""}`}
                onClick={() => onOpenDay(d.date)}
                aria-label={`Open ${weekdayShort(d.date)} ${dayMonth(d.date)}`}
              >
                <div>
                  <div className="dn">{weekdayShort(d.date)}</div>
                  <div className="dd">{dayMonth(d.date)}</div>
                </div>
                <div className="num">
                  {!d.inJourney ? (
                    <>{d.date < w.today ? "Before the journey" : "Outside the journey"}</>
                  ) : d.isRestDay ? (
                    <>
                      Rest day
                      {d.actualMinutes > 0 && <><br /><b>{hm(d.actualMinutes)}</b> bonus</>}
                    </>
                  ) : (
                    <>
                      <b>{hm(d.actualMinutes)}</b> of {hm(d.targetMinutes)}
                      <div className="mini"><i style={{ width: `${Math.min(1, d.actualMinutes / (d.targetMinutes || 1)) * 100}%` }} /></div>
                      <div style={{ marginTop: 6 }}>
                        {d.tasksTotal - d.revisionTasks > 0 ? `${d.tasksDone}/${d.tasksTotal} tasks · ${hm(d.plannedMinutes)}` : "Buffer day"}
                      </div>
                      {d.revisionPlannedMinutes > 0 && <div>incl. {hm(d.revisionPlannedMinutes)} revision</div>}
                    </>
                  )}
                  {d.recall.length > 0 && <div className="wk-recall" title={d.recall.join(", ")}>↻ {plural(d.recall.length, "recall")}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="section">
          <h3>Milestones · this week and the next</h3>
          <div className="card">
            {w.milestones.length === 0 ? (
              <div className="empty" style={{ padding: 0 }}>No practical milestones or stage deadlines in this window.</div>
            ) : (
              <ul className="list">
                {w.milestones.map((m, i) => (
                  <li key={i}>
                    <span className="sind">
                      {m.topicId ? (
                        <button className="btn" style={{ padding: "2px 8px", fontSize: 13 }} onClick={() => onOpenTopic(m.topicId!)}>{m.title}</button>
                      ) : (
                        <b>{m.title}</b>
                      )}
                      <StatusBadge p={m.presentation} fallback={m.done ? "Done" : undefined} />
                    </span>
                    <span className="m">{m.type === "STAGE_END" ? "Stage deadline · " : "Practice · "}{weekdayShort(m.date)} {dayMonth(m.date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {todo.length > 0 && (
          <div className="section">
            <h3>Remaining this week · {plural(todo.length, "task")}</h3>
            <div className="card">
              <ul className="list">
                {todo.map((x) => (
                  <li key={x.id}>
                    <span>
                      {x.title}
                      {x.topic && <span className="m"> · {x.topic.name}</span>}
                    </span>
                    <span className="m">{weekdayShort(x.scheduledDate)} · {hm(x.estimatedMinutes)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
