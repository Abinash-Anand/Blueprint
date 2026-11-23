/**
 * One task, a page of its own (#/task/<date>/<id>), opened from Today: mark it done (or revise it, for a recall task),
 * log time, move it, edit it, skip or delete it. The row on Today keeps only the tick box.
 */
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Task, Today } from "../../api/types";
import { KIND_LABEL, dayMonth, hm, longDate, plural } from "../../lib/format";
import { openPage, recallHash } from "../../lib/nav";
import { useAppData } from "../../state/AppData";
import { Back } from "../recall/icons";
import { StatusBadge, StatusIndicator } from "../Status";
import { Loading } from "../ui";

interface PageProps { backLabel: string; onClose: () => void }

export function TaskPage({ date, id, backLabel, onClose, onOpenTopic }: PageProps & { date: string; id: number; onOpenTopic: (id: string) => void }) {
  const { version, notice } = useAppData();
  const [day, setDay] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.today(date).then((d) => live && (setDay(d), setError(null)), (e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [date, version]);
  const task = day ? [...day.tasks, ...day.carriedOver].find((t) => t.id === id) : undefined;

  return (
    <main className="view gl gl-bg">
      <div className="wrap tp">
        <button type="button" className="g-link rh-back" onClick={onClose} aria-label={`Back to ${backLabel}`}><Back />{backLabel}</button>
        {notice && <p className="g-err tp-err" role="alert">{notice}</p>}
        {error ? <p className="g-err" role="alert">{error}</p>
          : !day ? <Loading />
          : !task ? (
            <section className="g-card tp-card">
              <h2 className="g-t2">This task isn't on {longDate(date)} any more</h2>
              <p className="g-sub">It may have been moved or deleted.</p>
            </section>
          ) : <TaskDetail key={task.id} t={task} today={day.today} onClose={onClose} onOpenTopic={onOpenTopic} />}
      </div>
    </main>
  );
}

function TaskDetail({ t, today, onClose, onOpenTopic }: { t: Task; today: string; onClose: () => void; onOpenTopic: (id: string) => void }) {
  const { mutate, toggleSubtopic } = useAppData();
  const [minutes, setMinutes] = useState(Math.max(15, t.estimatedMinutes - t.loggedMinutes));
  const [newDate, setNewDate] = useState(t.scheduledDate < today ? today : t.scheduledDate);
  const [title, setTitle] = useState(t.title);
  const [est, setEst] = useState(t.estimatedMinutes);
  const [notes, setNotes] = useState(t.notes);

  const done = t.status === "DONE";
  const skipped = t.status === "SKIPPED";
  const rv = t.revision ?? t.recall ?? null;
  const taskState = t.presentation && t.presentation.state !== "task.todo" ? t.presentation : null;
  const patch = (body: Parameters<typeof api.patchTask>[1]) => mutate(() => api.patchTask(t.id, body));

  return (
    <section className="g-card tp-card" aria-labelledby="tp-title">
      <div className="kick">{t.recall ? "Recall" : KIND_LABEL[t.kind]} · {dayMonth(t.scheduledDate)}</div>
      <h2 id="tp-title" className="g-t2 tp-title">{t.title}</h2>
      <p className="g-sub tp-meta">
        {t.topic && <span>{t.topic.name}</span>}
        <span>{hm(t.estimatedMinutes)}</span>
        {t.loggedMinutes > 0 && <span>{hm(t.loggedMinutes)} logged</span>}
        {rv ? (
          <StatusIndicator p={rv.presentation} fallback={done ? "Done" : undefined} detail={rv.overdueDays > 0 ? `due ${dayMonth(rv.dueDate)}` : undefined} />
        ) : (
          <>
            {taskState && <StatusBadge p={taskState} />}
            {!t.presentation && t.overdueDays > 0 && <StatusBadge fallback={`${plural(t.overdueDays, "day")} overdue`} />}
            {t.originalDate !== t.scheduledDate && <span>planned {dayMonth(t.originalDate)}</span>}
          </>
        )}
      </p>
      {t.notes && <p className="tp-notes">{t.notes}</p>}

      <div className="tp-acts">
        {t.recall && !done && t.subtopic && (
          <button type="button" className="btn primary big" onClick={() => openPage(recallHash(t.subtopic!.id))} aria-label={`Revise: ${t.subtopic.name}`}>Revise</button>
        )}
        {!rv && (
          <button type="button" className={`btn big${done ? "" : " primary"}`} disabled={skipped} onClick={() => void patch({ status: done ? "TODO" : "DONE" })}>
            {done ? "Mark not done" : "Mark done"}
          </button>
        )}
        {t.topic && <button type="button" className="btn quiet big" onClick={() => onOpenTopic(t.topic!.id)}>Open topic</button>}
      </div>
      {rv && done && <p className="g-small tp-line">Done by its recall.</p>}

      {t.subtopic && !rv && t.topic && (
        <label className="tp-check">
          <input type="checkbox" checked={t.subtopic.completed} onChange={(e) => void toggleSubtopic(t.topic!.id, t.subtopic!.id, e.target.checked)} />
          <span>
            Sub-topic “{t.subtopic.name}” learned
            <small>Adds its floor in the city and completes this sub-topic's open study tasks. Practice tasks stay open.</small>
          </span>
        </label>
      )}

      {!rv && (
        <div className="tp-sec">
          <h3>Log time</h3>
          <div className="tp-form">
            <label>
              Minutes studied today
              <input className="inp" type="number" min={5} max={720} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
            </label>
            <button type="button" className="btn" disabled={minutes < 5 || minutes > 720} onClick={() => void mutate(() => api.logTime({ date: today, minutes, taskId: t.id }))}>
              Save time
            </button>
          </div>
        </div>
      )}

      {!(rv && done) && (
        <div className="tp-sec">
          <h3>Move to another day</h3>
          <div className="tp-form">
            <label>
              New date
              <input className="inp" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn"
              disabled={!newDate || newDate === t.scheduledDate}
              onClick={async () => {
                if ((await patch({ scheduledDate: newDate })) !== undefined) onClose();
              }}
            >
              Move
            </button>
          </div>
          {t.pinned && !done ? (
            <p className="g-foot tp-pin">
              Pinned: you moved it here, so the plan leaves it on this day.{" "}
              <button type="button" className="g-link" onClick={() => void patch({ pinned: false })} aria-label={`Unpin "${t.title}": the plan may move it again`}>Unpin</button>
            </p>
          ) : (
            <p className="g-foot">Moving it pins it: the plan leaves it on that day until you unpin it.</p>
          )}
        </div>
      )}

      {!rv && (
        <div className="tp-sec">
          <h3>Edit</h3>
          <div className="tp-form">
            <label className="grow">
              Title
              <input className="inp" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              Estimate (min)
              <input className="inp" type="number" min={5} max={720} step={5} value={est} onChange={(e) => setEst(Number(e.target.value))} />
            </label>
            <label className="full">
              Notes
              <textarea className="inp" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn"
              disabled={!title.trim() || est < 5 || est > 720 || (title.trim() === t.title && est === t.estimatedMinutes && notes === t.notes)}
              onClick={() => void patch({ title: title.trim(), estimatedMinutes: est, notes })}
            >
              Save changes
            </button>
          </div>
        </div>
      )}

      {!rv && (
        <div className="tp-sec tp-end">
          {t.source === "PLAN" ? (
            <>
              <button type="button" className="btn" onClick={() => void patch({ status: skipped ? "TODO" : "SKIPPED" })}>{skipped ? "Unskip" : "Skip"}</button>
              <span className="g-small">{skipped ? "Skipped: it no longer counts on this day." : "Skipping keeps it in the plan's history without doing it."}</span>
            </>
          ) : (
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                if (await mutate(async () => (await api.deleteTask(t.id), true))) onClose();
              }}
            >
              Delete task
            </button>
          )}
        </div>
      )}
    </section>
  );
}
