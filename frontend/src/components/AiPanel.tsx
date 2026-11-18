/**
 * AI feedback in the Compare step (AI design §4.2, §4.4): each expected point with its verdict and the learner's own
 * words that support it, the suggested score, short feedback and at most one follow-up question. The learner still
 * chooses the score in the Assess step; nothing here saves anything.
 */
import { useState } from "react";
import type { AiEvaluation, AiStatus, Verdict } from "../api/types";
import { scoreLabel } from "../lib/format";
import { Recorder, canRecord } from "./voice/Recorder";
import { canSpeak, speak } from "./voice/speak";

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  COVERED: { label: "Covered", cls: "ok" },
  PARTIAL: { label: "Partly", cls: "part" },
  MISSING: { label: "Missing", cls: "miss" },
  INCORRECT: { label: "Incorrect", cls: "bad" },
};

export function AiConsent({ status, onAccept, busy }: { status: AiStatus; onAccept: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const free = status.evaluationProvider === "gemini" || status.transcriptionProvider === "gemini";
  return (
    <div className="rv-ai-note">
      <b>AI check available.</b> It compares your answer with the expected points and suggests what you missed.{" "}
      <button className="link" aria-expanded={open} onClick={() => setOpen((x) => !x)}>{open ? "Hide notice" : "Read the notice"}</button>
      {open && (
        <div className="rv-notice">
          <p>
            When you use it, the question, its expected points and your answer (or your voice recording, for transcription) are sent to{" "}
            {[status.transcriptionProvider, status.evaluationProvider].filter((p, i, a) => a.indexOf(p) === i).map(providerName).join(" and ")}.
            Nothing else is sent: no notes, no history, no other topics, nothing that identifies you. Recordings are never stored by Blueprint.
          </p>
          {free && (
            <p>
              <b>Free tier:</b> Google may keep what you send, use it to improve its products, and people at Google may read it. Deleting data in
              Blueprint cannot delete what the provider has already received.
            </p>
          )}
          <p>The AI only suggests. You choose the score, and it never changes what you have learned or demonstrated.</p>
          <button className="btn primary" disabled={busy} onClick={onAccept}>Accept and use the AI check</button>
        </div>
      )}
    </div>
  );
}

const providerName = (p: string) => (p === "gemini" ? "Google (Gemini)" : p === "anthropic" ? "Anthropic (Claude)" : "a local test provider");

export function AiPanel({
  evaluation,
  followUp,
  status,
  scheduleId,
  busy,
  error,
  onFollowUp,
}: {
  evaluation: AiEvaluation;
  followUp: AiEvaluation | null;
  status: AiStatus;
  scheduleId: number;
  busy: boolean;
  error: string | null;
  onFollowUp: (answer: string) => void;
}) {
  const [answer, setAnswer] = useState("");
  const shown = followUp ?? evaluation;
  const question = followUp ? null : evaluation.followUpQuestion;
  return (
    <section className="rv-ai" aria-label="AI check">
      <div className="rv-ai-head">
        <b>AI check</b>
        <span>
          Suggests <strong>{evaluation.suggestedScore} · {scoreLabel(evaluation.suggestedScore ?? 0)}</strong>
          {shown.assisted && " · a point came back only after the follow-up (counts as a hint)"}
        </span>
      </div>
      <ul className="rv-crit">
        {shown.criteria.map((c) => (
          <li key={c.index}>
            <span className={`rv-v ${VERDICT[c.verdict].cls}`}>{VERDICT[c.verdict].label}</span>
            <span>
              {c.text}
              {c.evidence && <q>{c.evidence}</q>}
              {c.recoveredInFollowUp && <em> after the follow-up</em>}
            </span>
          </li>
        ))}
      </ul>
      {shown.misconceptions.length > 0 && (
        <ul className="rv-mis">
          {shown.misconceptions.map((m, i) => (
            <li key={i}>
              <q>{m.claim}</q> {m.correction}
            </li>
          ))}
        </ul>
      )}
      {shown.feedback && (
        <p className="rv-fb">
          {shown.feedback}{" "}
          {canSpeak() && <button className="link" onClick={() => speak(shown.feedback)} aria-label="Read the feedback aloud">Read aloud</button>}
        </p>
      )}
      {question && (
        <div className="rv-fu">
          <p>
            <b>Follow-up:</b> {question}{" "}
            {canSpeak() && <button className="link" onClick={() => speak(question)} aria-label="Read the follow-up question aloud">Read aloud</button>}
          </p>
          {canRecord() && <Recorder scheduleId={scheduleId} maxSeconds={Math.min(60, status.maxRecordingSeconds)} maxBytes={status.maxAudioBytes} label="Answer by voice" onTranscript={(t) => setAnswer((a) => (a ? `${a} ${t}` : t))} />}
          <textarea className="inp" aria-label="Your follow-up answer" value={answer} maxLength={2000} rows={2} onChange={(e) => setAnswer(e.target.value)} />
          <div className="rd-acts" style={{ marginTop: 6 }}>
            <button className="btn" disabled={busy || !answer.trim()} onClick={() => onFollowUp(answer.trim())}>{busy ? "Checking…" : "Check follow-up answer"}</button>
          </div>
        </div>
      )}
      {error && <p className="rv-err" role="alert">{error}</p>}
      <p className="rd-hint">A suggestion, not a verdict: you choose the score next.</p>
    </section>
  );
}
