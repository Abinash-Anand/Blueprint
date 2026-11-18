import { useState } from "react";
import { api } from "../api/client";
import type { Task } from "../api/types";
import { KIND_LABEL, dayMonth, hm, plural } from "../lib/format";
import { useAppData } from "../state/AppData";
import { RecallDialog } from "./RecallDialog";

interface Props {
  task: Task;
  today: string;
  onOpenTopic: (id: string) => void;
  compact?: boolean;
}

type Mode = null | "log" | "edit" | "move";

export function TaskRow({ task: t, today, onOpenTopic, compact }: Props) {
  const { mutate, toggleSubtopic } = useAppData();
  const [mode, setMode] = useState<Mode>(null);
  const [minutes, setMinutes] = useState(0);
  const [date, setDate] = useState(t.scheduledDate);
  const [title, setTitle] = useState(t.title);
  const [est, setEst] = useState(t.estimatedMinutes);
  const [notes, setNotes] = useState(t.notes);
  const [recall, setRecall] = useState(false);

  const open = (m: Mode) => {
    setMode(m === mode ? null : m);
    setMinutes(Math.max(15, t.estimatedMinutes - t.loggedMinutes));
    setDate(t.scheduledDate < today ? today : t.scheduledDate);
    setTitle(t.title);
    setEst(t.estimatedMinutes);
    setNotes(t.notes);
  };
  const run = async (fn: () => Promise<unknown>) => {
    const r = await mutate(fn);
    if (r !== undefined) setMode(null);
  };

  const done = t.status === "DONE";
  const skipped = t.status === "SKIPPED";
  const label = `${t.title}${t.topic ? ` (${t.topic.name})` : ""}`;
  const rv = t.revision;
  const overdue = rv ? rv.overdueDays : t.overdueDays;

  return (
    <li className={`task${done ? " done" : ""}${skipped ? " skipped" : ""}`}>
      <div className="top">
        {rv ? (
          // Completed only by an assessed recall attempt (Revision spec 9.3), so no tick box.
          <span className={`rvmark${done ? " on" : ""}`} role="img" aria-label={done ? "Revision recorded" : "Revision: complete it by recording an attempt"}>
            {done ? "✓" : "↻"}
          </span>
        ) : (
          <input
            type="checkbox"
            aria-label={`Mark "${label}" as ${done ? "not done" : "done"}`}
            checked={done}
            disabled={skipped}
            onChange={(e) => void mutate(() => api.patchTask(t.id, { status: e.target.checked ? "DONE" : "TODO" }))}
          />
        )}
        <div className="body">
          <div className="ttl">{t.title}</div>
          <div className="meta">
            {t.topic && (
              <button className="link" onClick={() => onOpenTopic(t.topic!.id)}>
                {t.topic.name}
              </button>
            )}
            <span>{KIND_LABEL[t.kind]}</span>
            {t.loggedMinutes > 0 && <span>{hm(t.loggedMinutes)} logged</span>}
            {overdue > 0 && <span className="delayed">{plural(overdue, "day")} overdue</span>}
            {rv ? (
              rv.dueDate !== t.scheduledDate && <span>due {dayMonth(rv.dueDate)}</span>
            ) : (
              t.originalDate !== t.scheduledDate && <span>planned {dayMonth(t.originalDate)}</span>
            )}
            {rv?.weak && <span className="tag ink">Weak</span>}
            {rv?.correctionPending && <span className="tag ink">Correction pending</span>}
            {compact && t.scheduledDate !== today && <span>on {dayMonth(t.scheduledDate)}</span>}
            {skipped && <span>skipped</span>}
            {t.subtopic && !rv && (
              <label className="subchk" title="Ticks the floor in the curriculum. Separate from completing the task.">
                <input type="checkbox" aria-label={`Sub-topic "${t.subtopic.name}" learned`} checked={t.subtopic.completed} onChange={(e) => void toggleSubtopic(t.topic!.id, t.subtopic!.id, e.target.checked)} />
                sub-topic learned
              </label>
            )}
          </div>
          {t.notes && !compact && <div className="notes">{t.notes}</div>}
          <div className="acts">
            {rv && !done && t.topic && (
              <button className="btn primary" onClick={() => setRecall(true)} aria-label={`Start revision: ${t.title}`}>Revise</button>
            )}
            {!rv && <button className="btn" onClick={() => open("log")} aria-expanded={mode === "log"}>Log time</button>}
            <button className="btn" onClick={() => open("move")} aria-expanded={mode === "move"}>Reschedule</button>
            <button className="btn" onClick={() => open("edit")} aria-expanded={mode === "edit"}>Edit</button>
            {rv ? null : t.source === "PLAN" ? (
              <button className="btn" onClick={() => void mutate(() => api.patchTask(t.id, { status: skipped ? "TODO" : "SKIPPED" }))}>
                {skipped ? "Unskip" : "Skip"}
              </button>
            ) : (
              <button className="btn" onClick={() => void mutate(() => api.deleteTask(t.id))}>Delete</button>
            )}
          </div>

          {mode === "log" && (
            <div className="form">
              <label>
                Minutes studied today
                <input className="inp" type="number" min={1} max={720} step={5} value={minutes} style={{ width: 110 }} onChange={(e) => setMinutes(Number(e.target.value))} />
              </label>
              <button className="btn primary" disabled={minutes < 1 || minutes > 720} onClick={() => void run(() => api.logTime({ date: today, minutes, taskId: t.id }))}>
                Save time
              </button>
              <button className="btn" onClick={() => setMode(null)}>Cancel</button>
            </div>
          )}
          {mode === "move" && (
            <div className="form">
              <label>
                New date
                <input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <button className="btn primary" disabled={!date || date === t.scheduledDate} onClick={() => void run(() => api.patchTask(t.id, { scheduledDate: date }))}>
                Move
              </button>
              <button className="btn" onClick={() => setMode(null)}>Cancel</button>
            </div>
          )}
          {mode === "edit" && (
            <div className="form">
              <label className="grow">
                Title
                <input className="inp" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label>
                Estimate (min)
                <input className="inp" type="number" min={5} max={720} step={15} value={est} style={{ width: 100 }} onChange={(e) => setEst(Number(e.target.value))} />
              </label>
              <label style={{ flexBasis: "100%" }}>
                Notes
                <textarea className="inp" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
              </label>
              <button
                className="btn primary"
                disabled={!title.trim() || est < 5 || est > 720}
                onClick={() => void run(() => api.patchTask(t.id, { title: title.trim(), estimatedMinutes: est, notes }))}
              >
                Save
              </button>
              <button className="btn" onClick={() => setMode(null)}>Cancel</button>
            </div>
          )}
        </div>
        <div className="est">{hm(t.estimatedMinutes)}</div>
      </div>
      {recall && rv && t.topic && (
        <RecallDialog items={[{ topicId: t.topic.id, scope: rv.scope, subtopicId: t.subtopic?.id ?? null, mode: "revision" }]} onClose={() => setRecall(false)} />
      )}
    </li>
  );
}
