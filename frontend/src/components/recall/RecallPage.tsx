/**
 * One recall (docs/Recall-Plan.md §3.2–§3.3) in glass (DESIGN.md §10): a focused page of its own (#/recall/<id>, so
 * Back and reload work) over the city, with a floating step bar. 1 · Recall: the learner says, types or sketches everything they remember. 2 · Check, then Results: the
 * AI's check against the hidden checklist, worked out in code. 3 · Follow-up: a senior engineer asks about the gaps
 * (never changes the score). Then the verdict. The learner never grades themselves; the checklist appears only with
 * the results.
 */
import { type CSSProperties, type ClipboardEvent, type DragEvent, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../api/client";
import type { AiStatus, RecallPointView, RecallReview } from "../../api/types";
import { dayMonth, plural } from "../../lib/format";
import { Recorder, canRecord } from "../voice/Recorder";
import { ResultScreens } from "./Comparison";
import { Back, Chevron, ChevronDown, Glyph, Person, Picture, Plus, Target } from "./icons";

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");
const DEPTH = { FOUNDATIONAL: "Foundational", INTERMEDIATE: "Intermediate", MASTERY: "Mastery" } as const;
const STATUS = { ACCURATE: "Remembered", PARTIAL: "Partly", MISSED: "Missed" } as const;
const GLYPH = { ACCURATE: "ok", PARTIAL: "part", MISSED: "miss" } as const;
export const OUTCOME = { PASS: "Remembered well", HOLD: "Partly remembered", LAPSE: "Mostly forgotten" } as const;
// Remembered first in the summary bar, then partly, then missed.
const RANK = { ACCURATE: 0, PARTIAL: 1, MISSED: 2 } as const;
// Said by the result, not the stage numbers: a first recall that lapses still moves from stage 0 to 1.
const MOVE = { PASS: "the gap grows", HOLD: "the same gap again", LAPSE: "back to a short gap" } as const;

type Run = (f: () => Promise<RecallReview>) => Promise<boolean>;
type Stage = "results" | "followup";

export function RecallPage({ subtopicId, backLabel = "Revision", onClose }: { subtopicId: number; backLabel?: string; onClose: () => void }) {
  const [r, setR] = useState<RecallReview | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>("results");
  const [showResults, setShowResults] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const stageSet = useRef(false);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    return () => before?.focus?.();
  }, []);

  useEffect(() => {
    let live = true;
    api.startRecall(subtopicId).then((x) => live && setR(x), (e) => live && setError(errText(e)));
    api.aiStatus().then((x) => live && setAi(x), () => undefined);
    return () => {
      live = false;
    };
  }, [subtopicId]);

  // Coming back to an answered follow-up opens it where it was left.
  useEffect(() => {
    if (!r || stageSet.current) return;
    stageSet.current = true;
    if (r.status === "CHECKED" && r.followupAnswer) setStage("followup");
  }, [r]);

  // While the check runs, follow it.
  useEffect(() => {
    if (r?.status !== "WAITING") return;
    const t = setTimeout(() => void api.recallReview(r.id).then(setR, () => undefined), 1500);
    return () => clearTimeout(t);
  }, [r]);

  const run: Run = async (f) => {
    setBusy(true);
    setError(null);
    try {
      setR(await f());
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const postpone = async () => {
    try {
      await api.postponeRecall(subtopicId);
      onClose();
    } catch (e) {
      setError(errText(e));
    }
  };

  const view = !r ? "loading" : r.status === "DRAFT" ? "draft" : r.status === "WAITING" ? "waiting"
    : r.status === "COMPLETE" ? (showResults ? "results" : "verdict") : stage;
  const step = { loading: [1, "Recall"], draft: [1, "Recall"], waiting: [2, "Check"], results: [2, "Results"], followup: [3, "Follow-up"], verdict: [3, "Done"] }[view] as [number, string];

  return (
    <div className="rc gl gl-bg" tabIndex={-1} ref={box}>
      <header className="g-flowbar">
        {view === "followup" ? (
          <button type="button" className="g-link" onClick={() => setStage("results")}><Back />Results</button>
        ) : view === "results" && r?.status === "COMPLETE" ? (
          <button type="button" className="g-link" onClick={() => setShowResults(false)}><Back />Verdict</button>
        ) : (
          <button type="button" className="g-link" aria-label={`Back to ${backLabel}`} onClick={onClose}><Back />{backLabel}</button>
        )}
        <div className="g-step">
          <span className="g-steps" aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} className={i <= step[0] ? "on" : undefined} />)}</span>
          <span>{view === "verdict" ? "Done" : `${step[0]} of 3 · ${step[1]}`}</span>
        </div>
        {view === "draft" ? <button type="button" className="g-link quiet" disabled={busy} onClick={() => void postpone()}>Not today</button> : <span />}
      </header>
      <main className="g-stage" aria-label={r ? `Recall: ${r.subtopic}` : "Recall"}>
        {view === "loading" && (
          <section className="g-card narrow">
            {error ? <p className="g-err" role="alert">{error}</p> : <><div className="g-spin" aria-hidden="true" /><p className="g-sub" role="status">Preparing this sub-topic… the first time takes a few seconds.</p></>}
          </section>
        )}
        {r && view === "draft" && <BlankSlate r={r} ai={ai} busy={busy} run={run} error={error} />}
        {r && view === "waiting" && <Waiting r={r} busy={busy} run={run} backLabel={backLabel} onClose={onClose} />}
        {r && view === "results" && <Results r={r} busy={busy} run={run} error={error} onFollowup={() => setStage("followup")} onVerdict={() => setShowResults(false)} />}
        {r && view === "followup" && <FollowUp r={r} ai={ai} busy={busy} run={run} error={error} />}
        {r && view === "verdict" && <Verdict r={r} onResults={() => setShowResults(true)} onClose={onClose} />}
      </main>
    </div>
  );
}

