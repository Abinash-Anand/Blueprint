/**
 * Today (SRS §3.4), in glass (DESIGN.md §10): on the left the one thing to do now, the study time and where you are; on
 * the right the day's tasks and time log. One column on a phone, with the next action first. Each task, adding a task and
 * logging time open pages of their own.
 */
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Task, Today } from "../api/types";
import { addDays, hm, longDate, plural } from "../lib/format";
import { useAppData } from "../state/AppData";
import { YOUR_TIME, addTaskHash, logTimeHash, openPage, taskHash } from "../lib/nav";
import { PlanNotice } from "./PlanNotice";
import { RecallToday } from "./recall/RecallToday";
import { Chevron, Close, Plus } from "./recall/icons";
import { TaskRow } from "./TaskRow";
import { Bar, Loading } from "./ui";

interface Props {
  date: string | null; // null = today
  onDate: (date: string | null) => void;
  onOpenTopic: (id: string) => void;
  onOpenRevision?: () => void;
}

/** What a day with nothing left to do says, in place of the next action. */
function restingState(d: Today, isToday: boolean, live: Task[]): { title: string; text?: string } {
  if (d.journey.status !== "ACTIVE" && d.tasks.length === 0) {
    return { title: "Outside the journey", text: `The plan runs from ${longDate(d.journey.start)} to ${longDate(d.journey.end)}.` };
  }
  if (d.isRestDay) return { title: "Rest day", text: "No assignments and no target. Rest is part of the plan." };
  if (d.isBufferDay && d.tasks.length === 0) return { title: "Buffer day", text: "No new material today. This day absorbs delays: use it for carried-over work." };
  if (live.length > 0) return { title: isToday ? "All done for today" : "All done on this day", text: isToday ? "Anything more is a bonus." : undefined };
  if (isToday && d.targetMinutes > 0) return { title: "Nothing planned today: you're ahead", text: "Your next tasks are on later days. Use the time to revise, or rest." };
  return { title: "No tasks on this day" };
}

