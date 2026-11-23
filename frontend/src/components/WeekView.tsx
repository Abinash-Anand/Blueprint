/**
 * The week (SRS §3.5), in glass (DESIGN.md §10): study time once, what is coming up, and the seven days, each a way into
 * its day. A day planned beyond its target says so. On a wide screen the days sit side by side; on a phone they are a
 * list.
 */
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Week, WeekDay } from "../api/types";
import { addDays, dayMonth, hm, hours1, plural, weekdayShort } from "../lib/format";
import { useAppData } from "../state/AppData";
import { Chevron } from "./recall/icons";
import { StatusBadge } from "./Status";
import { Bar, Loading } from "./ui";

interface Props {
  date: string | null;
  onDate: (date: string | null) => void;
  onOpenDay: (date: string) => void;
  onOpenTopic: (id: string) => void;
}

const weekdayLong = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });

/** One day: its time against its target, its tasks, its recalls, and a warning when it is planned beyond its target. */
function DayBody({ d, today }: { d: WeekDay; today: string }) {
  if (!d.inJourney) return <span className="wk-line">{d.date < today ? "Before the journey" : "Outside the journey"}</span>;
  if (d.isRestDay) {
    return (
      <>
        <span className="wk-line">Rest day</span>
        {d.actualMinutes > 0 && <span className="wk-line"><b>{hm(d.actualMinutes)}</b> bonus</span>}
      </>
    );
  }
  const learning = d.tasksTotal - d.revisionTasks;
  const past = d.date <= today;
  return (
    <>
      <span className="wk-time"><b>{hm(d.actualMinutes)}</b> of {hm(d.targetMinutes)}</span>
      <Bar value={d.targetMinutes ? d.actualMinutes / d.targetMinutes : 0} />
      <span className="wk-line">
        {learning > 0 ? `${past && d.tasksTotal ? `${d.tasksDone} of ` : ""}${plural(d.tasksTotal, "task")} · ${hm(d.plannedMinutes)}` : "Buffer day"}
      </span>
      {d.recall.length > 0 && <span className="wk-line wk-recall"><span aria-hidden="true">↻ </span>{plural(d.recall.length, "recall")}</span>}
      {d.overTargetMinutes > 0 && <StatusBadge className="wk-over" p={{ state: "day.over", tone: "warning", variant: "soft", icon: "alert-triangle", label: `${hm(d.overTargetMinutes)} over` }} />}
    </>
  );
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

  if (error) return <div className="view gl gl-bg"><div className="wrap"><p className="g-err" role="alert">{error}</p></div></div>;
  if (!w) return <div className="view gl gl-bg"><Loading /></div>;

  const t = w.totals;
  const thisWeek = w.today >= w.weekStart && w.today <= w.weekEnd;
  const studyDays = w.days.filter((d) => !d.isRestDay && d.inJourney);
  // The rest days come from the city's own week (Settings), never a fixed weekday.
  const restNames = w.days.filter((d) => d.isRestDay && d.inJourney).map((d) => weekdayLong(d.date));
  const rest = restNames.length === 0 ? "no rest day" : `${restNames.join(" and ")} ${restNames.length > 1 ? "are rest days" : "is a rest day"}`;
  // Study days usually share one target; when they don't, the header says only how many there are.
  const sameTarget = studyDays.every((d) => d.targetMinutes === studyDays[0]?.targetMinutes);

  return (
    <div className="view gl gl-bg">
      <div className="wrap wk">
        <header className="td-head">
          <div>
            <div className="kick">{thisWeek ? "This week" : "Week"}</div>
            <h2 className="g-title">{dayMonth(w.weekStart)} – {dayMonth(w.weekEnd)}</h2>
            <p className="g-sub">
              {plural(studyDays.length, "study day")}{sameTarget && studyDays.length ? ` of ${hm(studyDays[0].targetMinutes)}` : ""} · {rest}
            </p>
          </div>
          <nav className="td-nav" aria-label="Week">
            <button className="btn" aria-label="Previous week" onClick={() => onDate(addDays(w.weekStart, -7))}>←</button>
            <button className="btn" disabled={thisWeek} onClick={() => onDate(null)}>This week</button>
            <button className="btn" aria-label="Next week" onClick={() => onDate(addDays(w.weekStart, 7))}>→</button>
          </nav>
        </header>

        <div className="wk-grid">
          <section className="td-card wk-sum" aria-labelledby="wk-time">
            <h3 id="wk-time" className="kick">Study time</h3>
            <div className="td-v">
              {hours1(t.actualMinutes)}
              {t.targetMinutes > 0 && <small>of {hours1(t.targetMinutes)}</small>}
            </div>
            {t.targetMinutes > 0 && <Bar value={t.actualMinutes / t.targetMinutes} />}
            <p className="g-small">
              {t.tasksRemaining ? `${plural(t.tasksRemaining, "task")} left · ${hm(t.remainingMinutes)}` : t.tasksDone ? "All tasks done." : "Nothing assigned."}
            </p>
          </section>

          <section className="wk-up" aria-labelledby="wk-up">
            <h3 id="wk-up" className="g-cap">Coming up</h3>
            {w.milestones.length === 0 ? (
              <p className="g-foot">No practice or stage deadline this week or next.</p>
            ) : (
              <ul className="g-group">
                {w.milestones.map((m, i) => {
                  const body = (
                    <>
                      <span className="g-lbl">
                        {m.title}
                        <small>{m.type === "STAGE_END" ? "Stage deadline · " : ""}{weekdayShort(m.date)} {dayMonth(m.date)}</small>
                      </span>
                      {(m.done || (m.presentation && m.presentation.state !== "milestone.planned")) && <StatusBadge p={m.presentation} fallback={m.done ? "Done" : undefined} />}
                    </>
                  );
                  return (
                    <li key={i}>
                      {m.topicId ? (
                        <button type="button" className="g-row" onClick={() => onOpenTopic(m.topicId!)}>{body}<Chevron /></button>
                      ) : (
                        <div className="g-row">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="wk-daysec" aria-labelledby="wk-days">
            <h3 id="wk-days" className="g-cap">Days</h3>
            <ul className="wk-days">
              {w.days.map((d) => (
                <li key={d.date}>
                  <button
                    type="button"
                    className={`wk-day${d.date === w.today ? " today" : ""}${d.isRestDay || !d.inJourney ? " rest" : ""}`}
                    aria-current={d.date === w.today ? "date" : undefined}
                    onClick={() => onOpenDay(d.date)}
                  >
                    <span className="wk-dn"><span>{weekdayShort(d.date)}</span> <b>{dayMonth(d.date)}</b></span>
                    <span className="wk-body"><DayBody d={d} today={w.today} /></span>
                    <Chevron />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
