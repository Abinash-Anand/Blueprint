/**
 * Revision pack for one topic (Revision v2 plan §3.2, §5, phase 1): "What did you study?", building the pack in the
 * background, then the concepts found in the learner's material, which they can correct, and the stored questions,
 * shown only when asked (they include the answers). Everything here is stored by the backend; nothing is invented here.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, api } from "../../api/client";
import type { PackConcept, PackItem, PackOverview, RevisionMaterial } from "../../api/types";
import { plural } from "../../lib/format";

/* ---------------- labels ---------------- */

export const KIND_LABEL: Record<string, string> = {
  RECALL: "Direct recall", EXPLAIN: "Explain why or how", SCENARIO: "Scenario", PREDICT: "Predict the output",
  SPOT_ERROR: "Spot the error", DEBUG: "Debug", COMPARE: "Compare", JUDGE: "Judge a choice", APPLY: "Apply it",
  TRANSFER: "Mixed transfer", QUICK_CHOICE: "Quick choice", TRICKY_CHOICE: "Tricky choice", WHAT_HAPPENS: "What happens?",
  FIND_WRONG_LINE: "Find the wrong line", BEST_FIX: "Best fix", TWO_PART: "Answer and reason", SELECT_ALL: "Select all that are true",
};
const LEVEL_LABEL = ["", "Recall", "Explain", "Scenario", "Spot and compare", "Judge and apply", "Transfer"];

