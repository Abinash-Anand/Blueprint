/**
 * Recall over time for one sub-topic (docs/Recall-Plan.md §3.5, phase 2) in a glass sheet (DESIGN.md §10): the score
 * of each checked recall, the progress note written from the computed diff, and the checklist's points × recalls,
 * with ↑ where a missed point was recalled when asked. On phones the sheet rises from the bottom and the grid scrolls.
 */
import { useEffect, useState } from "react";
import { ApiError, api } from "../../api/client";
import type { RecallMatrix } from "../../api/types";
import { dayMonth } from "../../lib/format";
import { Sheet } from "./Sheet";

const MARK = { ACCURATE: "✓", PARTIAL: "~", MISSED: "✗" } as const;
const WORD = { ACCURATE: "remembered", PARTIAL: "partly", MISSED: "missed" } as const;
const TONE = { ACCURATE: "ok", PARTIAL: "part", MISSED: "miss" } as const;

export function MatrixDialog({ subtopicId, onClose }: { subtopicId: number; onClose: () => void }) {
  const [m, setM] = useState<RecallMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.recallMatrix(subtopicId).then(setM, (e) => setError(e instanceof ApiError ? e.message : "Something went wrong. Try again."));
  }, [subtopicId]);

  const latest = m?.analyses[m.analyses.length - 1];
  const scored = m?.attempts.filter((a) => a.score !== null) ?? [];
  return (
    <Sheet labelledBy="rc-grid-title" wide onClose={onClose}>
      <div className="kick">Recall over time · {m?.topic ?? "…"}</div>
      <h2 id="rc-grid-title" className="g-t2" style={{ fontSize: 24, marginTop: 4 }}>{m?.subtopic ?? "…"}</h2>
      {error && <p className="g-err" role="alert">{error}</p>}
      {m && !m.attempts.length && <p className="g-sub" style={{ marginTop: 10 }}>No checked recall of this sub-topic yet.</p>}
      {m && m.attempts.length > 0 && (
        <>
          <div className="g-overtime" style={{ display: "grid", gridTemplateColumns: "minmax(0, 280px) minmax(0, 1fr)", gap: "16px 28px", marginTop: 16, alignItems: "start" }}>
            {scored.length > 0 && (
              <div className="g-bars" role="img" aria-label={`Score per recall: ${scored.map((a) => `${dayMonth(a.date)} ${Math.round(a.score! * 100)} percent`).join(", ")}`}>
                {scored.slice(-6).map((a) => (
                  <div key={a.reviewId}><b>{Math.round(a.score! * 100)} %</b><i style={{ height: `${Math.max(3, Math.round(a.score! * 70))}px` }} />{dayMonth(a.date)}</div>
                ))}
              </div>
            )}
            <div>
              <div className="kick">Progress since last time</div>
              {latest ? (
                <>
                  {latest.narrative && <p style={{ fontSize: 14.5, lineHeight: 1.55, margin: "6px 0 0" }}>{latest.narrative}</p>}
                  <div className="g-pills" style={{ marginTop: 10 }}>
                    {latest.diff.newlyMastered.length > 0 && <span className="g-sb ok">Newly remembered: {latest.diff.newlyMastered.map((x) => x.label).join(", ")}</span>}
                    {latest.diff.regressed.length > 0 && <span className="g-sb part">Slipped: {latest.diff.regressed.map((x) => x.label).join(", ")}</span>}
                    {latest.diff.persistentBlindSpots.length > 0 && <span className="g-sb miss">Missed again and again: {latest.diff.persistentBlindSpots.map((x) => `${x.label} (${x.missedInARow}×)`).join(", ")}</span>}
                    {latest.diff.retained.length > 0 && <span className="g-sb neutral">Kept: {latest.diff.retained.map((x) => x.label).join(", ")}</span>}
                  </div>
                  {(latest.diff.recurringMisconceptions ?? []).length > 0 && (
                    <div className="g-callout miss" role="group" aria-label="Mistakes that came back" style={{ marginTop: 10 }}>
                      <span>
                        <span className="h">A corrected mistake came back</span>
                        {latest.diff.recurringMisconceptions!.map((x, i) => <span key={i} style={{ display: "block" }}>“{x.claim}”: {x.correction}</span>)}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <p className="g-sub" style={{ marginTop: 6 }}>After your next recall of this sub-topic, this compares the two.</p>
              )}
            </div>
          </div>

          <div className="g-gridbox">
            <table className="g-grid">
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: "left" }}>Point</th>
                  {m.attempts.map((a) => <th key={a.reviewId} scope="col"><b>{dayMonth(a.date)}</b>{a.score === null ? "—" : `${Math.round(a.score * 100)} %`}</th>)}
                </tr>
              </thead>
              <tbody>
                {m.points.map((p) => (
                  <tr key={p.id} style={p.leftOut ? { opacity: 0.6 } : undefined}>
                    <th scope="row">{p.label}{p.leftOut ? " (left out)" : ""}</th>
                    {m.attempts.map((a) => {
                      const c = a.cells[p.id];
                      return (
                        <td key={a.reviewId}>
                          {c ? (
                            <span className={`g-c ${TONE[c.status]}`} aria-label={`${p.label}, ${dayMonth(a.date)}: ${WORD[c.status]}${c.recalledWhenAsked ? ", recalled when asked" : ""}`}>
                              {MARK[c.status]}{c.recalledWhenAsked ? " ↑" : ""}
                            </span>
                          ) : <span className="g-small">–</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="g-legend">
            <span><span className="g-c ok">✓</span> remembered</span>
            <span><span className="g-c part">~</span> partly</span>
            <span><span className="g-c miss">✗</span> missed</span>
            <span>↑ recalled only when asked (it does not change the score)</span>
          </div>
        </>
      )}
    </Sheet>
  );
}
