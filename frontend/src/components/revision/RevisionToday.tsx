/** Today's revision v2 set on the Today view (plan §3.1): one line and a way into the Revision tab. Hidden when nothing is due. */
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { RevisionHome } from "../../api/types";
import { plural } from "../../lib/format";
import { useAppData } from "../../state/AppData";

export function RevisionToday({ onOpen }: { onOpen?: () => void }) {
  const { version } = useAppData();
  const [h, setH] = useState<RevisionHome | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => api.revisionHome()).then((x) => live && setH(x), () => live && setH(null));
    return () => {
      live = false;
    };
  }, [version]);
  if (!h || (!h.plan.questions && !h.activeSession)) return null;
  return (
    <div className="card rh-banner" role="region" aria-label="Revision today">
      <div>
        <div className="kick">Revision</div>
        <b>{h.activeSession ? "Your revision session is open" : `${plural(h.plan.questions, "question")} · about ${h.plan.minutes} min`}</b>
        {!h.activeSession && <span className="m"> · {h.plan.topics.map((t) => t.name).join(", ")}</span>}
      </div>
      {onOpen && <button className="btn primary" onClick={onOpen}>{h.activeSession ? "Continue" : "Revise now"}</button>}
    </div>
  );
}