export function TodayView({ date, onDate, onOpenTopic, onOpenRevision }: Props) {
  const { version, mutate, topicById, districtById } = useAppData();
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error) return <div className="view gl gl-bg"><div className="wrap"><p className="g-err" role="alert">{error}</p></div></div>;
  if (!data) return <div className="view gl gl-bg"><Loading /></div>;

  const isToday = data.date === data.today;
  const isPast = data.date < data.today;
  const topic = data.current.topicId ? topicById.get(data.current.topicId) : undefined;
  const district = data.current.districtId ? districtById.get(data.current.districtId) : undefined;
  const live = data.tasks.filter((t) => t.status !== "SKIPPED");
  const open = live.filter((t) => t.status === "TODO");
  const mainStage = data.stages.find((s) => s.kind === "MAIN");
  const sideStage = data.stages.find((s) => s.kind === "PARALLEL");

  // The one next action: a due recall (shown by RecallToday), else the next study task, else what the day is.
  const recallDue = isToday && data.recall.dueCount > 0;
  const next = isToday && !recallDue ? open.find((t) => !t.recall && !t.revision) : undefined;
  const resting = open.length === 0 && (isToday || data.tasks.length === 0) ? restingState(data, isToday, live) : null;
  const nextDistrict = next?.topic ? districtById.get(next.topic.districtId) : undefined;
  // "Where you are" only when the next action doesn't already name that topic.
  const showWhere = !!topic && next?.topic?.id !== topic.id;
  const hasTarget = !data.isRestDay && data.targetMinutes > 0;

  const sessionLabel = (s: Today["sessions"][number]) =>
    data.tasks.find((t) => t.id === s.taskId)?.title ?? (s.topicId ? topicById.get(s.topicId)?.name : undefined) ?? "General study";

  return (
    <div className="view gl gl-bg">
      <div className="wrap td">
        <header className="td-head">
          <div>
            <div className="kick">{isToday ? "Today" : isPast ? "Past day" : "Upcoming day"}</div>
            <h2 className="g-title">{longDate(data.date)}</h2>
            <p className="g-sub">
              {data.journey.status === "ACTIVE"
                ? `Day ${data.journey.day} of ${data.journey.totalDays}`
                : data.journey.status === "BEFORE"
                  ? "Before the journey starts"
                  : "After the journey"}
              {mainStage && ` · ${mainStage.name} stage`}
              {sideStage && data.weekday === 6 && ` · ${sideStage.name}`}
            </p>
          </div>
          <nav className="td-nav" aria-label="Day">
            <button className="btn" aria-label="Previous day" onClick={() => onDate(addDays(data.date, -1))}>←</button>
            <button className="btn" disabled={isToday} onClick={() => onDate(null)}>Today</button>
            <button className="btn" aria-label="Next day" onClick={() => onDate(addDays(data.date, 1))}>→</button>
          </nav>
        </header>

        {isToday && <PlanNotice version={version} />}

        <div className="td-split">
          <div className="td-aside">
            {next && (
              <section className="g-hero" aria-labelledby="td-next">
                <div className="g-grow">
                  <div className="kick">Up next</div>
                  <h3 id="td-next" className="g-hero-name">
                    {nextDistrict && <span className="g-dot" style={{ background: nextDistrict.color }} />}
                    {next.title}
                  </h3>
                  <p className="g-sub">{next.topic ? `${next.topic.name} · ` : ""}{hm(next.estimatedMinutes)}</p>
                </div>
                <button
                  type="button"
                  className="btn primary big"
                  onClick={() => (next.topic ? onOpenTopic(next.topic.id) : openPage(taskHash(data.date, next.id)))}
                >
                  {next.topic ? "Open topic" : "Open task"}
                </button>
              </section>
            )}
            {!next && resting && !recallDue && (
              <section className="g-hero quiet" aria-labelledby="td-rest">
                <div className="g-grow">
                  <h3 id="td-rest" className="g-hero-name">{resting.title}</h3>
                  {resting.text && <p className="g-sub">{resting.text}</p>}
                </div>
              </section>
            )}
            {isToday && <RecallToday onOpen={onOpenRevision} />}

            <section className="td-card" aria-labelledby="td-time">
              <div className="td-card-top">
                <h3 id="td-time" className="kick">Study time</h3>
                <button type="button" className="g-link quiet" onClick={() => openPage(YOUR_TIME)} aria-label="Change your study time">Change</button>
              </div>
              <div className="td-v">
                {hm(data.actualMinutes)}
                {hasTarget && <small>of {hm(data.targetMinutes)}</small>}
              </div>
              {hasTarget && <Bar value={data.actualMinutes / data.targetMinutes} />}
              {open.length > 0 ? (
                <p className="g-small">{plural(open.length, "task")} left</p>
              ) : !data.isRestDay && data.targetMinutes === 0 && data.journey.status === "ACTIVE" ? (
                <p className="g-small">No target on this day.</p>
              ) : null}
            </section>

            {showWhere && topic && (
              <>
                <h3 className="g-cap">Where you are</h3>
                <ul className="g-group">
                  <li>
                    <button type="button" className="g-row" onClick={() => onOpenTopic(topic.id)}>
                      {district && <span className="g-dot" style={{ background: district.color }} />}
                      <span className="g-lbl">
                        {topic.name}
                        <small>{district?.name}{data.next?.subtopic ? ` · next: ${data.next.subtopic}` : ""}</small>
                      </span>
                      <Chevron />
                    </button>
                  </li>
                </ul>
              </>
            )}
          </div>

          <div className="td-main">
            <div className="td-cap">
              <h3>{data.isRestDay ? "Optional today" : isToday ? "Today's assignments" : "Assignments"}</h3>
              <button type="button" className="g-link" onClick={() => openPage(addTaskHash(data.date))}><Plus />Add task</button>
            </div>
            {data.tasks.length > 0 && (
              <ul className="g-group">
                {data.tasks.map((t) => <TaskRow key={t.id} task={t} today={data.today} date={data.date} />)}
              </ul>
            )}

            {data.carriedOver.length > 0 && (
              <>
                <h3 className="g-cap">Carried over</h3>
                <ul className="g-group">
                  {data.carriedOver.map((t) => <TaskRow key={t.id} task={t} today={data.today} date={data.date} compact />)}
                </ul>
                <p className="g-foot">Unfinished work moves forward on its own. These stayed: you moved them here by hand, or no study day had room yet.</p>
              </>
            )}

            {(data.isRestDay || data.isBufferDay) && data.reviewTopics.length > 0 && (
              <>
                <h3 className="g-cap">Marked for review</h3>
                <ul className="g-group">
                  {data.reviewTopics.map((t) => (
                    <li key={t.id}>
                      <button type="button" className="g-row" onClick={() => onOpenTopic(t.id)}>
                        <span className="g-lbl">{t.name}<small>{districtById.get(t.districtId)?.name}</small></span>
                        <Chevron />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {data.date <= data.today && (
              <>
                <div className="td-cap">
                  <h3>Time log</h3>
                  <button type="button" className="g-link" onClick={() => openPage(logTimeHash(data.date))}><Plus />Log time</button>
                </div>
                {data.sessions.length === 0 ? (
                  <p className="g-foot">Nothing logged{isToday ? " yet today" : " on this day"}.</p>
                ) : (
                  <ul className="g-group">
                    {data.sessions.map((s) => (
                      <li key={s.id}>
                        <div className="g-row">
                          <span className="g-lbl">{sessionLabel(s)}</span>
                          <span className="g-val">{hm(s.minutes)}</span>
                          <button type="button" className="td-x" aria-label={`Delete ${hm(s.minutes)} logged for ${sessionLabel(s)}`} onClick={() => void mutate(() => api.deleteSession(s.id))}>
                            <Close />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
