/**
 * The revision home (Revision v2 plan §3.1) at the top of the Revision tab: today's set, Start or Continue, each topic's
 * cycle and next date, topics that still need material, and each topic's history (§3.6).
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, api } from "../../api/client";
import type { HistoryAnswer, RevisionHistory, RevisionHome as Home, SessionKind } from "../../api/types";
import { dayMonth, plural } from "../../lib/format";
import { useAppData } from "../../state/AppData";
import { PackDialog } from "./PackDialog";
import { Highlighted, Workspace } from "./Workspace";

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");

export function RevisionHome() {
  const { version, reload } = useAppData();
  const [h, setH] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const [work, setWork] = useState<{ start?: SessionKind; sessionId?: number } | null>(null);
  const [pack, setPack] = useState<{ topicId: string; name: string } | null>(null);
  const [history, setHistory] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.revisionHome().then((x) => live && (setH(x), setError(null)), (e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [version, n]);

  if (error) return <div className="card empty">{error}</div>;
  if (!h) return null;
  const p = h.plan;
  const closeWork = () => {
    setWork(null);
    setN((x) => x + 1);
    void reload();
  };
  const due = h.tracks.filter((t) => t.due);
  const later = h.tracks.filter((t) => !t.due);

  return (
    <div className="rh">
      <div className="rh-today card">
        <div>
          <div className="kick">Today</div>
          {h.activeSession ? (
            <h3>A revision session is open</h3>
          ) : p.questions ? (
            <h3>{plural(p.topics.length, "topic")} · {plural(p.questions, "question")} · about {p.minutes} min</h3>
          ) : (
            <h3>{h.tracks.length ? "Nothing due today" : "No revision packs yet"}</h3>
          )}
          <p className="sub">
            {h.activeSession ? "Pick up where you left off." : p.questions ? p.topics.map((t) => `${t.name} · cycle ${t.cycle} of 6`).join(" · ") : h.tracks.length ? "Your next reviews are listed below." : "Prepare a topic's revision pack: open a topic you have learned and add what you studied."}
            {p.laterToday > 0 && ` ${plural(p.laterToday, "more topic")} fit${p.laterToday === 1 ? "s" : ""} another day.`}
          </p>
        </div>
        <div className="rh-acts">
          {h.activeSession ? (
            <button className="btn primary" onClick={() => setWork({ sessionId: h.activeSession!.id })}>Continue</button>
          ) : p.questions ? (
            <button className="btn primary" onClick={() => setWork({ start: "PLANNED" })}>Start</button>
          ) : (
            <>
              {h.keepGoing.tomorrow > 0 && <button className="btn" onClick={() => setWork({ start: "EARLY" })}>Revise tomorrow's topics now</button>}
              {h.keepGoing.practice && <button className="btn" onClick={() => setWork({ start: "PRACTICE" })}>Practise weak concepts</button>}
            </>
          )}
        </div>
      </div>

      {(due.length > 0 || later.length > 0 || h.needsMaterial.length > 0) && (
        <ul className="rh-list card" aria-label="Topics in revision">
          {[...due, ...later].map((t) => (
            <li key={t.topicId}>
              <div>
                <b>{t.name}</b>{" "}
                <span className="m">
                  {t.state === "RETAINED" ? `retained · all six cycles done${t.maintenance && t.nextDueDate ? ` · check ${t.due ? "due today" : dayMonth(t.nextDueDate)}` : ""}` : `cycle ${t.inProgress} of 6 · ${t.overdue ? `overdue since ${dayMonth(t.nextDueDate!)}` : t.due ? "due today" : t.nextDueDate ? `next ${dayMonth(t.nextDueDate)}` : "starts after you learn a sub-topic"}${t.weakOnly ? " · shaky concepts only" : ""}`}
                </span>
                {t.line && <div className="m">{t.line}</div>}
              </div>
              <div className="rh-row-acts">
                <button className="link" onClick={() => setPack({ topicId: t.topicId, name: t.name })} aria-label={`Revision pack: ${t.name}`}>Pack</button>
                {t.lastReviewDate && <button className="link" onClick={() => setHistory(t.topicId)} aria-label={`History: ${t.name}`}>History</button>}
                {t.state === "RETAINED" && (
                  <button className="link" aria-pressed={t.maintenance} onClick={() => void api.setMaintenance(t.topicId, !t.maintenance).then(() => setN((x) => x + 1), (e) => setError(errText(e)))}>
                    {t.maintenance ? "Stop checks every 4 months" : "Check every 4 months"}
                  </button>
                )}
              </div>
            </li>
          ))}
          {h.needsMaterial.map((t) => (
            <li key={t.topicId} className="needs">
              <div><b>{t.name}</b> <span className="m">{t.district} · needs your material</span></div>
              <button className="btn" onClick={() => setPack({ topicId: t.topicId, name: t.name })} aria-label={`Prepare revision: ${t.name}`}>Prepare</button>
            </li>
          ))}
        </ul>
      )}

      {work && <Workspace start={work.start} sessionId={work.sessionId} onClose={closeWork} />}
      {pack && <PackDialog topicId={pack.topicId} topicName={pack.name} onClose={() => { setPack(null); setN((x) => x + 1); }} />}
      {history && <HistoryDialog topicId={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

const CELL = ["forgot", "struggled", "recalled", "strong"] as const;

/** Concepts × cycles (plan §3.6): tap a cell to see the questions, your answers, the AI's evaluation and the model answers. */
export function HistoryDialog({ topicId, onClose }: { topicId: string; onClose: () => void }) {
  const [h, setH] = useState<RevisionHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cell, setCell] = useState<{ title: string; cycle: number; answers: HistoryAnswer[] } | null>(null);
  useEffect(() => {
    api.revisionHistory(topicId).then(setH, (e) => setError(errText(e)));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [topicId, onClose]);
  return createPortal(
    <div className="overlay focus" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog pkd" role="dialog" aria-modal="true" aria-labelledby="hist-title">
        <button className="close" aria-label="Close" onClick={onClose}>×</button>
        <div className="kick">Revision history</div>
        <h2 id="hist-title">{h?.name ?? "…"}</h2>
        {error && <p className="af-err">{error}</p>}
        {h && (
          <>
            {h.track && <p className="sub">{h.track.state === "RETAINED" ? "Retained: all six cycles done." : `${plural(h.track.cycle, "cycle")} done${h.track.nextDueDate ? ` · next ${dayMonth(h.track.nextDueDate)}` : ""}.`}</p>}
            <div className="hist-wrap">
              <table className="hist">
                <thead><tr><th scope="col">Concept</th>{h.cycles.map((c) => <th key={c} scope="col">Cycle {c}</th>)}</tr></thead>
                <tbody>
                  {h.concepts.map((c) => (
                    <tr key={`${c.conceptId}-${c.title}`} className={c.removed ? "removed" : ""}>
                      <th scope="row">{c.title}</th>
                      {c.cells.map((x) => (
                        <td key={x.cycle}>
                          {x.result === null ? <span className="m">–</span> : (
                            <button className={`hist-cell ${CELL[x.result]}`} aria-label={`${c.title}, cycle ${x.cycle}: ${x.label}`} onClick={() => setCell({ title: c.title, cycle: x.cycle, answers: x.answers })}>
                              {x.label}{x.firstResult !== null && x.firstResult < x.result ? " ↑" : ""}
                            </button>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="hist-story">{h.concepts.map((c) => <li key={`${c.conceptId}-${c.title}`}>{c.story}</li>)}</ul>
            {cell && (
              <div className="hist-detail" role="region" aria-label={`${cell.title}, cycle ${cell.cycle}`}>
                <h3>{cell.title} · cycle {cell.cycle}</h3>
                {cell.answers.map((a) => (
                  <div key={a.id} className="pk-item">
                    <div className="pk-ikind">{dayMonth(a.date.slice(0, 10))} · {a.label}{a.relearn ? " · relearning" : ""}{a.hintsUsed ? ` · ${plural(a.hintsUsed, "hint")}` : ""}{a.confidence !== null ? ` · you felt: ${["not at all sure", "shaky", "fairly sure", "sure"][a.confidence]}` : ""}</div>
                    <p className="pk-q">{a.question}</p>
                    {a.code && <pre className="pk-code"><code>{a.code}</code></pre>}
                    {a.format === "OPEN" ? (a.evaluation ? <Highlighted text={a.answer} quotes={a.evaluation.criteria.map((x) => x.evidence ?? "")} /> : <p className="ws-yours">{a.answer}</p>) : <p className="m">{a.correct ? "Chose the right option." : "Chose a wrong option."}</p>}
                    {a.evaluation && <p className="m">{a.evaluation.feedback}</p>}
                    <p><b>Model answer:</b> {a.modelAnswer}</p>
                  </div>
                ))}
                {!cell.answers.length && <p className="m">The answers for this cell are no longer available.</p>}
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
