/**
 * Active recall dialog (Revision spec §6, §9; refinement §2.1/§2.3): three steps, Retrieve → Compare → Assess.
 * Used for scheduled revision (one unit or an interleaved session) and for checkpoints during initial learning.
 * The expected answer stays hidden until the learner moves past Retrieve; moving between steps keeps every input;
 * no score is preselected and Save stays disabled until one is chosen.
 *
 * AI design §4: when the AI check is on, the answer can be spoken (transcribed, then editable), the learner commits a
 * self-score before any feedback, and the AI's per-point assessment joins the Compare step. It only suggests: the
 * learner's chosen score is what is saved and scheduled.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, api } from "../api/client";
import type { AiEvaluation, AiStatus, CheckpointResult, Presentation, RetrievalMethod, RevisionScope, TopicRevision } from "../api/types";
import { CHECKPOINT_RESULTS, METHOD_LABEL, SCORES, SOURCE_LABEL, scoreLabel, shortDate } from "../lib/format";
import { useExit } from "../lib/motion";
import { useAppData } from "../state/AppData";
import { AiConsent, AiPanel } from "./AiPanel";
import { FeedbackMessage, LoadingState, StatusBadge, toneOf } from "./Status";
import { Loading } from "./ui";
import { Recorder, canRecord } from "./voice/Recorder";
import { canSpeak, speak, stopSpeaking } from "./voice/speak";

type Score = 0 | 1 | 2 | 3;

export interface RecallItem {
  topicId: string;
  scope: RevisionScope;
  subtopicId: number | null;
  mode: "revision" | "checkpoint";
}

type Step = "retrieve" | "compare" | "assess" | "done";
const STEPS: { id: Exclude<Step, "done">; label: string }[] = [
  { id: "retrieve", label: "Retrieve" },
  { id: "compare", label: "Compare" },
  { id: "assess", label: "Assess" },
];

export function RecallDialog({ items, onClose }: { items: RecallItem[]; onClose: () => void }) {
  const { mutate, topicById } = useAppData();
  const [index, setIndex] = useState(0);
  const [rev, setRev] = useState<TopicRevision | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("retrieve");
  const [choice, setChoice] = useState(0);
  const [method, setMethod] = useState<RetrievalMethod>("CONCEPTUAL");
  const [changing, setChanging] = useState(false);
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
  const [outcome, setOutcome] = useState<{ text: string; p?: Presentation } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [aiReload, setAiReload] = useState(0);
  const [selfScore, setSelfScore] = useState<Score | null>(null);
  const [evaluation, setEvaluation] = useState<AiEvaluation | null>(null);
  const [followUp, setFollowUp] = useState<AiEvaluation | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<"TYPED" | "SPOKEN">("TYPED");
  // Exit transition: the overlay stops taking input at once and unmounts when its short fade ends.
  const { leaving, close } = useExit(onClose);
  const box = useRef<HTMLDivElement>(null);
  const stepRef = useRef<HTMLDivElement>(null);

  const item = items[index];
  const dirty = response.trim() !== "" || mistakes.trim() !== "" || score !== null || result !== null;

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

  // AI status (§4.2). Any failure just leaves the AI controls hidden: the manual flow never depends on it.
  useEffect(() => {
    if (item.mode !== "revision") return;
    let live = true;
    Promise.resolve()
      .then(() => api.aiStatus())
      .then((st) => live && setAi(st), () => live && setAi(null));
    return () => {
      live = false;
    };
  }, [item.mode, aiReload]);
  useEffect(() => () => stopSpeaking(), []);

  // Focus once on open. Escape exits, but never discards typed work silently.
  const closeRef = useRef(close);
  closeRef.current = close;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !dirtyRef.current && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (step !== "retrieve") stepRef.current?.focus();
  }, [step]);

  const reset = () => {
    setStep("retrieve");
    setChanging(false);
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
    setSelfScore(null);
    setEvaluation(null);
    setFollowUp(null);
    setAiError(null);
    setInputMode("TYPED");
    stopSpeaking();
  };

  const unit = rev?.units.find((x) => x.scope === item.scope && x.subtopicId === item.subtopicId);
  const option = unit?.options[choice];
  const topicName = topicById.get(item.topicId)?.name ?? rev?.topicId ?? "";
  const isRevision = item.mode === "revision";
  const failed = isRevision ? score !== null && score <= 1 : result === "NOT_RECALLED";
  const pending = isRevision && unit?.schedule?.correctionPending;
  const pendingAttempt = pending ? rev?.attempts.find((a) => a.id === unit?.schedule?.pendingAttemptId) : undefined;
  const ref = option ? (option.promptId ? { promptId: option.promptId } : { templateKey: option.templateKey! }) : null;
  const assessed = isRevision ? score !== null : result !== null;
  const canSave = !busy && !!ref && assessed && (!isRevision || !failed || mistakes.trim().length > 0);
  const scheduleId = unit?.schedule?.id;
  const hasCriteria = !!option?.expectedAnswer.trim();
  const aiReady = isRevision && !!ai?.enabled && ai.consented && !!scheduleId && hasCriteria;
  const stale = !!evaluation && evaluation.transcript.trim() !== response.trim();

  const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "The AI check failed. Carry on without it.");

  const checkWithAi = async () => {
    if (!aiReady || !ref || !scheduleId || !response.trim()) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const e = await api.evaluate({ scheduleId, ...ref, transcript: response });
      setEvaluation(e);
      setFollowUp(null);
      if (!mistakes.trim() || mistakes === evaluation?.suggestedMistakes) setMistakes(e.suggestedMistakes);
      setStep("compare");
    } catch (e) {
      setAiError(errorText(e));
    } finally {
      setAiBusy(false);
    }
  };

  const answerFollowUp = async (answer: string) => {
    if (!evaluation || !scheduleId) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const e = await api.evaluate({ scheduleId, transcript: answer, parentId: evaluation.id });
      setFollowUp(e);
      if (e.assisted) setUsedHints(true);
      if (!mistakes.trim() || mistakes === evaluation.suggestedMistakes) setMistakes(e.suggestedMistakes);
    } catch (e) {
      setAiError(errorText(e));
    } finally {
      setAiBusy(false);
    }
  };

  const acceptAi = async () => {
    setAiBusy(true);
    const r = await mutate(() => api.aiConsent());
    setAiBusy(false);
    if (r) setAiReload((n) => n + 1);
  };

  const save = async () => {
    if (!unit || !ref || !canSave) return;
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
          evaluationId: evaluation && !stale ? evaluation.rootId : undefined,
          selfScore: selfScore ?? undefined,
          inputMode,
        }),
      );
      if (r) {
        setOutcome({
          p: r.attempt.presentation,
          text:
            r.correctionPending && !r.nextDueDate
              ? "Recorded. Go back to the material for the gap, then confirm the correction; the retry is scheduled for the next study day after that."
              : `Recorded as "${scoreLabel(score)}"${r.effectiveScore !== score ? " (counted as Recalled because hints or notes were used)" : ""}. ` +
                `Next revision due ${shortDate(r.nextDueDate!)}${r.nextTaskDate && r.nextTaskDate !== r.nextDueDate ? `, planned for ${shortDate(r.nextTaskDate)}` : ""}.` +
                (r.correctionPending ? " Confirm the correction before that attempt." : ""),
        });
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
        setOutcome({
          p: r.presentation,
          text:
            result === "RECALLED"
              ? "Checkpoint recorded. Mark the sub-topic as learned when you're confident; that stays your decision."
              : "Checkpoint recorded. Go back to the material for the gaps you noted, then try again.",
        });
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

  const exitLabel = items.length > 1 ? "Exit session" : "Close";
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const showSteps = !!unit && step !== "done" && !(isRevision && (!unit.eligible || pending));

  return createPortal(
    <div className={`overlay focus${leaving ? " leaving" : ""}`} role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="recall-title" tabIndex={-1} ref={box}>
        <button className="close" aria-label={exitLabel} title={dirty ? "Exit (your answer is discarded)" : exitLabel} onClick={close}>×</button>
        <div className="kick">
          {isRevision ? "Revision" : "Recall check"}
          {items.length > 1 && ` · ${index + 1} of ${items.length}`} · {topicName}
        </div>
        <h2 id="recall-title">{unit?.label ?? "…"}</h2>
        {(showSteps || (!unit && !loadError)) && (
          <ol className="rd-steps" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s.id} className={i === stepIndex ? "on" : i < stepIndex ? "past" : ""} aria-current={i === stepIndex ? "step" : undefined}>
                <span>{i < stepIndex ? "✓" : i + 1}</span>
                {s.label}
              </li>
            ))}
          </ol>
        )}

        {loadError ? (
          <div className="empty">{loadError}</div>
        ) : !rev || !unit ? (
          <Loading />
        ) : step === "done" ? (
          <>
            {outcome && (
              <FeedbackMessage tone={toneOf(outcome.p?.tone ?? "success")} icon={outcome.p?.icon}>
                {outcome.p && <p><StatusBadge p={outcome.p} /></p>}
                <p className="rd-note">{outcome.text}</p>
              </FeedbackMessage>
            )}
            <div className="rd-acts">
              {index + 1 < items.length ? (
                <button className="btn primary" onClick={next}>Next: {items.length - index - 1} left</button>
              ) : (
                <button className="btn primary" onClick={close}>Done</button>
              )}
              {index + 1 < items.length && <button className="btn" onClick={close}>Stop here</button>}
            </div>
          </>
        ) : isRevision && !unit.eligible ? (
          <>
            <p className="rd-note">
              {unit.scope === "TOPIC"
                ? "Topic-level revision starts once two sub-topics are learned (or the topic is demonstrated)."
                : "This sub-topic isn't marked as learned yet. Use a recall check while you study it; revision starts after you mark it learned."}
            </p>
            <div className="rd-acts"><button className="btn" onClick={close}>Close</button></div>
          </>
        ) : pending ? (
          <>
            <p className="rd-note">
              Your last attempt here needs a correction first. Go back to the material and fix the misunderstanding. Confirming it does not count as
              a successful recall: the next attempt does.
            </p>
            {pendingAttempt?.mistakes && <div className="rd-box"><b>What was missing</b><p>{pendingAttempt.mistakes}</p></div>}
            <div className="rd-acts">
              <button className="btn primary" disabled={busy} onClick={() => void confirmCorrection()}>I've corrected it</button>
              <button className="btn" onClick={close}>Later</button>
            </div>
          </>
        ) : step === "retrieve" ? (
          <div className="rd-step">
            <div className="rd-meta">
              <span>{METHOD_LABEL[method]} · {option?.title} ({option ? SOURCE_LABEL[option.source] : ""})</span>
              <button className="link" aria-expanded={changing} onClick={() => setChanging((x) => !x)}>{changing ? "Keep this question" : "Change question"}</button>
            </div>
            {changing && (
              <div className="rd-row">
                <label>
                  Prompt
                  <select className="inp" value={choice} onChange={(e) => {
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
                  <select className="inp" value={method} onChange={(e) => setMethod(e.target.value as RetrievalMethod)}>
                    {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              </div>
            )}
            <p className="rd-q">
              {option?.content}
              {isRevision && canSpeak() && option && (
                <button className="link rv-say" onClick={() => speak(option.content)} aria-label="Read the question aloud">Read aloud</button>
              )}
            </p>
            {isRevision && ai?.enabled && !ai.consented && <AiConsent status={ai} busy={aiBusy} onAccept={() => void acceptAi()} />}
            {aiReady && canRecord() && (
              <Recorder
                scheduleId={scheduleId!}
                maxSeconds={ai!.maxRecordingSeconds}
                maxBytes={ai!.maxAudioBytes}
                onTranscript={(t) => {
                  setResponse((r) => (r.trim() ? `${r.trimEnd()}\n${t}` : t));
                  setInputMode("SPOKEN");
                }}
              />
            )}
            <label className="rd-field">
              {inputMode === "SPOKEN" ? "Your answer (transcript: fix any misheard terms before checking)" : <>Your answer, from memory {method === "VISUAL" ? "(describe what you drew, or the key relationships)" : method === "PRACTICAL" ? "(paste the code or describe what you built)" : "(key points are enough)"}</>}
              <textarea className="inp" value={response} maxLength={5000} onChange={(e) => setResponse(e.target.value)} rows={6} autoFocus />
            </label>
            {aiReady && response.trim() ? (
              <>
                <fieldset className="rv-self">
                  <legend>Before you see the expected answer: how well do you think you did?</legend>
                  {SCORES.map((sc) => (
                    <label key={sc.score} className={selfScore === sc.score ? "on" : ""}>
                      <input type="radio" name="self-score" checked={selfScore === sc.score} onChange={() => setSelfScore(sc.score)} />
                      {sc.score} · {sc.label}
                    </label>
                  ))}
                </fieldset>
                {aiError && <FeedbackMessage tone="danger">{aiError}</FeedbackMessage>}
                {aiBusy && (
                  <div className="rv-loading">
                    <LoadingState tone="ai" text="Checking your answer against the expected points…" />
                    <div className="rv-skel" aria-hidden="true"><i /><i /><i /></div>
                  </div>
                )}
                <div className="rd-acts">
                  <button className="btn primary" aria-busy={aiBusy} disabled={aiBusy || selfScore === null} onClick={() => void checkWithAi()}>
                    {aiBusy ? "Checking…" : "Check with AI"}
                  </button>
                  <button className="btn" onClick={() => setStep("compare")}>Continue without AI</button>
                  <button className="btn" onClick={close}>{exitLabel}</button>
                  {selfScore === null && <span className="rd-hint" style={{ margin: 0 }}>Choose your own score first.</span>}
                </div>
              </>
            ) : (
              <>
                <p className="rd-hint">Close your notes and answer first. The expected answer appears in the next step.</p>
                <div className="rd-acts">
                  <button className="btn primary" onClick={() => setStep("compare")}>Continue to comparison</button>
                  <button className="btn" onClick={close}>{exitLabel}</button>
                </div>
              </>
            )}
          </div>
        ) : step === "compare" ? (
          <div className="rd-step" ref={stepRef} tabIndex={-1}>
            <div className="rd-compare">
              <div className="rd-box">
                <b>Your answer</b>
                <p className={response.trim() ? "rd-answer" : "m"}>{response.trim() || "No written answer (answered aloud or on paper)."}</p>
              </div>
              <div className="rd-box">
                <b>What a full answer covers</b>
                <p>{option?.expectedAnswer}</p>
              </div>
            </div>
            {evaluation && ai && scheduleId && !stale && (
              <AiPanel evaluation={evaluation} followUp={followUp} status={ai} scheduleId={scheduleId} busy={aiBusy} error={aiError} onFollowUp={(a) => void answerFollowUp(a)} />
            )}
            {evaluation && stale && (
              <div className="rv-ai-note">
                Your answer changed after the AI check, so it no longer applies.{" "}
                <button className="link" disabled={aiBusy} onClick={() => void checkWithAi()}>{aiBusy ? "Checking…" : "Check again"}</button>
              </div>
            )}
            <label className="rd-field">
              What's missing, wrong or incomplete?
              <textarea className="inp" value={mistakes} maxLength={2000} onChange={(e) => setMistakes(e.target.value)} rows={3} />
            </label>
            <div className="rd-acts">
              <button className="btn primary" onClick={() => setStep("assess")}>Continue to assessment</button>
              <button className="btn" onClick={() => setStep("retrieve")}>Back</button>
            </div>
          </div>
        ) : (
          <div className="rd-step" ref={stepRef} tabIndex={-1}>
            {isRevision && (selfScore !== null || (evaluation && !stale)) && (
              <p className="rv-cmp">
                {selfScore !== null && <>Your first guess: <b>{selfScore} · {scoreLabel(selfScore)}</b></>}
                {selfScore !== null && evaluation && !stale && " · "}
                {evaluation && !stale && evaluation.suggestedScore !== null && <>AI suggestion: <b>{evaluation.suggestedScore} · {scoreLabel(evaluation.suggestedScore)}</b></>}
              </p>
            )}
            <fieldset className="rd-scale">
              <legend>{isRevision ? "How well did you retrieve it? Choose one." : "How did it go? Choose one."}</legend>
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
              {failed ? "What was missing or wrong?" : "Mistakes or gaps (optional)"}
              {isRevision && failed && <span className="req"> required for a score of 0 or 1</span>}
              <textarea className="inp" value={mistakes} maxLength={2000} onChange={(e) => setMistakes(e.target.value)} rows={2} />
            </label>
            {isRevision && failed && (
              <label className="rd-checks">
                <span>
                  <input type="checkbox" checked={corrected} onChange={(e) => setCorrected(e.target.checked)} /> I've gone back to the material and corrected
                  my understanding (this is not a successful recall; the next attempt is)
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
              <button className="btn primary" aria-busy={busy} disabled={!canSave} onClick={() => void save()}>Save {isRevision ? "attempt" : "checkpoint"}</button>
              <button className="btn" onClick={() => setStep("compare")}>Back</button>
              {!assessed && <span className="rd-hint" style={{ margin: 0 }}>Choose a {isRevision ? "score" : "result"} to save.</span>}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
