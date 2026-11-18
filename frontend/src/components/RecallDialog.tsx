/**
 * Active recall dialog (Revision spec §6, §9): prompt → retrieve from memory → reveal → assess → correct.
 * Used for scheduled revision (one unit or an interleaved session) and for checkpoints during initial learning.
 * The expected answer is hidden until the learner reveals it.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import type { CheckpointResult, RetrievalMethod, RevisionScope, TopicRevision } from "../api/types";
import { CHECKPOINT_RESULTS, METHOD_LABEL, SCORES, SOURCE_LABEL, scoreLabel, shortDate } from "../lib/format";
import { useAppData } from "../state/AppData";
import { Loading } from "./ui";

export interface RecallItem {
  topicId: string;
  scope: RevisionScope;
  subtopicId: number | null;
  mode: "revision" | "checkpoint";
}

type Step = "prompt" | "check" | "done";

export function RecallDialog({ items, onClose }: { items: RecallItem[]; onClose: () => void }) {
  const { mutate, topicById } = useAppData();
  const [index, setIndex] = useState(0);
  const [rev, setRev] = useState<TopicRevision | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("prompt");
  const [choice, setChoice] = useState(0);
  const [method, setMethod] = useState<RetrievalMethod>("CONCEPTUAL");
  const [response, setResponse] = useState("");
  const [score, setScore] = useState<0 | 1 | 2 | 3 | null>(null);
  const [result, setResult] = useState<CheckpointResult | null>(null);
  const [usedHints, setUsedHints] = useState(false);
  const [usedNotes, setUsedNotes] = useState(false);
  const [assisted, setAssisted] = useState(false);
  const [mistakes, setMistakes] = useState("");
  const [corrected, setCorrected] = useState(false);
  const [duration, setDuration] = useState("");
  const [comment, setComment] = useState("");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const item = items[index];

  useEffect(() => {
    let live = true;
    setRev(null);
    api.topicRevision(item.topicId).then(
      (r) => {
        if (!live) return;
        setRev(r);
        setLoadError(null);
        const u = r.units.find((x) => x.scope === item.scope && x.subtopicId === item.subtopicId);
        if (!u) return;
        const explain = u.options.findIndex((o) => o.templateKey === "explain");
        const pick = item.mode === "checkpoint" && explain >= 0 ? explain : u.suggested;
        setChoice(pick);
        setMethod(u.options[pick]?.retrievalMethod ?? "CONCEPTUAL");
      },
      (e) => live && setLoadError(e.message),
    );
    return () => {
      live = false;
    };
  }, [item.topicId, item.scope, item.subtopicId, item.mode, reload]);

  // Focus once on open; a parent re-render (new onClose identity) must not steal focus from the textarea.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const reset = () => {
    setStep("prompt");
    setResponse("");
    setScore(null);
    setResult(null);
    setUsedHints(false);
    setUsedNotes(false);
    setAssisted(false);
    setMistakes("");
    setCorrected(false);
    setDuration("");
    setComment("");
    setOutcome(null);
  };

  const unit = rev?.units.find((x) => x.scope === item.scope && x.subtopicId === item.subtopicId);
  const option = unit?.options[choice];
  const topicName = topicById.get(item.topicId)?.name ?? rev?.topicId ?? "";
  const isRevision = item.mode === "revision";
  const failed = isRevision ? score !== null && score <= 1 : result === "NOT_RECALLED";
  const pending = isRevision && unit?.schedule?.correctionPending;
  const pendingAttempt = pending ? rev?.attempts.find((a) => a.id === unit?.schedule?.pendingAttemptId) : undefined;
  const ref = option ? (option.promptId ? { promptId: option.promptId } : { templateKey: option.templateKey! }) : null;

  const save = async () => {
    if (!unit || !ref) return;
    setBusy(true);
    if (isRevision && score !== null) {
      const minutes = Number(duration);
      const r = await mutate(() =>
        api.submitAttempt({
          topicId: item.topicId,
          subtopicId: item.subtopicId ?? undefined,
          ...ref,
          retrievalMethod: method,
          score,
          usedHints,
          usedNotes,
          correctionCompleted: failed && corrected,
          durationMinutes: minutes > 0 ? Math.round(minutes) : undefined,
          response: response || undefined,
          mistakes: mistakes.trim() || undefined,
          comment: comment.trim() || undefined,
        }),
      );
      if (r) {
        setOutcome(
          r.correctionPending && !r.nextDueDate
            ? "Recorded. Correct the gap (re-read the material, then confirm it in the topic panel) and the next attempt is scheduled for the following study day."
            : `Recorded as "${scoreLabel(score)}"${r.effectiveScore !== score ? " (counted as Recalled because hints or notes were used)" : ""}. ` +
                `Next revision due ${shortDate(r.nextDueDate!)}${r.nextTaskDate && r.nextTaskDate !== r.nextDueDate ? `, planned for ${shortDate(r.nextTaskDate)}` : ""}.` +
                (r.correctionPending ? " Confirm the correction before that attempt." : ""),
        );
        setStep("done");
      }
    } else if (!isRevision && result && item.subtopicId) {
      const r = await mutate(() =>
        api.createCheckpoint({
          topicId: item.topicId, subtopicId: item.subtopicId!, ...ref, result, neededAssistance: assisted,
          gaps: mistakes.trim() || undefined, response: response || undefined,
        }),
      );
      if (r) {
        setOutcome(
          result === "RECALLED"
            ? "Checkpoint recorded. Mark the sub-topic as learned when you're confident; that stays your decision."
            : "Checkpoint recorded. Go back to the material for the gaps you noted, then try again.",
        );
        setStep("done");
      }
    }
    setBusy(false);
  };

  const confirmCorrection = async () => {
    if (!unit?.schedule?.pendingAttemptId) return;
    setBusy(true);
    const r = await mutate(() => api.correctAttempt(unit.schedule!.pendingAttemptId!));
    setBusy(false);
    if (r) setReload((n) => n + 1);
  };

  const next = () => {
    reset();
    setIndex((i) => i + 1);
  };

  const canSave =
    !busy && !!ref && (isRevision ? score !== null : result !== null) && (!failed || !isRevision || mistakes.trim().length > 0);

  return createPortal(
    <div className="overlay" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="recall-title" tabIndex={-1} ref={box}>
        <button className="close" aria-label="Close" onClick={onClose}>×</button>
        <div className="kick">
          {isRevision ? "Revision" : "Recall check"}
          {items.length > 1 && ` · ${index + 1} of ${items.length}`} · {topicName}
        </div>
        <h2 id="recall-title">{unit?.label ?? "…"}</h2>

        {loadError ? (
          <div className="empty">{loadError}</div>
        ) : !rev || !unit ? (
          <Loading />
        ) : step === "done" ? (
          <>
            <p className="rd-note">{outcome}</p>
            <div className="rd-acts">
              {index + 1 < items.length ? (
                <button className="btn primary" onClick={next}>Next: {items.length - index - 1} left</button>
              ) : (
                <button className="btn primary" onClick={onClose}>Done</button>
              )}
              {index + 1 < items.length && <button className="btn" onClick={onClose}>Stop here</button>}
            </div>
          </>
        ) : isRevision && !unit.eligible ? (
          <>
            <p className="rd-note">
              {unit.scope === "TOPIC"
                ? "Topic-level revision starts once two sub-topics are learned (or the topic is demonstrated)."
                : "This sub-topic isn't marked as learned yet. Use a recall check while you study it; revision starts after you mark it learned."}
            </p>
            <div className="rd-acts"><button className="btn" onClick={onClose}>Close</button></div>
          </>
        ) : pending ? (
          <>
            <p className="rd-note">
              Your last attempt here needs a correction first. Go back to the material, fix the misunderstanding, then confirm.
            </p>
            {pendingAttempt?.mistakes && <div className="rd-box"><b>What was missing</b><p>{pendingAttempt.mistakes}</p></div>}
            <div className="rd-acts">
              <button className="btn primary" disabled={busy} onClick={() => void confirmCorrection()}>I've corrected it</button>
              <button className="btn" onClick={onClose}>Later</button>
            </div>
          </>
        ) : (
          <>
            <div className="rd-row">
              <label>
                Prompt
                <select className="inp" value={choice} disabled={step !== "prompt"} onChange={(e) => {
                  const i = Number(e.target.value);
                  setChoice(i);
                  setMethod(unit.options[i].retrievalMethod);
                }}>
                  {unit.options.map((o, i) =>
                    o.isActive ? (
                      <option key={i} value={i}>
                        {o.title} · {SOURCE_LABEL[o.source]}{o.uses ? ` · used ${o.uses}×` : ""}
                      </option>
                    ) : null,
                  )}
                </select>
              </label>
              <label>
                Method
                <select className="inp" value={method} disabled={step !== "prompt"} onChange={(e) => setMethod(e.target.value as RetrievalMethod)}>
                  {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            </div>
            <p className="rd-q">{option?.content}</p>
            <label className="rd-field">
              Your answer, from memory {method === "VISUAL" ? "(describe what you drew, or the key relationships)" : method === "PRACTICAL" ? "(paste the code or describe what you built)" : "(optional: key points are enough)"}
              <textarea className="inp" value={response} maxLength={5000} readOnly={step !== "prompt"} onChange={(e) => setResponse(e.target.value)} rows={5} />
            </label>

            {step === "prompt" ? (
              <>
                <p className="rd-hint">Close the notes and answer first. The expected answer stays hidden until you reveal it.</p>
                <div className="rd-acts">
                  <button className="btn primary" onClick={() => setStep("check")}>Reveal the expected answer</button>
                  <button className="btn" onClick={onClose}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div className="rd-box">
                  <b>What a full answer covers</b>
                  <p>{option?.expectedAnswer}</p>
                </div>
                <fieldset className="rd-scale">
                  <legend>{isRevision ? "How well did you retrieve it?" : "How did it go?"}</legend>
                  {isRevision
                    ? SCORES.map((s) => (
                        <label key={s.score} className={score === s.score ? "on" : ""}>
                          <input type="radio" name="score" checked={score === s.score} onChange={() => setScore(s.score)} />
                          <span><b>{s.score} · {s.label}</b><small>{s.help}</small></span>
                        </label>
                      ))
                    : CHECKPOINT_RESULTS.map((c) => (
                        <label key={c.result} className={result === c.result ? "on" : ""}>
                          <input type="radio" name="result" checked={result === c.result} onChange={() => setResult(c.result)} />
                          <span><b>{c.label}</b></span>
                        </label>
                      ))}
                </fieldset>
                <div className="rd-checks">
                  {isRevision ? (
                    <>
                      <label><input type="checkbox" checked={usedHints} onChange={(e) => setUsedHints(e.target.checked)} /> I used hints</label>
                      <label><input type="checkbox" checked={usedNotes} onChange={(e) => setUsedNotes(e.target.checked)} /> I looked at notes or docs</label>
                    </>
                  ) : (
                    <label><input type="checkbox" checked={assisted} onChange={(e) => setAssisted(e.target.checked)} /> I needed help or the material</label>
                  )}
                </div>
                <label className="rd-field">
                  {failed || (!isRevision && result === "PARTIAL") ? "What was missing or wrong?" : "Mistakes or gaps (optional)"}
                  {isRevision && failed && <span className="req"> required</span>}
                  <textarea className="inp" value={mistakes} maxLength={2000} onChange={(e) => setMistakes(e.target.value)} rows={2} />
                </label>
                {isRevision && failed && (
                  <label className="rd-checks">
                    <span>
                      <input type="checkbox" checked={corrected} onChange={(e) => setCorrected(e.target.checked)} /> I've gone back to the material and
                      corrected my understanding
                    </span>
                  </label>
                )}
                {isRevision && (
                  <div className="rd-row">
                    <label>
                      Minutes spent (optional)
                      <input className="inp" type="number" min={1} max={720} value={duration} onChange={(e) => setDuration(e.target.value)} style={{ width: 110 }} />
                    </label>
                    <label className="grow">
                      Comment (optional)
                      <input className="inp" value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
                    </label>
                  </div>
                )}
                <div className="rd-acts">
                  <button className="btn primary" disabled={!canSave} onClick={() => void save()}>Save {isRevision ? "attempt" : "checkpoint"}</button>
                  <button className="btn" onClick={onClose}>Cancel</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