/**
 * Recall is from memory: text cannot be pasted or dropped into an answer (a pasted checklist from an earlier review
 * scored 100 %). Typing, dictation and the recorder still work. Returns the handlers and the note to show once tried.
 */
function useNoPaste() {
  const [tried, setTried] = useState(false);
  const stop = (e: ClipboardEvent | DragEvent) => {
    e.preventDefault();
    setTried(true);
  };
  const note = tried ? <p className="g-small rc-nopaste" role="status">Recall is from memory, so pasting is off here. Type it, or speak instead.</p> : null;
  return { handlers: { onPaste: stop, onDrop: stop }, note };
}

const Ring = ({ score, small }: { score: number; small?: boolean }) => (
  <div className={`g-ring${small ? " sm" : ""}`} style={{ "--p": `${Math.round(score * 100)}%` } as CSSProperties} role="img" aria-label={`${Math.round(score * 100)} percent recalled`}>
    <div><b>{Math.round(score * 100)} %</b>{!small && <span>recalled</span>}</div>
  </div>
);

/* ---------------- 1 · the blank slate ---------------- */

function BlankSlate({ r, ai, busy, run, error }: { r: RecallReview; ai: AiStatus | null; busy: boolean; run: Run; error: string | null }) {
  const [typed, setTyped] = useState(r.typed);
  const [saving, setSaving] = useState(false);
  const [prompts, setPrompts] = useState(false);
  const noPaste = useNoPaste();
  const last = useRef(r.typed);
  // Typing is saved as it goes, so nothing is lost if the page closes.
  useEffect(() => {
    if (typed === last.current) return;
    const t = setTimeout(() => {
      setSaving(true);
      void api.saveRecallTyped(r.id, typed).then(() => (last.current = typed), () => undefined).finally(() => setSaving(false));
    }, 800);
    return () => clearTimeout(t);
  }, [typed, r.id]);

  const words = [...r.spokenParts, typed, ...r.sketches].join(" ").trim().split(/\s+/).filter(Boolean).length;
  const sketchInput = useRef<HTMLInputElement>(null);
  const [sketching, setSketching] = useState(false);
  const addSketch = async (file: File | undefined) => {
    if (sketchInput.current) sketchInput.current.value = "";
    if (!file) return;
    const type = file.type || (/\.png$/i.test(file.name) ? "image/png" : /\.webp$/i.test(file.name) ? "image/webp" : "image/jpeg");
    setSketching(true);
    await run(() => api.addSketch(r.id, file, type));
    setSketching(false);
  };
  const send = async () => {
    if (typed !== last.current) await api.saveRecallTyped(r.id, typed).catch(() => undefined);
    last.current = typed;
    await run(() => api.submitRecall(r.id));
  };
  const aiOn = !!(ai?.enabled && ai.consented);

  return (
    <section className="g-card g-split main-first" aria-label="Recall">
      <div className="g-aside">
        <div className="g-panel">
          <div className="kick">{r.topic}</div>
          <div className="g-title" style={{ marginTop: 8 }}>{r.subtopic}</div>
          <p className="g-sub">{r.attempt > 1 ? `Recall ${r.attempt}` : "First recall"}</p>
        </div>
        <h3 className="g-cap" style={{ marginTop: 6 }}>How it works</h3>
        <ol className="g-how">
          <li><span className="n on">1</span><span><b>Recall on your own</b>Only this counts toward your score and the next date.</span></li>
          <li><span className="n">2</span><span><b>Checked against a checklist</b>You see the checklist afterwards, so it can't cue you.</span></li>
          <li><span className="n">3</span><span><b>A senior engineer asks about the gaps</b>It shows what you know when prompted and never changes the score.</span></li>
        </ol>
        <div className="g-group">
          <button type="button" className="g-row" aria-expanded={prompts} onClick={() => setPrompts((x) => !x)}>
            <span className="g-lbl">Stuck? Show prompts<small>Four neutral questions, nothing from the checklist</small></span>
            {prompts ? <ChevronDown /> : <Chevron />}
          </button>
          {prompts && (
            <ul className="g-prompts" aria-label="Prompts">
              <li>What is it?</li><li>Why does it exist?</li><li>How does it work?</li><li>Where does it get tricky?</li>
            </ul>
          )}
        </div>
      </div>

      <div>
        <h1 className="g-title">What do you remember about {r.subtopic}?</h1>
        <p className="g-sub">Everything, in any order. Speak, type or sketch, or mix them.</p>

        {r.spokenParts.length > 0 && (
          <>
            <h3 className="g-cap">What you said <span className="g-r">{r.spokenParts.length}</span></h3>
            <ol className="g-group" aria-label="What you said">
              {r.spokenParts.map((p, i) => (
                <li key={i} className="g-row g-top">
                  <span className="g-lbl">Part {i + 1}<small>{p}</small></span>
                  <button type="button" className="g-link quiet" disabled={busy} aria-label={`Remove part ${i + 1}`} onClick={() => void run(() => api.removeRecallPart(r.id, i))}>Remove</button>
                </li>
              ))}
            </ol>
          </>
        )}

        <label className="g-cap" htmlFor="rc-typed">Type what you remember</label>
        <textarea id="rc-typed" className="g-ta" maxLength={20000} placeholder="Start anywhere…" value={typed} onChange={(e) => setTyped(e.target.value)} {...noPaste.handlers} />
        {noPaste.note}

        {aiOn && (
          <div className="g-pills" style={{ marginTop: 10 }}>
            {canRecord() && (
              <Recorder maxSeconds={ai!.maxRecordingSeconds} maxBytes={ai!.maxAudioBytes} label={r.spokenParts.length ? "Record more" : "Speak instead"}
                workingText="Writing down what you said…"
                transcribe={async (wav) => {
                  const next = await api.addRecallPart(r.id, wav);
                  await run(async () => next);
                  return { text: next.spokenParts[next.spokenParts.length - 1] ?? "" };
                }}
                onTranscript={() => undefined} />
            )}
            {r.sketches.length < 3 && (
              <button type="button" className="g-pill" disabled={busy} onClick={() => sketchInput.current?.click()}><Plus />Add a sketch</button>
            )}
            <input ref={sketchInput} type="file" className="sr" tabIndex={-1} aria-hidden="true" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={(e) => void addSketch(e.target.files?.[0])} />
          </div>
        )}

        {(r.sketches.length > 0 || sketching) && (
          <>
            <h3 className="g-cap">Your sketches, as read <span className="g-r">{r.sketches.length} of 3</span></h3>
            <ol className="g-group" aria-label="Your sketches, as read">
              {r.sketches.map((x, i) => (
                <li key={i} className="g-row g-top">
                  <Picture />
                  <span className="g-lbl">Sketch {i + 1}<small className="rc-sketch">{x}</small></span>
                  <button type="button" className="g-link quiet" disabled={busy} aria-label={`Remove sketch ${i + 1}`} onClick={() => void run(() => api.removeSketch(r.id, i))}>Remove</button>
                </li>
              ))}
              {sketching && <li className="g-row" role="status"><span className="g-spin sm" aria-hidden="true" /><span className="g-lbl">Reading your sketch…</span></li>}
            </ol>
            <p className="g-foot">Only the description is kept, never the photo. It is checked like your words.</p>
          </>
        )}

        {error && <p className="g-err" role="alert">{error}</p>}
        <div className="g-actions">
          <button type="button" className="btn primary wide" disabled={busy || words < 4} aria-busy={busy} onClick={() => void send()}>Check my recall</button>
        </div>
        <p className="g-small" style={{ textAlign: "center", marginTop: 10 }}>
          {saving ? "Saving… · " : words ? `${plural(words, "word")} · ` : ""}Recordings are written down, then deleted.
        </p>
      </div>
    </section>
  );
}

