/**
 * One status vocabulary for revision across Revision, Today, Week and the topic panel (refinement §2.2).
 *
 * A unit has exactly one primary state, chosen in this order:
 *   Paused (sub-topic unticked) → Correct the gap first → Overdue → Due today → Done today → Upcoming.
 * "Weak" is not a state but a flag that can sit next to any of them (a unit can be weak and overdue).
 * Treatment: overdue and correction in bold ink, due today in the accent colour, everything else muted; one outlined
 * "Weak" tag at most. No other coloured badges.
 */
import { dayMonth, plural } from "../lib/format";

export type RevisionPrimary = "PAUSED" | "CORRECTION" | "OVERDUE" | "DUE" | "DONE_TODAY" | "UPCOMING";

export interface RevisionStateInput {
  suspended?: boolean;
  correctionPending: boolean;
  nextDueDate: string | null;
  lastAttemptDate?: string | null;
  completed?: boolean;
}

export function revisionPrimary(x: RevisionStateInput, today: string): { state: RevisionPrimary; text: string } {
  if (x.suspended) return { state: "PAUSED", text: "Paused: not marked learned" };
  if (x.correctionPending) return { state: "CORRECTION", text: "Correct the gap first" };
  if (x.completed || (x.lastAttemptDate === today && (!x.nextDueDate || x.nextDueDate > today)))
    return { state: "DONE_TODAY", text: x.nextDueDate ? `Done today · next ${dayMonth(x.nextDueDate)}` : "Done today" };
  if (x.nextDueDate && x.nextDueDate < today) {
    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${x.nextDueDate}T00:00:00Z`)) / 86_400_000);
    return { state: "OVERDUE", text: `${plural(days, "day")} overdue` };
  }
  if (x.nextDueDate === today) return { state: "DUE", text: "Due today" };
  return { state: "UPCOMING", text: x.nextDueDate ? `Next ${dayMonth(x.nextDueDate)}` : "Scheduled" };
}

export function RevisionStatus({ x, today, weak, extra }: { x: RevisionStateInput; today: string; weak?: boolean; extra?: string }) {
  const p = revisionPrimary(x, today);
  return (
    <span className="rstat">
      <span className={`rs rs-${p.state.toLowerCase().replace("_", "-")}`}>{p.text}</span>
      {extra && <span className="rs-extra"> · {extra}</span>}
      {weak && <span className="tag ink rs-weak">Weak</span>}
    </span>
  );
}
