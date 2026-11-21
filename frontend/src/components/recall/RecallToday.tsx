/**
 * Recall on the Today view (docs/Recall-Plan.md §3.1): what is due today; when nothing is, what comes next (tomorrow,
 * or the next date), so a newly learned sub-topic's schedule is visible at once. Hidden when nothing is scheduled.
 */
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { RecallHome } from "../../api/types";
import { addDays, dayMonth, plural } from "../../lib/format";
import { useAppData } from "../../state/AppData";

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

  const names = (xs: { subtopic: string }[]) => xs.slice(0, 4).map((s) => s.subtopic).join(", ") + (xs.length > 4 ? `, +${xs.length - 4} more` : "");
  if (h.due.length) {
    return (
      <div className="card rh-banner" role="region" aria-label="Recall today">
        <div>
          <div className="kick">Revision · today</div>
          <b>{plural(h.due.length, "sub-topic")} to recall</b>
          <span className="m"> · {names(h.due)}</span>
        </div>
        {onOpen && <button className="btn primary" onClick={onOpen}>Recall now</button>}
      </div>
    );
  }
  // By the day each recall is planned (the daily limit may move some past their due date).
  const planned = [...h.later, ...h.upcoming].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  const next = planned[0]?.scheduledDate;
  if (!next) return null;
  const on = planned.filter((s) => s.scheduledDate === next);
  const when = next === addDays(h.today, 1) ? "Tomorrow" : dayMonth(next);
  return (
    <div className="card rh-banner soft" role="region" aria-label="Next recall">
      <div>
        <div className="kick">Revision · next</div>
        <b>{when}: {plural(on.length, "sub-topic")} to recall</b>
        <span className="m"> · {names(on)}</span>
      </div>
      {onOpen && <button className="btn" onClick={onOpen}>See revision</button>}
    </div>
  );
}
