/**
 * "Report" on a revision question or an AI check (Revision v2 plan §3.4): out of syllabus, unclear, the check was
 * unfair, or something else, with an optional note. It is only a record for improving questions and the AI check: it
 * never changes a score, a question or a schedule.
 */
import { useState } from "react";
import { ApiError, api } from "../api/client";

export type ReportReason = "OUT_OF_SYLLABUS" | "UNCLEAR" | "UNFAIR_CHECK" | "OTHER";
const REASONS: Record<ReportReason, string> = {
  OUT_OF_SYLLABUS: "Not in what I studied",
  UNCLEAR: "The question is unclear",
  UNFAIR_CHECK: "The AI check was unfair",
  OTHER: "Something else",
};

export function ReportIssue({ label = "Report", reasons, context }: {
  label?: string;
  reasons: ReportReason[];
  context: { promptText: string; topicId?: string; scheduleId?: number; promptId?: number | null; evaluationId?: number; responseId?: number; itemId?: number };
}) {
  const [open, setOpen] = useState(false);
  const [wholeConcept, setWholeConcept] = useState(false);
  const [reason, setReason] = useState<ReportReason>(reasons[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) return <span className="rp-done" role="status">Thanks, noted. It helps improve the questions and the check.</span>;
  if (!open) return <button type="button" className="link rp-open" onClick={() => setOpen(true)}>{label}</button>;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.report({
        reason, note: note.trim() || undefined, promptText: context.promptText,
        topicId: context.topicId, scheduleId: context.scheduleId, promptId: context.promptId ?? undefined, evaluationId: context.evaluationId,
        responseId: context.responseId, itemId: context.itemId,
        removeConcept: reason === "OUT_OF_SYLLABUS" && context.itemId && wholeConcept ? true : undefined,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The report couldn't be sent. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rp" role="group" aria-label="Report a problem">
      {reasons.length > 1 && (
        <div className="rp-reasons" role="radiogroup" aria-label="What's wrong?">
          {reasons.map((r) => (
            <label key={r} className={reason === r ? "on" : ""}>
              <input type="radio" name="rp-reason" checked={reason === r} onChange={() => setReason(r)} /> {REASONS[r]}
            </label>
          ))}
        </div>
      )}
      {reason === "OUT_OF_SYLLABUS" && context.itemId && (
        <label className="rp-scope">
          <input type="checkbox" checked={wholeConcept} onChange={(e) => setWholeConcept(e.target.checked)} /> Leave out the whole concept, not only this question
        </label>
      )}
      {reason === "OUT_OF_SYLLABUS" && context.itemId && <p className="m">It won't be asked again. You can bring it back in the topic's revision pack.</p>}
      <textarea className="inp" rows={2} maxLength={1000} placeholder={reason === "UNFAIR_CHECK" ? "Which point did you cover? (optional)" : "Anything to add? (optional)"} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
      {error && <p className="af-err">{error}</p>}
      <div className="rp-acts">
        <button type="button" className="btn" aria-busy={busy} disabled={busy} onClick={() => void send()}>Send report</button>
        <button type="button" className="link" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