/** Upload type for a file: its type, or (Windows often leaves it empty) its extension; null if not accepted. */
const BY_EXT: Record<string, string> = {
  pdf: "application/pdf", txt: "text/plain", text: "text/plain", md: "text/markdown", markdown: "text/markdown",
  html: "text/html", htm: "text/html", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export function materialType(f: { name: string; type: string }, accepted: string[]): string | null {
  const t = f.type.toLowerCase();
  if (accepted.includes(t)) return t;
  const byExt = BY_EXT[f.name.toLowerCase().split(".").pop() ?? ""];
  return byExt && accepted.includes(byExt) ? byExt : null;
}
const ACCEPT = ".pdf,.docx,.md,.markdown,.txt,.html,.htm";

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");
const materialLine = (m: RevisionMaterial) => {
  const n = m.chars.toLocaleString("en-GB");
  return m.pages ? `${plural(m.pages, "page")} · ${n} characters read` : `${n} characters read`;
};

/* ---------------- the dialog ---------------- */

export function PackDialog({ topicId, topicName, onClose }: { topicId: string; topicName: string; onClose: () => void }) {
  const [o, setO] = useState<PackOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, []);

  useEffect(() => {
    let live = true;
    api.pack(topicId).then((x) => live && (setO(x), setError(null)), (e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [topicId, reload]);

  // While a pack or a learner's concept is being written, follow it.
  const working = !!o?.building || !!o?.pack?.concepts?.some((c) => c.status === "BUILDING");
  useEffect(() => {
    if (!working) return;
    const t = setTimeout(() => setReload((n) => n + 1), 1500);
    return () => clearTimeout(t);
  }, [working, o]);

  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      setReload((n) => n + 1);
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const view = !o ? null : o.building ? "building" : o.pack ? "ready" : "material";

  return createPortal(
    <div className="overlay focus" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog pkd" role="dialog" aria-modal="true" aria-labelledby="pk-title" tabIndex={-1} ref={box}>
        <button className="close" aria-label="Close" onClick={onClose}>×</button>
        <div className="kick">Revision pack · {topicName}</div>
        <h2 id="pk-title">
          {view === "building" ? "Building your revision" : view === "ready" ? (o!.pack!.basis === "MATERIAL" ? `From your material, ${plural(liveConcepts(o!).length, "concept")}` : `From the topic outline, ${plural(liveConcepts(o!).length, "concept")}`) : `Before you revise ${topicName}: what did you study?`}
        </h2>
        {!o && !error && <p className="sub">Loading…</p>}
        {error && <p className="af-err" role="alert">{error}</p>}
        {o && view === "material" && <MaterialStep o={o} topicId={topicId} busy={busy} act={act} />}
        {o && view === "building" && <Building o={o} />}
        {o && view === "ready" && <Ready o={o} topicId={topicId} busy={busy} act={act} />}
        <p className="pk-foot">Your revision sessions ask these questions: the same concepts each cycle, with new and harder questions.</p>
      </div>
    </div>,
    document.body,
  );
}

const liveConcepts = (o: PackOverview) => (o.pack?.concepts ?? []).filter((c) => !c.removed);

type Act = (f: () => Promise<unknown>) => Promise<boolean>;

/* ---------------- material and consent ---------------- */

function Materials({ o, topicId, busy, act }: { o: PackOverview; topicId: string; busy: boolean; act: Act }) {
  const [notes, setNotes] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const full = o.materials.length >= o.limits.maxFiles;

  const addFiles = async (files: FileList | null) => {
    setFileError(null);
    for (const f of [...(files ?? [])]) {
      const type = materialType(f, o.limits.types);
      if (!type) {
        setFileError(`"${f.name}" isn't a PDF, Word (.docx), Markdown, HTML or text file. Images come later.`);
        continue;
      }
      if (f.size > o.limits.maxBytes) {
        setFileError(`"${f.name}" is larger than 5 MB.`);
        continue;
      }
      if (!(await act(() => api.addMaterial(topicId, f, f.name, type)))) break;
    }
    if (input.current) input.current.value = "";
  };
  const saveNotes = async () => {
    const text = notes.trim();
    if (await act(() => api.addMaterial(topicId, new Blob([text], { type: "text/plain" }), "Pasted notes", "text/plain; charset=utf-8"))) setNotes("");
  };

  return (
    <div className="pk-material">
      {o.materials.length > 0 && (
        <ul className="pk-files" aria-label="Your material">
          {o.materials.map((m) => (
            <li key={m.id}>
              <span><b>{m.name}</b> <span className="m">{materialLine(m)}</span></span>
              <button className="link" disabled={busy} aria-label={`Remove ${m.name}`} onClick={() => void act(() => api.removeMaterial(topicId, m.id))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <>
          <textarea className="inp" rows={5} maxLength={o.limits.maxChars} aria-label="Paste a list or your notes"
            placeholder="Paste a list of what you covered, or your notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="pk-row">
            <button className="btn" disabled={busy || notes.trim().length < 40} onClick={() => void saveNotes()}>Add these notes</button>
            <button className="btn" disabled={busy} onClick={() => input.current?.click()}>Add files</button>
            <span className="m">PDF, Word, Markdown, HTML or text · up to {o.limits.maxFiles} · only the text is kept</span>
            <input ref={input} type="file" className="sr" tabIndex={-1} aria-hidden="true" multiple accept={ACCEPT} onChange={(e) => void addFiles(e.target.files)} />
          </div>
          {notes.trim().length > 0 && notes.trim().length < 40 && <p className="m">A little more, please: at least a few lines.</p>}
        </>
      )}
      {fileError && <p className="af-err">{fileError}</p>}
    </div>
  );
}

function Consent({ o, busy, act }: { o: PackOverview; busy: boolean; act: Act }) {
  if (o.ai.reason === "AI_DISABLED" || o.ai.reason === "NO_PROVIDER") return <p className="rv-ai-note">Building a revision pack needs AI, which is switched off on this server.</p>;
  if (o.ai.reason !== "CONSENT_REQUIRED") return null;
  return (
    <div className="rv-ai-note" role="group" aria-label="AI notice">
      <p>
        <b>Building your revision sends</b> the text of the material above and the topic's outline to {o.ai.provider === "gwdg" ? "GWDG Academic Cloud" : o.ai.provider}, which
        writes the concepts and questions. Nothing else is sent: no history, no other topics, nothing that identifies you.
        {o.ai.provider === "gwdg" && " GWDG runs the models itself in Germany and states that it does not store what you send."}
      </p>
      <p>This is the same choice as the AI check of your answers. You can withdraw it in Account at any time.</p>
      <button className="btn primary" disabled={busy} onClick={() => void act(() => api.aiConsent())}>Accept</button>
    </div>
  );
}

function MaterialStep({ o, topicId, busy, act }: { o: PackOverview; topicId: string; busy: boolean; act: Act }) {
  const withText = o.materials.some((m) => m.hasText);
  return (
    <>
      <p className="sub">Paste a list or your notes, or add files. Blueprint turns them into a revision pack: the concepts you covered, with questions that get harder each cycle. It takes two to four minutes in the background.</p>
      {o.failed && <p className="af-err">The last build didn't finish: {o.failed.error ?? "unknown error"}</p>}
      <Materials o={o} topicId={topicId} busy={busy} act={act} />
      <Consent o={o} busy={busy} act={act} />
      <div className="rd-acts">
        <button className="btn primary" disabled={busy || !o.ai.available || !withText} onClick={() => void act(() => api.buildPack(topicId, "MATERIAL"))}>Build my revision</button>
        <button className="btn" disabled={busy || !o.ai.available} onClick={() => void act(() => api.buildPack(topicId, "OUTLINE"))}>Skip: use the topic outline</button>
      </div>
      {!withText && o.ai.available && <p className="m">Add your material first, or build from the topic outline (fewer, simpler questions).</p>}
    </>
  );
}

/* ---------------- building ---------------- */

function Building({ o }: { o: PackOverview }) {
  const p = o.building!.progress;
  const share = p && p.total ? Math.min(1, p.done / p.total) : 0;
  return (
    <div className="pk-building" role="status" aria-live="polite">
      <p>{p?.label ?? "Starting"}…</p>
      <div className="bar" aria-hidden="true"><i style={{ width: `${Math.round(share * 100)}%` }} /></div>
      {p?.concepts && (
        <ul className="pk-progress">
          {p.concepts.map((c) => <li key={c.title} className={c.done ? "done" : ""}>{c.done ? "✓" : "·"} {c.title}</li>)}
        </ul>
      )}
      <p className="m">You can close this; the pack keeps building and is here when you come back.</p>
    </div>
  );
}

/* ---------------- the pack ---------------- */

function Ready({ o, topicId, busy, act }: { o: PackOverview; topicId: string; busy: boolean; act: Act }) {
  const pack = o.pack!;
  const concepts = pack.concepts ?? [];
  const [adding, setAdding] = useState<{ title: string; summary: string } | null>(null);
  const [showMaterial, setShowMaterial] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const questions = concepts.filter((c) => !c.removed).reduce((a, c) => a + c.questions.total, 0);

  return (
    <>
      <p className="sub">
        {plural(questions, "question")} stored across levels 1–{pack.basis === "MATERIAL" ? 6 : 4}.
        {pack.basis === "OUTLINE" && " Based on the outline only: add your material for questions from what you actually studied."}
        {" "}Leave out anything that isn't in what you studied.
      </p>
      {o.failed && <p className="af-err">A rebuild didn't finish: {o.failed.error ?? "unknown error"} This pack is unchanged.</p>}
      {pack.stale && pack.basis === "MATERIAL" && (
        <div className="rv-ai-note">
          Your material changed since this pack was built.{" "}
          <button className="btn" disabled={busy || !o.ai.available} onClick={() => void act(() => api.buildPack(topicId, "MATERIAL"))}>Rebuild</button>
          <span className="m"> The current pack stays until the new one is ready.</span>
        </div>
      )}
      <ul className="pk-concepts" aria-label="Concepts">
        {concepts.map((c) => <ConceptRow key={c.id} c={c} busy={busy} act={act} />)}
      </ul>
      {adding ? (
        <div className="pk-add" role="group" aria-label="Add a concept">
          <input className="inp" aria-label="Concept" placeholder="A concept you studied" maxLength={100} value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} />
          <input className="inp" aria-label="What it covers (optional)" placeholder="What it covers (optional)" maxLength={600} value={adding.summary} onChange={(e) => setAdding({ ...adding, summary: e.target.value })} />
          <div className="pk-row">
            <button className="btn primary" disabled={busy || !adding.title.trim() || !o.ai.available}
              onClick={async () => (await act(() => api.addConcept(topicId, { title: adding.title.trim(), summary: adding.summary.trim() || undefined }))) && setAdding(null)}>Add and write its questions</button>
            <button className="link" onClick={() => setAdding(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="pk-row"><button className="btn" disabled={busy} onClick={() => setAdding({ title: "", summary: "" })}>Add a concept</button></div>
      )}

      <div className="pk-more">
        <button className="link" aria-expanded={showMaterial} onClick={() => setShowMaterial((x) => !x)}>
          {showMaterial ? "Hide your material" : `Your material (${o.materials.length})`}
        </button>
        {showMaterial && <Materials o={o} topicId={topicId} busy={busy} act={act} />}
        {showMaterial && <Consent o={o} busy={busy} act={act} />}
        <span className="m">Version {pack.version} · {pack.model}</span>
        {confirmDelete ? (
          <span className="pk-row">
            <span>Delete this pack and its questions? Your material stays.</span>
            <button className="btn danger" disabled={busy} onClick={() => void act(() => api.deletePack(topicId))}>Delete pack</button>
            <button className="link" onClick={() => setConfirmDelete(false)}>Keep it</button>
          </span>
        ) : (
          <button className="link" onClick={() => setConfirmDelete(true)}>Delete pack…</button>
        )}
      </div>
    </>
  );
}

function ConceptRow({ c, busy, act }: { c: PackConcept; busy: boolean; act: Act }) {
  const [open, setOpen] = useState(false);
  const levels = Object.keys(c.questions.levels).map(Number).sort((a, b) => a - b);
  return (
    <li className={`pk-concept${c.removed ? " removed" : ""}`}>
      <div className="pk-ctop">
        <div>
          <b>{c.title}</b>
          {c.subtopicName && <span className="pk-chip">{c.subtopicName}</span>}
          {c.source === "LEARNER" && <span className="pk-chip">added by you</span>}
          <p>{c.summary}</p>
          <span className="m">
            {c.status === "BUILDING" ? "Writing its questions…"
              : c.removed ? "Left out: not asked in revision"
              : `${plural(c.questions.total, "question")}${levels.length ? ` · levels ${levels[0]}–${levels[levels.length - 1]}` : ""}${c.status === "NEEDS_QUESTIONS" ? " · some levels have no question yet; simple fixed questions fill in" : ""}`}
          </span>
        </div>
        <div className="pk-cacts">
          <button className="btn" disabled={busy} aria-label={c.removed ? `Bring back ${c.title}` : `Leave out ${c.title}`}
            onClick={() => void act(() => api.patchConcept(c.id, { removed: !c.removed }))}>{c.removed ? "Bring back" : "Not in what I studied"}</button>
          {!c.removed && c.questions.total > 0 && (
            <button className="link" aria-expanded={open} onClick={() => setOpen((x) => !x)}>{open ? "Hide questions" : "Show questions"}</button>
          )}
        </div>
      </div>
      {open && <Items conceptId={c.id} busy={busy} act={act} />}
    </li>
  );
}

/* ---------------- questions (answers included) ---------------- */

function Items({ conceptId, busy, act }: { conceptId: number; busy: boolean; act: Act }) {
  const [items, setItems] = useState<PackItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    api.conceptItems(conceptId).then((x) => live && setItems(x), (e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [conceptId, n]);
  if (error) return <p className="af-err">{error}</p>;
  if (!items) return <p className="m">Loading questions…</p>;
  const change = async (f: () => Promise<unknown>) => (await act(f)) && setN((x) => x + 1);
  const levels = [...new Set(items.map((i) => i.level))].sort((a, b) => a - b);
  return (
    <div className="pk-items">
      <p className="m">These include the answers. Looking now makes the revision easier, so skim only to check they fit what you studied.</p>
      {levels.map((l) => (
        <section key={l} aria-label={`Level ${l}`}>
          <h4>Level {l} · {LEVEL_LABEL[l]}</h4>
          <ul>{items.filter((i) => i.level === l).map((i) => <ItemRow key={i.id} i={i} busy={busy} change={change} />)}</ul>
        </section>
      ))}
    </div>
  );
}

function ItemRow({ i, busy, change }: { i: PackItem; busy: boolean; change: (f: () => Promise<unknown>) => Promise<unknown> }) {
  const [edit, setEdit] = useState<{ question: string; expected: string } | null>(null);
  const [answer, setAnswer] = useState(false);
  return (
    <li className={`pk-item${i.removed ? " removed" : ""}`}>
      <div className="pk-ikind">{KIND_LABEL[i.kind] ?? i.kind}{i.answerSize && ` · ${i.answerSize}`}{i.source === "EDITED" && " · edited"}{i.removed && " · removed"}</div>
      {edit ? (
        <div className="pk-edit">
          <textarea className="inp" rows={2} aria-label="Question" value={edit.question} onChange={(e) => setEdit({ ...edit, question: e.target.value })} />
          <textarea className="inp" rows={4} aria-label="Expected points, one per line" value={edit.expected} onChange={(e) => setEdit({ ...edit, expected: e.target.value })} />
          <div className="pk-row">
            <button className="btn primary" disabled={busy || !edit.question.trim() || !edit.expected.trim()}
              onClick={async () => {
                const expected = edit.expected.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 6);
                await change(() => api.patchItem(i.id, { question: edit.question.trim(), expected }));
                setEdit(null);
              }}>Save</button>
            <button className="link" onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          {i.situation && <p className="pk-sit">{i.situation}</p>}
          {i.code && <pre className="pk-code"><code>{i.code}</code></pre>}
          <p className="pk-q">{i.question}</p>
          {i.options && (
            <ul className="pk-opts">
              {i.options.map((x, k) => (
                <li key={k} className={answer && x.correct ? "right" : ""}>
                  {x.text}
                  {answer && <span className="m"> · {x.correct ? "correct" : "wrong"}: {x.explanation}</span>}
                </li>
              ))}
            </ul>
          )}
          {answer && (
            <div className="pk-ans">
              <div><b>Expected</b><ul>{i.expected.map((e, k) => <li key={k}>{e}</li>)}</ul></div>
              <div><b>Model answer</b><p>{i.modelAnswer}</p></div>
              <div><b>Hints</b><ol>{i.hints.map((h, k) => <li key={k}>{h}</li>)}</ol></div>
            </div>
          )}
          <div className="pk-row">
            <button className="link" aria-expanded={answer} onClick={() => setAnswer((x) => !x)}>{answer ? "Hide answer" : "Show answer"}</button>
            {!i.removed && <button className="link" onClick={() => setEdit({ question: i.question, expected: i.expected.join("\n") })}>Edit</button>}
            <button className="link" disabled={busy} onClick={() => void change(() => api.patchItem(i.id, { removed: !i.removed }))}>{i.removed ? "Restore" : "Remove"}</button>
          </div>
        </>
      )}
    </li>
  );
}

/* ---------------- entry in the topic panel ---------------- */

/** One line in the topic panel: the pack's state, and the button that opens it. */
export function PackEntry({ topicId, topicName }: { topicId: string; topicName: string }) {
  const [o, setO] = useState<PackOverview | null>(null);
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    api.pack(topicId).then((x) => live && setO(x), () => live && setO(null));
    return () => {
      live = false;
    };
  }, [topicId, n]);
  if (!o) return null;
  const live = liveConcepts(o);
  const state = o.building ? "Building…" : o.pack ? `${plural(live.length, "concept")} · ${plural(live.reduce((a, c) => a + c.questions.total, 0), "question")}${o.pack.stale ? " · material changed" : ""}` : "Not prepared: add what you studied";
  return (
    <div className="pk-entry">
      <span><b>Revision pack</b> <span className="m">{state}</span></span>
      <button className="btn" aria-label={`Revision pack: ${topicName}`} onClick={() => setOpen(true)}>{o.pack || o.building ? "Open" : "Prepare"}</button>
      {open && <PackDialog topicId={topicId} topicName={topicName} onClose={() => { setOpen(false); setN((x) => x + 1); }} />}
    </div>
  );
}
