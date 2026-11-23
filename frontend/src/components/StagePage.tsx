/** A stage's dates (#/stage/<id>), a page of its own opened from Progress. Changing them moves the deadline only. */
import { useState } from "react";
import { api } from "../api/client";
import { hours1, longDate, plural } from "../lib/format";
import { useAppData } from "../state/AppData";
import { Back } from "./recall/icons";
import { StatusBadge } from "./Status";
import { Loading } from "./ui";

export function StagePage({ id, backLabel, onClose }: { id: string; backLabel: string; onClose: () => void }) {
  const { progress, mutate, notice } = useAppData();
  const s = progress?.stages.find((x) => x.id === id);
  const [start, setStart] = useState(s?.startDate ?? "");
  const [end, setEnd] = useState(s?.endDate ?? "");
  const [busy, setBusy] = useState(false);
  const changed = !!s && (start !== s.startDate || end !== s.endDate);
  const valid = !!start && !!end && start <= end;

  const save = async () => {
    if (!s || !valid || !changed) return;
    setBusy(true);
    const r = await mutate(() => api.patchStage(s.id, { startDate: start, endDate: end }));
    setBusy(false);
    if (r) onClose();
  };

  return (
    <main className="view gl gl-bg">
      <div className="wrap tp">
        <button type="button" className="g-link rh-back" onClick={onClose} aria-label={`Back to ${backLabel}`}><Back />{backLabel}</button>
        {notice && <p className="g-err tp-err" role="alert">{notice}</p>}
        {!progress ? <Loading /> : !s ? (
          <section className="g-card tp-card"><h2 className="g-t2">This stage isn't in the plan any more</h2></section>
        ) : (
          <section className="g-card tp-card" aria-labelledby="sp-title">
            <div className="kick">Stage{s.kind === "PARALLEL" ? " · parallel" : ""}</div>
            <h2 id="sp-title" className="g-t2 tp-title">{s.name}</h2>
            <p className="g-sub tp-meta">
              <span>{s.tasksDone}/{s.tasksTotal} tasks · {hours1(s.minutesDone)} of {hours1(s.minutesTotal)}</span>
              {s.bufferDays > 0 && <span>{plural(s.bufferDays, "buffer day")}</span>}
              <StatusBadge p={s.presentation} fallback={s.status.toLowerCase().replace("_", " ")} />
            </p>
            <form className="tp-form tp-stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <label>
                Start
                <input className="inp" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label>
                End
                <input className="inp" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
              </label>
              <p className="g-foot full">
                {valid ? `${longDate(start)} to ${longDate(end)}.` : "The end can't come before the start."} Changing the dates moves the deadline only: tasks stay where they are, and you reschedule them from Today.
              </p>
              <div className="tp-acts full">
                <button type="submit" className="btn primary big" disabled={!valid || !changed || busy} aria-busy={busy}>{busy ? "Saving…" : "Save dates"}</button>
              </div>
            </form>
          </section>
        )}
      </div>
    </main>
  );
}