/* ---------------- 2 · checking ---------------- */

function Waiting({ r, busy, run, backLabel, onClose }: { r: RecallReview; busy: boolean; run: Run; backLabel: string; onClose: () => void }) {
  return (
    <section className="g-card narrow" aria-label="Checking" role="status" aria-live="polite">
      {!r.waitReason && <div className="g-spin" aria-hidden="true" />}
      <h1 className="g-title">Checking your recall</h1>
      {r.waitReason ? (
        <div className="g-callout" style={{ textAlign: "left", margin: "14px 0" }}>
          <Glyph kind="dot" />
          <span style={{ flex: 1 }}>{r.waitReason}</span>
          <button type="button" className="btn" disabled={busy} onClick={() => void run(() => api.retryRecall(r.id))}>Check again</button>
        </div>
      ) : (
        <p className="g-sub">Comparing what you recalled with the checklist for {r.subtopic}. Usually under a minute.</p>
      )}
      <ul className="g-group" style={{ marginTop: 20, textAlign: "left" }}>
        <li className="g-row"><Glyph kind="ok" /><span className="g-lbl">Written down</span><span className="g-val">Done</span></li>
        {r.sketches.length > 0 && <li className="g-row"><Glyph kind="ok" /><span className="g-lbl">{r.sketches.length > 1 ? "Sketches described" : "Sketch described"}</span><span className="g-val">Done</span></li>}
        <li className="g-row">
          {r.waitReason ? <Glyph kind="dot" /> : <span className="g-gly info"><span className="g-spin sm" /></span>}
          <span className="g-lbl"><b style={{ fontWeight: 600 }}>Compared with the checklist</b></span><span className="g-val">{r.waitReason ? "Waiting" : "Checking…"}</span>
        </li>
        <li className="g-row"><Glyph kind="dot" /><span className="g-lbl" style={{ color: "var(--g-muted)" }}>Score and next date</span><span className="g-val">Next</span></li>
      </ul>
      <p className="g-foot" style={{ textAlign: "center", marginTop: 14 }}>You can leave. It keeps going, and the result waits on Today.</p>
      <button type="button" className="btn big" style={{ marginTop: 10 }} onClick={onClose}>Back to {backLabel}</button>
    </section>
  );
}

