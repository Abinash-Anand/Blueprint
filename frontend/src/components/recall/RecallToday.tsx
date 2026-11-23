/**
 * Recall on the Today view (docs/Recall-Plan.md §3.1): what is due today; when nothing is, what comes next (tomorrow,
 * or the next date), so a newly learned sub-topic's schedule is visible at once. Hidden when nothing is scheduled.
 */
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { RecallHome } from "../../api/types";
import { addDays, dayMonth, plural } from "../../lib/format";
import { useAppData } from "../../state/AppData";
import { Chevron } from "./icons";

export function RecallToday({ onOpen }: { onOpen?: () => void }) {
  const { version } = useAppData();
  const [h, setH] = useState<RecallHome | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => api.recallHome()).then((x) => live && setH(x), () => live && setH(null));
    return () => {
      live = false;
    };
  }, [version]);
  if (!h) return null;

  const names = (xs: { subtopic: string }[]) => xs.slice(0, 3).map((s) => s.subtopic).join(", ") + (xs.length > 3 ? `, +${xs.length - 3} more` : "");
  if (h.due.length) {
    // Due recall is the day's next action: Today's one hero card.
    return (
      <section className="g-hero" aria-labelledby="rt-due">
        <div className="g-grow">
          <div className="kick">Up next · Recall</div>
          <h3 id="rt-due" className="g-hero-name">{plural(h.due.length, "sub-topic")} to recall</h3>
          <p className="g-sub">{names(h.due)}</p>
        </div>
        {onOpen && <button type="button" className="btn primary big" onClick={onOpen}>Recall now</button>}
      </section>
    );
  }
  // By the day each recall is planned (the daily limit may move some past their due date).
  const planned = [...h.later, ...h.upcoming].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  const next = planned[0]?.scheduledDate;
  if (!next) return null;
  const on = planned.filter((s) => s.scheduledDate === next);
  const when = next === addDays(h.today, 1) ? "Tomorrow" : dayMonth(next);
  const body = (
    <>
      <span className="g-lbl">
        <span>{when}: {plural(on.length, "sub-topic")} to recall</span>
        <small>{names(on)}</small>
      </span>
      {onOpen && <Chevron />}
    </>
  );
  return (
    <ul className="g-group td-soon" aria-label="Next recall">
      <li>{onOpen ? <button type="button" className="g-row" onClick={onOpen}>{body}</button> : <div className="g-row">{body}</div>}</li>
    </ul>
  );
}
