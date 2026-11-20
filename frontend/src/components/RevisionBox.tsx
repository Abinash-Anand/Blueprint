/** Revision status for one topic inside the topic panel (Revision spec §14.1). */
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { RetrievalMethod, RevisionUnit, TopicRevision } from "../api/types";
import { CHECKPOINT_RESULTS, METHOD_LABEL, SOURCE_LABEL, dayMonth, scoreLabel } from "../lib/format";
import { useAppData } from "../state/AppData";
import { type RecallItem, RecallDialog } from "./RecallDialog";
import { PackDialog } from "./revision/PackDialog";
import { StatusBadge, StatusIndicator } from "./Status";

/** Status line of one unit: the shared revision status, plus the last attempt (date and score). */
function UnitStatus({ u }: { u: RevisionUnit }) {
  const s = u.schedule;
  if (!s || (!u.eligible && s.status !== "SUSPENDED")) {
    return <StatusIndicator fallback={u.scope === "TOPIC" ? "Starts after two sub-topics are learned" : "Not learned yet"} />;
  }
  const planned = s.openTask && s.nextDueDate && s.openTask.scheduledDate !== s.nextDueDate ? `planned ${dayMonth(s.openTask.scheduledDate)}` : "";
  const last = s.lastAttemptDate ? `last ${dayMonth(s.lastAttemptDate)}: ${scoreLabel(s.lastScore)}` : "";
  return (
    <StatusIndicator p={s.presentation} fallback={s.status.toLowerCase()} detail={[planned, last].filter(Boolean).join(" · ") || undefined} />
  );
}

