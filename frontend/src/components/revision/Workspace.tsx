/**
 * The revision workspace (Revision v2 plan §3.3–§3.5, §10): a full-screen, calm place for one question at a time. On
 * laptops the session's topics and progress sit on the left and the question on the right; on phones one column.
 * Everything is decided and stored by the backend: the questions, their order, the check, hints and the next dates.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, api } from "../../api/client";
import type { AiStatus, CompletionCard, RevisionSessionView, SessionFeedback, SessionKind, SessionQuestion } from "../../api/types";
import { dayMonth, plural } from "../../lib/format";
import { ReportIssue } from "../ReportIssue";
import { feedbackSpeech, langOf, parseChoice, parseResult, questionSpeech, say } from "../voice/conversation";
import { ReadAloud } from "../voice/ReadAloud";
import { Recorder, canRecord } from "../voice/Recorder";
import { canSpeak, speak, stopSpeaking, voiceLang } from "../voice/speak";
import { CodeRun } from "./CodeRun";
import { KIND_LABEL } from "./PackDialog";

export const RESULTS = [
  { value: 0, label: "Forgot" },
  { value: 1, label: "Struggled" },
  { value: 2, label: "Recalled" },
  { value: 3, label: "Strong recall" },
] as const;
const CONFIDENCE = ["Not at all", "Shaky", "Fairly", "Sure"] as const;
const CODE_KINDS = new Set(["DEBUG", "APPLY", "SPOT_ERROR"]);
const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");

/** Conversation mode is remembered on this device. */
const TALK_KEY = "blueprint.conversation";
const talkSaved = () => {
  try {
    return localStorage.getItem(TALK_KEY) === "on";
  } catch {
    return false;
  }
};
const saveTalk = (on: boolean) => {
  try {
    localStorage.setItem(TALK_KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable: the choice lasts for this session */
  }
};
/** One speaker id for the whole conversation, so a new question or the feedback replaces what was being read. */
const TALK_ID = "conversation";

/** The learner's answer with the AI check's quotes highlighted (plan §3.4, point cards). */
export function Highlighted({ text, quotes }: { text: string; quotes: string[] }) {
  const parts = useMemo(() => {
    const qs = quotes.filter((q) => q && q.length >= 2);
    if (!qs.length) return [{ t: text, m: false }];
    const lower = text.toLowerCase();
    const marks: [number, number][] = [];
    for (const q of qs) {
      const i = lower.indexOf(q.toLowerCase());
      if (i >= 0) marks.push([i, i + q.length]);
    }
    marks.sort((a, b) => a[0] - b[0]);
    const out: { t: string; m: boolean }[] = [];
    let at = 0;
    for (const [a, b] of marks) {
      if (a < at) continue;
      if (a > at) out.push({ t: text.slice(at, a), m: false });
      out.push({ t: text.slice(a, b), m: true });
      at = b;
    }
    if (at < text.length) out.push({ t: text.slice(at), m: false });
    return out;
  }, [text, quotes]);
  return <p className="ws-yours">{parts.map((p, i) => (p.m ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))}</p>;
}

const VERDICT = { COVERED: "Covered", PARTIAL: "Partly", MISSING: "Missing", INCORRECT: "Not right" } as const;

export function Workspace({ start, sessionId, onClose }: { start?: SessionKind; sessionId?: number; onClose: () => void }) {
  const [s, setS] = useState<RevisionSessionView | null>(null);
  const [cards, setCards] = useState<CompletionCard[] | null>(null);
  const [keepGoing, setKeepGoing] = useState<{ tomorrow: number; practice: boolean } | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [talkOn, setTalkOn] = useState(talkSaved);
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    return () => before?.focus?.();
  }, []);

  useEffect(() => {
    let live = true;
    (sessionId ? api.session(sessionId) : api.startSession(start ?? "PLANNED")).then((x) => live && setS(x), (e) => live && setError(errText(e)));
    api.aiStatus().then((x) => live && setAi(x), () => undefined);
    return () => {
      live = false;
    };
  }, [sessionId, start]);

  const run = async <T,>(f: () => Promise<T>) => {
    setBusy(true);
    setError(null);
    try {
      return await f();
    } catch (e) {
      setError(errText(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!s) return;
    const r = await run(() => api.finishSession(s.id));
    if (!r) return;
    setS(r.session);
    setCards(r.cards);
    const h = await api.revisionHome().catch(() => null);
    setKeepGoing(h?.keepGoing ?? null);
  };

  const again = async (kind: SessionKind) => {
    const r = await run(() => api.startSession(kind));
    if (r) {
      setCards(null);
      setS(r);
    }
  };

  const total = s?.entries.length ?? 0;
  const done = s?.entries.filter((e) => e.state === "DONE").length ?? 0;
  const q = s?.current?.question ?? null;
  const topicOf = q ? s!.topics.find((t) => t.topicId === q.topicId) : null;
  // Hands-free needs a voice, a microphone, and the AI (transcription and the check) allowed.
  const canTalk = !!ai?.enabled && ai.consented && canSpeak() && canRecord();
  const talk = canTalk && talkOn;
  const toggleTalk = () => {
    const on = !talkOn;
    setTalkOn(on);
    saveTalk(on);
    if (!on) stopSpeaking();
  };

  return createPortal(
    <div className="ws" role="dialog" aria-modal="true" aria-labelledby="ws-title" tabIndex={-1} ref={box}>
      <header className="ws-head">
        <div>
          <div className="kick">{s?.kind === "PRACTICE" ? "Practice" : s?.kind === "EARLY" ? "Revision · keep going" : "Revision"}</div>
          <h2 id="ws-title">
            {cards ? "Today's revision is done" : q ? `${q.topicName} · ${Math.min((topicOf?.done ?? 0) + 1, topicOf?.questions ?? 1)} of ${topicOf?.questions ?? 1}` : s ? "All questions answered" : "Preparing your questions…"}
          </h2>
          {s && !cards && <div className="sub">Question {Math.min(done + 1, total)} of {total} · about {s.plannedMinutes} min planned</div>}
        </div>
        {canTalk && !cards && (
          <button className={`kit-pill ws-talk${talk ? " on" : ""}`} aria-pressed={talk} onClick={toggleTalk}
            title="Hands-free: questions are read aloud, you answer by voice, and the feedback is read back">
            {talk ? "Conversation on" : "Conversation"}
          </button>
        )}
        <button className="btn" onClick={() => { stopSpeaking(); if (s && s.status === "ACTIVE" && done > 0 && !cards) void finish(); else closeRef.current(); }}>
          {s && s.status === "ACTIVE" && done > 0 && !cards ? "Stop for today" : "Close"}
        </button>
      </header>
      {error && <p className="af-err ws-err" role="alert">{error}</p>}
      <div className="ws-body">
        {s && (
          <aside className="ws-side" aria-label="This session">
            {s.topics.map((t) => (
              <div key={t.topicId} className={`ws-topic${q?.topicId === t.topicId ? " on" : ""}`}>
                <b>{t.name}</b>
                <span className="m">{t.done} of {t.questions}</span>
                <div className="bar" aria-hidden="true"><i style={{ width: `${(t.done / Math.max(1, t.questions)) * 100}%` }} /></div>
              </div>
            ))}
            <ol className="ws-dots" aria-label="Questions">
              {s.entries.map((e) => (
                <li key={e.index} className={`${e.state.toLowerCase()}${q?.index === e.index ? " now" : ""}`} title={`${e.topicName}: ${e.conceptTitle}${e.relearn ? " (one more)" : ""}`}>
                  <span className="sr">{e.conceptTitle}: {e.state === "DONE" ? RESULTS[e.final ?? 0].label : e.state === "ANSWERED" ? "answered" : "to do"}</span>
                </li>
              ))}
            </ol>
          </aside>
        )}
        <main className="ws-main">
          {cards ? (
            <Completion cards={cards} keepGoing={keepGoing} busy={busy} onAgain={again} onClose={onClose} />
          ) : q && s ? (
            <QuestionFlow key={`${s.id}-${q.index}-${q.itemId}`} s={s} q={q} feedback={s.current!.feedback} ai={ai} busy={busy} run={run} onSession={setS} talk={talk} />
          ) : s ? (
            <div className="ws-card">
              <p>Every question is answered.</p>
              <button className="btn primary" disabled={busy} onClick={() => void finish()}>See how it went</button>
            </div>
          ) : null}
        </main>
      </div>
    </div>,
    document.body,
  );
}

type Run = <T>(f: () => Promise<T>) => Promise<T | null>;

function QuestionFlow({ s, q, feedback, ai, busy, run, onSession, talk }: {
  s: RevisionSessionView; q: SessionQuestion; feedback: SessionFeedback | null; ai: AiStatus | null; busy: boolean; run: Run; onSession: (x: RevisionSessionView) => void; talk: boolean;
}) {
  const [hints, setHints] = useState<string[]>(q.hints);
  const [answer, setAnswer] = useState("");
  const [mode, setMode] = useState<"TYPED" | "SPOKEN" | "CODE">(q.code || CODE_KINDS.has(q.kind ?? "") ? "CODE" : "TYPED");
  const [choice, setChoice] = useState<number[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [fb, setFb] = useState<SessionFeedback | null>(feedback);
  const t0 = useRef(Date.now());
  const open = q.format === "OPEN";
  const canSpeak = !!ai?.enabled && ai.consented && canRecord();
  const lang = langOf(q.language);
  const needsCode = open && mode === "CODE";
  // Conversation mode: read the question, then listen (a code answer is typed). `listen` remounts the recorder.
  const [listen, setListen] = useState(0);
  const [unclear, setUnclear] = useState<string | null>(null);
  useEffect(() => {
    if (!talk || fb) return;
    speak(questionSpeech(q, lang), voiceLang(q.language), TALK_ID, () => !needsCode && setListen((x) => x + 1));
    return () => stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per question, when the mode is on
  }, [talk]);

  const hint = async () => {
    const r = await run(() => api.sessionHint(s.id, q.index));
    if (r) setHints(r.hints);
  };
  const check = async (said?: { answer?: string; choice?: number[] }) => {
    const spoken = said?.answer !== undefined;
    const r = await run(() => api.sessionAnswer(s.id, {
      index: q.index, mode: open ? (spoken ? "SPOKEN" : mode) : "CHOICE", answer: open ? (said?.answer ?? answer) : undefined, choice: open ? undefined : (said?.choice ?? choice),
      confidence: open ? (confidence ?? undefined) : undefined, seconds: Math.round((Date.now() - t0.current) / 1000),
    }));
    if (r) setFb(r);
  };
  /** A spoken reply in conversation mode: an open answer is checked at once; a choice must name an option. */
  const heard = (t: string) => {
    if (open) {
      setAnswer(t);
      setMode("SPOKEN");
      void check({ answer: t });
      return;
    }
    const picked = parseChoice(t, q.options, q.format === "MULTI");
    if (picked) {
      setChoice(picked);
      setUnclear(null);
      void check({ choice: picked });
    } else {
      setUnclear(t);
      speak(q.format === "MULTI" ? say(lang).sayAll : say(lang).sayLetter, voiceLang(q.language), TALK_ID, () => setListen((x) => x + 1));
    }
  };
  const skip = async () => {
    const r = await run(() => api.sessionSkip(s.id, q.index));
    if (r) onSession(r);
  };

  if (fb) return <Feedback s={s} q={q} fb={fb} busy={busy} run={run} onSession={onSession} talk={talk} ai={ai} />;

  const ready = open ? answer.trim().length > 0 && confidence !== null : choice.length > 0;
  return (
    <section className="ws-card" aria-label="Question">
      <div className="ws-chip">
        {KIND_LABEL[q.kind ?? ""] ?? "Question"} · about {q.minutes} min{q.relearn && " · one more, a little easier"}
      </div>
      {q.situation && <p className="ws-sit">{q.situation}</p>}
      {q.code && <pre className="ws-code"><code>{q.code}</code></pre>}
      <h3 className="ws-q">{q.question}</h3>
      <div className="ws-meta">
        {q.answerSize && <span className="m">{q.answerSize}</span>}
        {!talk && <ReadAloud text={[q.situation, q.question, ...q.options].filter(Boolean).join(". ")} what="the question" lang={q.language} />}
      </div>
      {hints.length > 0 && (
        <ol className="ws-hints" aria-label="Hints">
          {hints.map((h, i) => <li key={i}>{h}</li>)}
        </ol>
      )}
      {open ? (
        <>
          <div className="ws-modes" role="radiogroup" aria-label="How you answer">
            {(["TYPED", "CODE"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m || (m === "TYPED" && mode === "SPOKEN")} className={`kit-pill${mode === m || (m === "TYPED" && mode === "SPOKEN") ? " on" : ""}`} onClick={() => setMode(m)}>
                {m === "TYPED" ? "Words" : "Code"}
              </button>
            ))}
          </div>
          <textarea className={`inp ws-answer${mode === "CODE" ? " code" : ""}`} rows={mode === "CODE" ? 8 : 5} maxLength={5000} aria-label="Your answer"
            spellCheck={mode !== "CODE"} placeholder={mode === "CODE" ? "Write the code…" : "Answer from memory, in your own words…"} value={answer} onChange={(e) => setAnswer(e.target.value)} />
          {mode === "CODE" && <CodeRun code={answer} />}
          {canSpeak && !talk && (
            <Recorder maxSeconds={ai!.maxRecordingSeconds} maxBytes={ai!.maxAudioBytes} label="Speak your answer"
              transcribe={(wav) => api.sessionTranscribe(s.id, q.index, wav)}
              onTranscript={(t) => { setAnswer((a) => (a.trim() ? `${a.trim()} ${t}` : t)); setMode("SPOKEN"); }} />
          )}
          {answer.trim() && (
            <div className="ws-conf" role="radiogroup" aria-label="How sure are you?">
              <span>How sure are you?</span>
              {CONFIDENCE.map((c, i) => (
                <button key={c} type="button" role="radio" aria-checked={confidence === i} className={`kit-pill${confidence === i ? " on" : ""}`} onClick={() => setConfidence(i)}>{c}</button>
              ))}
            </div>
          )}
        </>
      ) : (
        <ul className="ws-options" role={q.format === "MULTI" ? "group" : "radiogroup"} aria-label={q.format === "MULTI" ? "Choose all that are true" : "Choose one"}>
          {q.options.map((o, i) => {
            const on = choice.includes(i);
            return (
              <li key={i}>
                <button type="button" role={q.format === "MULTI" ? "checkbox" : "radio"} aria-checked={on} className={`ws-option${on ? " on" : ""}`}
                  onClick={() => setChoice(q.format === "MULTI" ? (on ? choice.filter((x) => x !== i) : [...choice, i]) : [i])}>
                  <span className="ws-mark" aria-hidden="true">{String.fromCharCode(65 + i)}</span>{o}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {talk && (
        <div className="ws-talking" role="status">
          {needsCode ? <p className="m">{say(lang).codeAnswer}</p> : (
            <>
              {listen > 0 && !busy && (
                <Recorder key={listen} autoStart stopAfterSilenceMs={open ? 2500 : 1500} maxSeconds={ai!.maxRecordingSeconds} maxBytes={ai!.maxAudioBytes}
                  label={open ? "Answer by voice" : "Say your choice"} transcribe={(wav) => api.sessionTranscribe(s.id, q.index, wav)} onTranscript={heard} />
              )}
              {listen === 0 && <p className="m">Reading the question…</p>}
              {unclear && <p className="m">Heard “{unclear}”: say the letter, or tap an option.</p>}
            </>
          )}
        </div>
      )}
      <div className="rd-acts">
        <button className="btn primary" disabled={busy || !ready} aria-busy={busy} onClick={() => void check()}>{open ? "Check my answer" : "Check"}</button>
        {hints.length < q.hintsAvailable && <button className="btn" disabled={busy} onClick={() => void hint()}>Hint ({hints.length + 1} of {q.hintsAvailable})</button>}
        <button className="link" disabled={busy} onClick={() => void skip()}>Skip for now</button>
      </div>
      {open && answer.trim() && confidence === null && <p className="m">Say how sure you are, then check.</p>}
    </section>
  );
}

function Feedback({ s, q, fb, busy, run, onSession, talk, ai }: {
  s: RevisionSessionView; q: SessionQuestion; fb: SessionFeedback; busy: boolean; run: Run; onSession: (x: RevisionSessionView) => void; talk: boolean; ai: AiStatus | null;
}) {
  const [final, setFinal] = useState<number | null>(fb.suggested);
  const [full, setFull] = useState(false);
  const [seen, setSeen] = useState(false);
  const ev = fb.evaluation;
  const weak = (fb.suggested ?? 3) <= 1 || fb.correct === false;
  const coding = fb.mode === "CODE" || (!!fb.code && fb.format === "OPEN");
  const save = async (value = final) => {
    if (value === null) return;
    const r = await run(() => api.sessionResult(s.id, { responseId: fb.responseId, final: value, modelShown: seen || full || talk }));
    if (r) onSession(r);
  };
  // Conversation mode: read the feedback back, then listen for how it went ("okay" takes the suggestion).
  const lang = langOf(q.language);
  const [listen, setListen] = useState(0);
  const readBack = () => speak(feedbackSpeech(fb, lang), voiceLang(q.language), TALK_ID, () => setListen((x) => x + 1));
  useEffect(() => {
    if (!talk || fb.final !== null) return;
    readBack();
    return () => stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per answer, when the mode is on
  }, [talk]);
  const heard = (t: string) => {
    const r = parseResult(t, fb.suggested);
    if (r === "repeat") readBack();
    else if (r === null) speak(fb.suggested !== null ? say(lang).askResult : say(lang).askOwn, voiceLang(q.language), TALK_ID, () => setListen((x) => x + 1));
    else {
      setFinal(r);
      void save(r);
    }
  };
  return (
    <section className="ws-card" aria-label="Feedback">
      <div className="ws-chip">{KIND_LABEL[q.kind ?? ""] ?? "Question"}</div>
      <h3 className="ws-q small">{q.question}</h3>
      {fb.format !== "OPEN" ? (
        <>
          <p className={`ws-verdict ${fb.correct ? "ok" : "no"}`} role="status">{fb.correct ? "Right." : "Not quite."}</p>
          <ul className="ws-options done">
            {fb.options.map((o, i) => (
              <li key={i} className={`${o.correct ? "right" : ""}${o.chosen ? " chosen" : ""}`}>
                <div><span className="ws-mark" aria-hidden="true">{String.fromCharCode(65 + i)}</span>{o.text}{o.correct ? " ✓" : o.chosen ? " ✗" : ""}</div>
                {(o.chosen || o.correct) && <p className="m">{o.explanation}</p>}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {ev ? (
            <>
              <p className="ws-verdict" role="status">{ev.feedback}</p>
              <Highlighted text={fb.answer} quotes={ev.criteria.map((c) => c.evidence ?? "")} />
              <ul className="ws-points" aria-label="Expected points">
                {ev.criteria.map((c) => (
                  <li key={c.index} className={c.verdict.toLowerCase()}>
                    <b>{VERDICT[c.verdict]}</b> {c.text}
                    {c.evidence && <span className="m"> · “{c.evidence}”</span>}
                  </li>
                ))}
              </ul>
              {ev.misconceptions.length > 0 && (
                <ul className="ws-miscon" aria-label="Corrections">
                  {ev.misconceptions.map((m, i) => <li key={i}>You wrote “{m.claim}”: {m.correction}</li>)}
                </ul>
              )}
            </>
          ) : (
            <>
              {fb.aiError && <p className="m">The AI check isn't available right now ({fb.aiError}). Compare with the expected points yourself.</p>}
              <p className="ws-yours">{fb.answer}</p>
              <div className="ws-expected"><b>A good answer covers</b><ul>{fb.expected.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
            </>
          )}
        </>
      )}
      {weak && fb.misconceptions.length > 0 && <p className="ws-mixup"><b>Common mix-up:</b> {fb.misconceptions[0]}</p>}
      <div className="ws-model">
        <b>Model answer</b>
        {coding && fb.answer ? (
          <div className="ws-compare">
            <div><span className="m">Your answer</span><pre className="ws-code"><code>{fb.answer}</code></pre><CodeRun code={fb.answer} label="Run yours" what="your answer" /></div>
            <div><span className="m">Model answer</span><pre className="ws-code"><code>{fb.modelAnswer.full}</code></pre><CodeRun code={fb.modelAnswer.full} label="Run it" what="the model answer" /></div>
          </div>
        ) : (
          <>
            <p>{full ? fb.modelAnswer.full : fb.modelAnswer.gist}</p>
            {fb.modelAnswer.full !== fb.modelAnswer.gist && <button className="link" aria-expanded={full} onClick={() => { setFull((x) => !x); setSeen(true); }}>{full ? "Show less" : "Show the full answer"}</button>}
          </>
        )}
        {!talk && <ReadAloud text={fb.modelAnswer.full} what="the model answer" lang={q.language} />}
      </div>
      <div className="ws-result" role="radiogroup" aria-label="How did it go?">
        <span>How did it go?{fb.suggestedLabel && <span className="m"> Suggested: {fb.suggestedLabel}{fb.hintsUsed ? `, after ${plural(fb.hintsUsed, "hint")}` : ""}</span>}</span>
        <div>
          {RESULTS.filter((r) => fb.format === "OPEN" || r.value !== 3).map((r) => (
            <button key={r.value} type="button" role="radio" aria-checked={final === r.value} className={`kit-pill${final === r.value ? " on" : ""}`} onClick={() => setFinal(r.value)}>{r.label}</button>
          ))}
        </div>
      </div>
      {talk && listen > 0 && !busy && ai && (
        <div className="ws-talking">
          <Recorder key={listen} autoStart stopAfterSilenceMs={1500} maxSeconds={ai.maxRecordingSeconds} maxBytes={ai.maxAudioBytes}
            label="Say how it went" transcribe={(wav) => api.sessionTranscribe(s.id, q.index, wav)} onTranscript={heard} />
        </div>
      )}
      <div className="rd-acts">
        <button className="btn primary" disabled={busy || final === null} aria-busy={busy} onClick={() => void save()}>Continue</button>
        <ReportIssue reasons={fb.format === "OPEN" && ev ? ["UNFAIR_CHECK", "OUT_OF_SYLLABUS", "UNCLEAR", "OTHER"] : ["OUT_OF_SYLLABUS", "UNCLEAR", "OTHER"]}
          context={{ promptText: q.question, topicId: q.topicId, responseId: fb.responseId, itemId: q.itemId }} />
      </div>
      {final !== null && final <= 1 && s.kind !== "PRACTICE" && !q.relearn && <p className="m">You'll get one more, easier question on this at the end.</p>}
    </section>
  );
}

function Completion({ cards, keepGoing, busy, onAgain, onClose }: {
  cards: CompletionCard[]; keepGoing: { tomorrow: number; practice: boolean } | null; busy: boolean; onAgain: (k: SessionKind) => void; onClose: () => void;
}) {
  const group = (c: CompletionCard, r: number) => c.results.filter((x) => (r === 2 ? x.result === 2 : x.result === r)).map((x) => x.title);
  return (
    <section className="ws-card" aria-label="How it went">
      {cards.length === 0 && <p>Practice done. It doesn't change any dates.</p>}
      {cards.map((c) => (
        <div key={c.topicId} className="ws-done">
          <h3>{c.name} reviewed · cycle {c.cycle} of 6{c.cycleDone ? " done" : ""}</h3>
          {[3, 2, 1, 0].map((r) => group(c, r).length > 0 && (
            <p key={r}><b>{["Forgot", "Struggled", "Recalled", "Strong"][r]}:</b> {group(c, r).join(", ")}</p>
          ))}
          {c.results.some((x) => x.relearned) && <p className="m">Relearned before you left: {c.results.filter((x) => x.relearned).map((x) => x.title).join(", ")}.</p>}
          <p>
            {c.retained ? "All six cycles done: this topic is retained." : c.nextDueDate ? <>Next review: <b>{dayMonth(c.nextDueDate)}</b>{c.weakOnly ? " (only the shaky concepts)" : ""}{c.firstNext ? ` · ${c.firstNext} comes first.` : "."}</> : null}
          </p>
          {c.interval && (
            <p className="m">
              In {plural(c.interval.days, "day")} rather than the usual {c.interval.fixed}{c.interval.reason ? `: ${c.interval.reason}` : ""}. The gap follows how each concept went.
            </p>
          )}
        </div>
      ))}
      <div className="ws-keep">
        <b>Keep going?</b>
        <div className="rd-acts">
          {!!keepGoing?.tomorrow && <button className="btn" disabled={busy} onClick={() => onAgain("EARLY")}>Revise topics due tomorrow ({keepGoing.tomorrow})</button>}
          {keepGoing?.practice && <button className="btn" disabled={busy} onClick={() => onAgain("PRACTICE")}>Practise your weakest concepts</button>}
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </section>
  );
}