/* ---------------- 2 · the results ---------------- */

function Results({ r, busy, run, error, onFollowup, onVerdict }: {
  r: RecallReview; busy: boolean; run: Run; error: string | null; onFollowup: () => void; onVerdict: () => void;
}) {
  const res = r.result!;
  const counted = res.points.filter((p) => !p.leftOut);
  const group = (s: RecallPointView["status"]) => counted.filter((p) => p.status === s);
  const gaps = counted.some((p) => p.status === "MISSED" || p.status === "PARTIAL") || res.misconceptions.length > 0;
  const [probeError, setProbeError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const ask = () => {
    setProbeError(null);
    setAsking(true);
    void api.probeRecall(r.id).then((x) => run(async () => x), (e) => setProbeError(errText(e))).finally(() => setAsking(false));
  };
  // The question is written as soon as the results show (once; it stays with the review), so the follow-up is ready.
  useEffect(() => {
    if (r.status === "CHECKED" && gaps && !r.followupQuestion) ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per review
  }, [r.id]);
  const finish = () => void run(() => api.completeRecall(r.id));
  const counts = (["ACCURATE", "PARTIAL", "MISSED"] as const).map((s) => [s, group(s).length] as const).filter(([, n]) => n > 0);
  const tally = counts.map(([s, n]) => `${n} ${STATUS[s].toLowerCase()}`).join(" · ");
  const bar = [...counted].sort((a, b) => RANK[a.status ?? "MISSED"] - RANK[b.status ?? "MISSED"]);

  return (
    <section className="g-card rs-card" aria-label="Results">
      <div className="rs-sum">
        <div className="kick">{r.topic}</div>
        <h1 className="g-title rs-title">{r.subtopic}</h1>
        <div className="rs-score"><b>{Math.round(res.score * 100)} %</b><span>recalled</span></div>
        <p className="rs-outcome">{OUTCOME[res.outcome]}: {MOVE[res.outcome]}.</p>
        <div className="rs-bar" role="img" aria-label={`Of ${plural(counted.length, "point")}: ${tally}`}>
          {bar.map((p) => <i key={p.id} className={p.status ? GLYPH[p.status] : "miss"} />)}
        </div>
        <p className="rs-tally" aria-hidden="true">{tally}</p>
        <ul className="g-group">
          <li className="g-row"><span className="g-lbl">Next review</span><span className="g-val" style={{ color: "var(--ink)" }}>{res.nextDueDate ? dayMonth(res.nextDueDate) : "None"}</span></li>
          <li className="g-row"><span className="g-lbl">Depth</span><span className="g-val" style={{ color: "var(--ink)" }}>{DEPTH[res.depth]}</span></li>
        </ul>
      </div>

      <div className="rs-act">
        {r.status === "COMPLETE" ? (
          <button type="button" className="btn primary wide" onClick={onVerdict}>See the verdict</button>
        ) : !gaps ? (
          <>
            <div className="g-callout info"><Glyph kind="ok" /><span><span className="h">Nothing to probe</span>You recalled every point on your own.</span></div>
            <button type="button" className="btn primary wide" disabled={busy} aria-busy={busy} onClick={finish}>{busy ? "Writing the verdict…" : "Finish"}</button>
          </>
        ) : (
          <>
            <div className="g-callout info">
              <Glyph kind="info" />
              <span>
                <span className="h">A senior engineer has a question</span>
                {probeError ? <>{probeError} <button type="button" className="g-link" disabled={asking} onClick={ask}>Try again</button></>
                  : r.followupQuestion ? "About what you missed. Optional, a few minutes." : <span role="status">Reading your gaps and writing it…</span>}
              </span>
            </div>
            {error && <p className="g-err" role="alert">{error}</p>}
            <button type="button" className="btn primary wide" disabled={busy || !r.followupQuestion} onClick={onFollowup}>Continue to the follow-up</button>
            <button type="button" className="btn quiet wide" disabled={busy} aria-busy={busy} onClick={finish} style={{ marginTop: -8 }}>{busy ? "Writing the verdict…" : "Finish without it"}</button>
          </>
        )}
        <details className="rs-about">
          <summary>About this check</summary>
          <p>
            Worked out in code from what you recalled on your own. The score counts definitions and how it works; edge
            cases decide the depth. The follow-up never changes it.
          </p>
          <p>Checked by {res.gradingModel ?? "the AI"} against {plural(counted.length, "point")}. A point that isn't part of this sub-topic? Its ⋯ menu leaves it out of the score from now on.</p>
        </details>
      </div>

      <div className="rs-main">
        <ResultScreens r={r} busy={busy} run={run} />
      </div>
    </section>
  );
}

/* ---------------- 3 · the senior engineer's follow-up ---------------- */

function FollowUp({ r, ai, busy, run, error }: { r: RecallReview; ai: AiStatus | null; busy: boolean; run: Run; error: string | null }) {
  const res = r.result!;
  const [answer, setAnswer] = useState("");
  const noPaste = useNoPaste();
  const missed = res.points.filter((p) => !p.leftOut && p.status === "MISSED");
  const gapPoints = res.points.filter((p) => !p.leftOut && (p.status === "MISSED" || p.status === "PARTIAL"));
  const recalled = res.points.filter((p) => p.recalledWhenAsked);
  const questions = (r.followupQuestion ?? "").split("\n").filter(Boolean);
  const finish = () => void run(() => api.completeRecall(r.id));

  return (
    <section className="g-card g-split main-first" aria-label="Follow-up">
      <div className="g-aside">
        <div className="g-panel">
          <div className="kick">{r.topic} · {r.subtopic}</div>
          <div className="g-score" style={{ marginTop: 12, gap: 14 }}>
            <Ring score={res.score} small />
            <p className="g-sub" style={{ color: "var(--ink)" }}>Your score{res.nextDueDate ? ` and next review (${dayMonth(res.nextDueDate)})` : ""} are fixed. Nothing you answer here changes them.</p>
          </div>
        </div>
        {gapPoints.length > 0 && (
          <>
            <h3 className="g-cap" style={{ marginTop: 6 }}>The question is about</h3>
            <ul className="g-group">
              {gapPoints.map((p) => <li key={p.id} className="g-row"><Glyph kind={GLYPH[p.status!]} /><span className="g-lbl">{p.label}<small>{STATUS[p.status!]}</small></span></li>)}
            </ul>
          </>
        )}
        <p className="g-foot">If your answer covers a missed point, it is marked "recalled when asked" in your results and over time.</p>
      </div>

      <div role="group" aria-label="Senior engineer">
        <div className="kick" style={{ display: "flex", alignItems: "center", gap: 8 }}><Person />Senior engineer</div>
        {questions.length === 1 ? (
          <h1 className="g-title" style={{ marginTop: 10 }}>{questions[0]}</h1>
        ) : (
          <ol className="g-title" style={{ marginTop: 10, paddingLeft: 26, fontSize: 21 }}>{questions.map((q, i) => <li key={i} style={{ marginBottom: 8 }}>{q}</li>)}</ol>
        )}

        {r.followupAnswer ? (
          <>
            <h3 className="g-cap">You answered</h3>
            <div className="g-group"><p className="g-row rc-yours" style={{ margin: 0, display: "block" }}>{r.followupAnswer}</p></div>
            {missed.length > 0 && (
              <>
                <h3 className="g-cap">What it showed</h3>
                <ul className="g-group">
                  {missed.map((p) => (
                    <li key={p.id} className="g-row g-top">
                      <Glyph kind={p.recalledWhenAsked ? "up" : "miss"} />
                      <span className="g-lbl">{p.label}<small>{p.recalledWhenAsked ? "You knew it when asked" : "Not in your answer"}</small></span>
                      <span className={`g-sb ${p.recalledWhenAsked ? "out" : "neutral"}`}>{p.recalledWhenAsked ? "Recalled when asked" : "Still missed"}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="g-foot">
              {recalled.length ? <>Recalled when asked: <b>{recalled.map((p) => p.label).join(", ")}</b>. </> : "None of the missed points came through in your answer. "}
              Your score and next date stay as you recalled on your own.
            </p>
            {error && <p className="g-err" role="alert">{error}</p>}
            <div className="g-actions">
              <button type="button" className="btn primary wide" disabled={busy} aria-busy={busy} onClick={finish}>{busy ? "Writing the verdict…" : "See the verdict"}</button>
            </div>
          </>
        ) : (
          <>
            <p className="g-sub">Answer the way you would in a design review. Take your time.</p>
            <label className="g-cap" htmlFor="rc-answer">Your answer to the follow-up</label>
            <textarea id="rc-answer" className="g-ta short" maxLength={20000} placeholder="Think it through, then answer…" value={answer} onChange={(e) => setAnswer(e.target.value)} {...noPaste.handlers} />
            {noPaste.note}
            {ai?.enabled && ai.consented && canRecord() && (
              <div className="g-pills" style={{ marginTop: 10 }}>
                <Recorder maxSeconds={ai.maxRecordingSeconds} maxBytes={ai.maxAudioBytes} label="Speak instead" workingText="Writing down your answer…"
                  transcribe={(wav) => api.transcribeFollowup(r.id, wav)}
                  onTranscript={(t) => setAnswer((a) => (a.trim() ? `${a.trim()} ${t}` : t))} />
              </div>
            )}
            {error && <p className="g-err" role="alert">{error}</p>}
            <div className="g-actions">
              <button type="button" className="btn primary wide" disabled={busy || answer.trim().length < 4} aria-busy={busy} onClick={() => void run(() => api.answerFollowup(r.id, answer))}>Submit answer</button>
              <button type="button" className="btn quiet wide" disabled={busy} onClick={finish}>Skip &amp; finish</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* ---------------- the verdict ---------------- */

const RATINGS = ["Needs Work", "Developing", "Strong"] as const;

function Verdict({ r, onResults, onClose }: { r: RecallReview; onResults: () => void; onClose: () => void }) {
  const v = r.seniorVerdict;
  const res = r.result!;
  const missed = res.points.filter((p) => !p.leftOut && p.status === "MISSED").length;
  return (
    <section className="g-card g-split wide-right" aria-label="Verdict">
      <div className="g-aside">
        <div className="kick">{r.topic} · {r.subtopic}</div>
        <div className="g-score">
          <Ring score={res.score} />
          <div>
            <div className="g-t2">{DEPTH[res.depth]}</div>
            <p className="g-sub">{res.nextDueDate ? `Next review ${dayMonth(res.nextDueDate)}` : "No next review"}</p>
          </div>
        </div>
        {v?.cuedReasoningRating ? (
          <>
            <h3 className="g-cap" style={{ marginTop: 8 }}>Reasoning when asked</h3>
            <div className="g-seg" role="img" aria-label={`Reasoning when asked: ${v.cuedReasoningRating}`}>
              {RATINGS.map((x) => <span key={x} className={x === v.cuedReasoningRating ? "on" : undefined}>{x === "Needs Work" ? "Needs work" : x}</span>)}
            </div>
            <p className="g-foot">{v.recalledWhenAsked.length} of the {missed} missed {missed === 1 ? "point" : "points"} came back when asked.</p>
          </>
        ) : (
          <p className="g-foot">No follow-up answered: the verdict is written from what you recalled on your own.</p>
        )}
        {v && v.recalledWhenAsked.length > 0 && (
          <>
            <h3 className="g-cap" style={{ marginTop: 8 }}>Recalled when asked</h3>
            <div className="g-pills">{v.recalledWhenAsked.map((x) => <span key={x} className="g-sb out">↑ {x}</span>)}</div>
          </>
        )}
      </div>

      <div>
        <div className="kick" style={{ display: "flex", alignItems: "center", gap: 8 }}><Person />Senior engineer</div>
        <h1 className="g-title" style={{ marginTop: 10 }}>The verdict</h1>
        {v ? (
          <ul className="g-group" role="group" aria-label="Senior engineer's verdict" style={{ marginTop: 16 }}>
            <li className="g-row g-top"><Glyph kind="ok" /><span className="g-lbl"><span className="g-vt">Foundations</span><span className="g-vb">{v.foundationsSummary}</span></span></li>
            <li className="g-row g-top"><Glyph kind="part" /><span className="g-lbl"><span className="g-vt">How it works, pitfalls and trade-offs</span><span className="g-vb">{v.architectureAndEdgeCasesSummary}</span></span></li>
            <li className="g-row g-top g-focus"><Target /><span className="g-lbl"><span className="g-vt">Focus next</span><span className="g-vb">{v.focusNext}</span></span></li>
          </ul>
        ) : (
          <div className="g-callout" style={{ marginTop: 16 }}><Glyph kind="dot" /><span>The verdict couldn't be written (the AI was busy). Your results and the next date are saved.</span></div>
        )}
        <p className="g-foot">{v ? "Written from your recall and your follow-up answer. " : ""}The score and next date come only from the recall.</p>
        <div style={{ display: "flex", gap: 10, marginTop: 24, flexWrap: "wrap" }}>
          <button type="button" className="btn big" style={{ flex: 1, justifyContent: "center" }} onClick={onResults}>See the results</button>
          <button type="button" className="btn primary big" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>Done</button>
        </div>
      </div>
    </section>
  );
}