export function RevisionBox({ topicId, topicName }: { topicId: string; topicName: string }) {
  const { version, mutate, reload } = useAppData();
  const [pack, setPack] = useState(false);
  const [rev, setRev] = useState<TopicRevision | null>(null);
  const [recall, setRecall] = useState<RecallItem[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);
  const [draft, setDraft] = useState<{ unit: string; content: string; expected: string; method: RetrievalMethod } | null>(null);

  useEffect(() => {
    let live = true;
    api.topicRevision(topicId).then((r) => live && setRev(r), () => live && setRev(null));
    return () => {
      live = false;
    };
  }, [topicId, version]);

  if (!rev) return null;
  const learnedAny = rev.units.some((u) => u.eligible);
  const open = (u: RevisionUnit, mode: RecallItem["mode"]) => setRecall([{ topicId, scope: u.scope, subtopicId: u.subtopicId, mode }]);
  const unitById = new Map(rev.units.map((u) => [u.unit, u]));

  const addPrompt = async () => {
    if (!draft) return;
    const u = unitById.get(draft.unit)!;
    const r = await mutate(() =>
      api.createPrompt({ topicId, subtopicId: u.subtopicId ?? undefined, content: draft.content.trim(), expectedAnswer: draft.expected.trim(), retrievalMethod: draft.method }),
    );
    if (r) setDraft(null);
  };

  return (
    <div className="pbox revbox">
      <b>Recall and revision</b>
      <p style={{ fontSize: 12.5, color: "var(--muted)" }}>
        Answer from memory, then check. Revision never ticks a sub-topic, marks a demonstration or moves the car.
      </p>
      <ul className="rlist">
        {rev.units.map((u) => {
          const s = u.schedule;
          return (
            <li key={u.unit} className={u.scope === "TOPIC" ? "whole" : ""}>
              <div className="rl-main">
                <span className="rl-name">{u.scope === "TOPIC" ? "Whole topic" : u.label}</span>
                <UnitStatus u={u} />
              </div>
              <div className="rl-acts">
                {u.scope === "SUBTOPIC" && (
                  <button className="btn" onClick={() => open(u, "checkpoint")} aria-label={`Recall check: ${u.label}`}>Check</button>
                )}
                {u.eligible && s?.correctionPending && s.pendingAttemptId ? (
                  <button className="btn" onClick={() => void mutate(() => api.correctAttempt(s.pendingAttemptId!))} aria-label={`Confirm correction: ${u.label}`}>
                    Corrected
                  </button>
                ) : u.eligible && s?.lastAttemptDate !== rev.today ? (
                  <button className="btn primary" onClick={() => setPack(true)} aria-label={`Revise: ${u.label}`}>Revise</button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {!learnedAny && <p style={{ fontSize: 12.5, color: "var(--muted)" }}>Use “Check” while studying. Scheduled revision starts the day after you mark a sub-topic learned.</p>}

      <div className="tags" style={{ marginTop: 10 }}>
        <button className="btn" aria-expanded={showHistory} onClick={() => setShowHistory((x) => !x)}>
          History ({rev.attempts.length + rev.checkpoints.length})
        </button>
        <button className="btn" aria-expanded={showQuestions} onClick={() => setShowQuestions((x) => !x)}>
          Questions ({rev.prompts.length})
        </button>
      </div>

      {showHistory && (
        <ul className="rhist">
          {rev.attempts.length + rev.checkpoints.length === 0 && <li className="m">No attempts yet.</li>}
          {rev.attempts.map((a) => (
            <li key={`a${a.id}`}>
              <div>
                <b>{dayMonth(a.attemptDate)}</b> · {a.label} · <StatusBadge p={a.presentation} fallback={`${a.score} ${scoreLabel(a.score)}`} />
                <span className="m"> · {METHOD_LABEL[a.retrievalMethod]}{a.usedHints || a.usedNotes ? " · with help" : ""}</span>
              </div>
              {a.mistakes && <div className="m">Gap: {a.mistakes}{a.score <= 1 ? (a.correctionCompleted ? " · corrected" : " · not corrected yet") : ""}</div>}
            </li>
          ))}
          {rev.checkpoints.map((c) => (
            <li key={`c${c.id}`}>
              <div>
                <b>{dayMonth(c.date)}</b> · {c.label} · check: {CHECKPOINT_RESULTS.find((x) => x.result === c.result)?.label}
              </div>
              {c.gaps && <div className="m">Gap: {c.gaps}</div>}
            </li>
          ))}
        </ul>
      )}

      {showQuestions && (
        <div className="rq">
          <ul className="rhist">
            {rev.prompts.map((p) => (
              <li key={p.id}>
                <div className={p.isActive ? "" : "m"}>
                  {p.content}
                  <span className="m"> · {SOURCE_LABEL[p.source]} · {METHOD_LABEL[p.retrievalMethod]}{p.subtopicId ? ` · ${rev.units.find((u) => u.subtopicId === p.subtopicId)?.label ?? ""}` : " · whole topic"}</span>
                </div>
                <div className="rl-acts" style={{ marginTop: 4 }}>
                  <button className="btn" onClick={() => void mutate(() => api.patchPrompt(p.id, { isActive: !p.isActive }))}>{p.isActive ? "Switch off" : "Switch on"}</button>
                  {p.source === "LEARNER" && <button className="btn" onClick={() => void mutate(() => api.deletePrompt(p.id))}>Delete</button>}
                </div>
              </li>
            ))}
          </ul>
          {draft ? (
            <div className="form">
              <label className="grow">
                For
                <select className="inp" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>
                  {rev.units.map((u) => <option key={u.unit} value={u.unit}>{u.scope === "TOPIC" ? "Whole topic" : u.label}</option>)}
                </select>
              </label>
              <label style={{ flexBasis: "100%" }}>
                Question
                <textarea className="inp" value={draft.content} maxLength={2000} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
              </label>
              <label style={{ flexBasis: "100%" }}>
                Expected answer or criteria
                <textarea className="inp" value={draft.expected} maxLength={4000} onChange={(e) => setDraft({ ...draft, expected: e.target.value })} />
              </label>
              <label>
                Method
                <select className="inp" value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value as RetrievalMethod })}>
                  {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <button className="btn primary" disabled={draft.content.trim().length < 5 || !draft.expected.trim()} onClick={() => void addPrompt()}>Save question</button>
              <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
            </div>
          ) : (
            <button className="btn" style={{ marginTop: 8 }} onClick={() => setDraft({ unit: rev.units[1]?.unit ?? rev.units[0].unit, content: "", expected: "", method: "CONCEPTUAL" })}>
              Write your own question
            </button>
          )}
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>A few good questions beat many: aim at important ideas and the mistakes you actually make.</p>
        </div>
      )}

      {recall && <RecallDialog items={recall} onClose={() => setRecall(null)} />}
      {pack && <PackDialog topicId={topicId} topicName={topicName} onClose={() => { setPack(false); void reload(); }} />}
    </div>
  );
}
