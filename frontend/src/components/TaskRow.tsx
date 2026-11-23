/**
 * One task on Today: a tick box (recall tasks have none: they are done by their recall) and the task, which opens its own
 * page (#/task/<date>/<id>) for logging time, moving, editing and the rest. One action on the row keeps the list calm.
 */
import type { Task } from "../api/types";
import { KIND_LABEL, dayMonth, hm, plural } from "../lib/format";
import { openPage, taskHash } from "../lib/nav";
import { useAppData } from "../state/AppData";
import { api } from "../api/client";
import { Chevron } from "./recall/icons";
import { StatusBadge, StatusIndicator } from "./Status";

interface Props {
  task: Task;
  /** The real today. */
  today: string;
  /** The day the list shows: the task page looks the task up on it. */
  date: string;
  compact?: boolean;
}

export function TaskRow({ task: t, today, date, compact }: Props) {
  const { mutate } = useAppData();
  const done = t.status === "DONE";
  const skipped = t.status === "SKIPPED";
  const label = `${t.title}${t.topic ? ` (${t.topic.name})` : ""}`;
  // Earlier revision tasks and recall tasks (docs/Recall-Plan.md) look alike: done by their recall, never by a tick.
  const rv = t.revision ?? t.recall ?? null;
  // The default "to do" state needs no badge; every other task state is shown as the backend presents it.
  const taskState = t.presentation && t.presentation.state !== "task.todo" ? t.presentation : null;

  return (
    <li className={`td-task${done ? " done" : ""}${skipped ? " skipped" : ""}`}>
      <div className="g-row g-top">
        {rv ? (
          // The "Revision" word in the row says what it is; the mark is decoration.
          <span className={`td-mark${done ? " on" : ""}`} aria-hidden="true">{done ? "✓" : "↻"}</span>
        ) : (
          <label className="td-tick">
            <input
              type="checkbox"
              aria-label={`Mark "${label}" as ${done ? "not done" : "done"}`}
              checked={done}
              disabled={skipped}
              onChange={(e) => void mutate(() => api.patchTask(t.id, { status: e.target.checked ? "DONE" : "TODO" }))}
            />
          </label>
        )}
        <button type="button" className="td-open" onClick={() => openPage(taskHash(date, t.id))}>
          <span className="g-lbl">
            <span className="td-ttl">{t.title}</span>
            <small className="td-meta">
              {t.topic && <span>{t.topic.name}</span>}
              <span>{KIND_LABEL[t.kind]}</span>
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
              {compact && t.scheduledDate !== today && <span>on {dayMonth(t.scheduledDate)}</span>}
              {t.pinned && !done && <span className="td-pin">Pinned</span>}
            </small>
          </span>
          <span className="g-val">{hm(t.estimatedMinutes)}</span>
          <Chevron />
        </button>
      </div>
    </li>
  );
}
