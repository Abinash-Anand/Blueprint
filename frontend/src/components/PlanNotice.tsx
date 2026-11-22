/**
 * One line on Today after a re-plan moved tasks (docs/Scheduler-Phase2-Plan.md): what moved, why, and what it did to
 * the projected finish. Shown until dismissed; which change was seen is remembered per city in this browser only.
 */
import { useEffect, useState } from "react";
import { api, getCurrentCity } from "../api/client";
import type { PlanChange } from "../api/types";
import { dayMonth, plural } from "../lib/format";

const WHY: Record<PlanChange["reason"], string> = {
  DAILY: "to fit work left from earlier days",
  AVAILABILITY: "to fit your new study times",
  STAGES: "to fit the new stage dates",
  OVERDUE: "to move unfinished work forward",
};

const seenKey = () => `bp.planChangeSeen.${getCurrentCity() ?? ""}`;
const readSeen = () => {
  try {
    return localStorage.getItem(seenKey()) ?? "";
  } catch {
    return "";
  }
};

const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** "Projected finish 12 Mar (3 days later)" or "… unchanged". */
export function finishText(c: Pick<PlanChange, "finishBefore" | "finishAfter">) {
  if (!c.finishAfter) return "Nothing new is left to plan.";
  if (!c.finishBefore || c.finishBefore === c.finishAfter) return `Projected finish unchanged (${dayMonth(c.finishAfter)}).`;
  const d = days(c.finishBefore, c.finishAfter);
  return `Projected finish ${dayMonth(c.finishAfter)} (${plural(Math.abs(d), "day")} ${d > 0 ? "later" : "earlier"}).`;
}

export const changeText = (c: PlanChange) => `The plan moved ${plural(c.moved, "task")} ${WHY[c.reason]}.`;

export function PlanNotice({ version }: { version: number }) {
  const [change, setChange] = useState<PlanChange | null>(null);
  const [seen, setSeen] = useState(readSeen);
  useEffect(() => {
    let live = true;
    api.planChanges().then((xs) => live && setChange(xs[0] ?? null), () => undefined);
    return () => {
      live = false;
    };
  }, [version]);
  if (!change || change.at <= seen) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(seenKey(), change.at);
    } catch {
      /* a per-viewer convenience */
    }
    setSeen(change.at);
  };
  return (
    <div className="plan-note" role="status">
      <span>
        <b>{changeText(change)}</b> {finishText(change)} Their original dates are kept, and tasks you moved by hand stay put.
      </span>
      <button className="btn" onClick={dismiss}>Got it</button>
    </div>
  );
}
