/**
 * The results' main column: the learner's answer next to the checklist, one row per point (gap-first results). Your words
 * on the left (the stretch of your own text the grader quoted), the complete point on the right; a missed point leaves an
 * empty slot opposite it. Everything here is shown from what was graded: nothing is rewritten and nothing changes the score.
 * Narrow containers stack each row (your words above the complete point).
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { RecallAnswer, RecallPointView, RecallReview } from "../../api/types";
import { plural } from "../../lib/format";
import { ChevronDown, Chevron, Glyph, More } from "./icons";

type Run = (f: () => Promise<RecallReview>) => Promise<boolean>;
type Status = NonNullable<RecallPointView["status"]>;

const TIERS = [[1, "Definition"], [2, "How it works"], [3, "Edge cases"]] as const;
const STATUS: Record<Status, string> = { ACCURATE: "Remembered", PARTIAL: "Partly", MISSED: "Missed" };
const TONE: Record<Status, "ok" | "part" | "miss"> = { ACCURATE: "ok", PARTIAL: "part", MISSED: "miss" };
const FOCUS_KEY = "bp.recall.focusGaps";
/** How many sentences "Also in your answer" lists before the whole answer is the way to see the rest. */
const ALSO_SHOWN = 4;
/** Longer sentences are cut at a word near this many characters; the whole answer shows them in full. */
const EXCERPT = 240;
const excerpt = (t: string) => {
  if (t.length <= EXCERPT) return t;
  const cut = t.lastIndexOf(" ", EXCERPT);
  return `${t.slice(0, cut > EXCERPT / 2 ? cut : EXCERPT).trimEnd()}…`;
};

const readFocus = () => {
  try {
    return localStorage.getItem(FOCUS_KEY) === "1";
  } catch {
    return false;
  }
};
const saveFocus = (on: boolean) => {
  try {
    localStorage.setItem(FOCUS_KEY, on ? "1" : "0");
  } catch {
    /* per-viewer convenience only */
  }
};

type Mark = { start: number; end: number; cls: string };

/** `text` cut where marks begin and end, each piece with the classes of the marks over it. */
export function segments(text: string, marks: Mark[]): { text: string; cls: string }[] {
  const cuts = new Set([0, text.length]);
  for (const m of marks) {
    cuts.add(Math.max(0, Math.min(text.length, m.start)));
    cuts.add(Math.max(0, Math.min(text.length, m.end)));
  }
  const at = [...cuts].sort((a, b) => a - b);
  const out: { text: string; cls: string }[] = [];
  for (let i = 0; i + 1 < at.length; i++) {
    const [a, b] = [at[i], at[i + 1]];
    if (a === b) continue;
    const cls = [...new Set(marks.filter((m) => m.start <= a && m.end >= b).map((m) => m.cls))].join(" ");
    out.push({ text: text.slice(a, b), cls });
  }
  return out;
}

const Marked = ({ text, marks }: { text: string; marks: Mark[] }) => (
  <>{segments(text, marks).map((s, i) => (s.cls ? <mark key={i} className={s.cls}>{s.text}</mark> : <span key={i}>{s.text}</span>))}</>
);

/** The learner's own words for a point: the stretches of the graded text it was found in, mistakes in them underlined. */
function yourWords(p: RecallPointView, answer: RecallAnswer | undefined) {
  const stretches = answer?.spans.filter((s) => s.kind === "point" && s.pointId === p.id) ?? [];
  if (!answer || !stretches.length) return p.evidence ? <>“{p.evidence}”</> : null;
  const claims = answer.spans.filter((s) => s.kind === "claim");
  return (
    <>
      “{stretches.map((s, i) => (
        <span key={i}>
          {i > 0 && " … "}
          <Marked text={answer.text.slice(s.start, s.end)}
            marks={claims.filter((c) => c.start < s.end && c.end > s.start).map((c) => ({ start: c.start - s.start, end: c.end - s.start, cls: "cmp-wrong" }))} />
        </span>
      ))}”
    </>
  );
}

export function Comparison({ r, busy, run }: { r: RecallReview; busy: boolean; run: Run }) {
  const res = r.result!;
  const counted = res.points.filter((p) => !p.leftOut);
  const gaps = counted.filter((p) => p.status === "MISSED" || p.status === "PARTIAL");
  const count = (s: Status) => counted.filter((p) => p.status === s).length;
  const [focus, setFocus] = useState(readFocus);
  const [whole, setWhole] = useState(false);
  const [pulse, setPulse] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const toggleFocus = () => {
    setFocus((x) => {
      saveFocus(!x);
      return !x;
    });
  };
  const goTo = (id: number) => {
    const row = document.getElementById(`cmp-${r.id}-${id}`);
    if (!row) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView?.({ behavior: still ? "auto" : "smooth", block: "center" });
    row.focus({ preventScroll: true });
    setPulse(id);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPulse(null), 1600);
  };

  const answer = res.answer;
  const statusOf = new Map(res.points.map((p) => [p.id, p]));
  const wholeMarks: Mark[] = (answer?.spans ?? []).flatMap((s): Mark[] => {
    if (s.kind === "claim") return [{ start: s.start, end: s.end, cls: "cmp-wrong" }];
    const p = statusOf.get(s.pointId);
    return p && !p.leftOut && p.status ? [{ start: s.start, end: s.end, cls: `cmp-hit ${TONE[p.status]}` }] : [];
  });
  const also = answer?.uncovered ?? [];

  return (
    <div className={`cmp${focus ? " focus" : ""}`}>
      <div className="cmp-head">
        <div className="g-pills" role="list" aria-label="Summary">
          {(["ACCURATE", "PARTIAL", "MISSED"] as const).map((s) => count(s) > 0 && (
            <span key={s} role="listitem" className={`g-sb ${TONE[s]}`}>{count(s)} {STATUS[s].toLowerCase()}</span>
          ))}
        </div>
        {gaps.length > 0 && (
          <button type="button" className="g-pill cmp-toggle" aria-pressed={focus} onClick={toggleFocus}>{focus ? "Show all" : "Focus on gaps"}</button>
        )}
      </div>
      {gaps.length > 0 && (
        <p className="cmp-gaps">
          <span>{gaps.length > 1 ? "Gaps:" : "Gap:"}</span>
          {gaps.map((p) => <button key={p.id} type="button" className="g-link" onClick={() => goTo(p.id)}>{p.label}</button>)}
        </p>
      )}

      <div className="cmp-cols" aria-hidden="true"><span>Your words</span><span>The complete point</span></div>
      {TIERS.map(([tier, name]) => {
        const rows = counted.filter((p) => p.tier === tier);
        return rows.length > 0 && (
          <section key={tier} aria-label={name}>
            <h3 className="g-cap">{name} <span className="g-r">{plural(rows.length, "point")}</span></h3>
            <ul className="g-group cmp-list">
              {rows.map((p) => <Row key={p.id} r={r} p={p} answer={answer} busy={busy} run={run} pulse={pulse === p.id} />)}
            </ul>
          </section>
        );
      })}
      {res.points.some((p) => p.leftOut) && (
        <section aria-label="Left out">
          <h3 className="g-cap">Left out · not counted</h3>
          <ul className="g-group cmp-list">
            {res.points.filter((p) => p.leftOut).map((p) => <Row key={p.id} r={r} p={p} answer={answer} busy={busy} run={run} pulse={false} />)}
          </ul>
        </section>
      )}

      {answer && also.length > 0 && (
        <section aria-label="Also in your answer">
          <h3 className="g-cap">Also in your answer <span className="g-r">Sentences with no matched words</span></h3>
          <ul className="g-group cmp-also">
            {also.slice(0, ALSO_SHOWN).map((x, i) => (
              <li key={i}>{excerpt(answer.text.slice(x.start, x.end))}</li>
            ))}
          </ul>
          {also.length > ALSO_SHOWN && <p className="g-foot">{plural(also.length - ALSO_SHOWN, "more sentence")} in your whole answer.</p>}
        </section>
      )}

      {answer && answer.text && (
        <div className="cmp-whole">
          <button type="button" className="g-link" aria-expanded={whole} onClick={() => setWhole((x) => !x)}>
            {whole ? <ChevronDown /> : <Chevron />}{whole ? "Hide your whole answer" : "Show your whole answer"}
          </button>
          {whole && (
            <>
              <p className="cmp-key" aria-hidden="true">
                <mark className="cmp-hit ok">remembered</mark> <mark className="cmp-hit part">partly</mark> <mark className="cmp-wrong">to correct</mark>
              </p>
              <div className="g-group cmp-text" aria-label="Your whole answer"><Marked text={answer.text} marks={wholeMarks} /></div>
            </>
          )}
        </div>
      )}
      <p className="g-foot">A point that isn't part of this sub-topic? Its ⋯ menu leaves it out of the score from now on.</p>
    </div>
  );
}

function Row({ r, p, answer, busy, run, pulse }: { r: RecallReview; p: RecallPointView; answer: RecallAnswer | undefined; busy: boolean; run: Run; pulse: boolean }) {
  const [menu, setMenu] = useState(false);
  const toggle = () => {
    setMenu(false);
    void run(async () => (await api.leaveOutPoint(p.id, !p.leftOut)).review ?? api.recallReview(r.id));
  };
  const status = p.status;
  const gap = status === "MISSED" || status === "PARTIAL";
  const words = status && status !== "MISSED" ? yourWords(p, answer) : null;
  const cls = ["cmp-row", status ? TONE[status] : "", p.leftOut ? "out" : "", pulse ? "pulse" : ""].filter(Boolean).join(" ");

  return (
    <li id={`cmp-${r.id}-${p.id}`} className={cls} tabIndex={-1} aria-label={`${p.label}: ${status ? STATUS[status] : "not graded"}`}>
      <div className="cmp-you">
        <span className="cmp-k">Your words</span>
        {words ? (
          <>
            <span className={`g-sb ${TONE[status!]}`}>{STATUS[status!]}</span>
            <p className="cmp-quote">{words}</p>
          </>
        ) : (
          <p className="cmp-ghost"><Glyph kind="miss" />{status === "MISSED" ? "Missed: not in your answer" : "Not graded"}</p>
        )}
        {p.recalledWhenAsked && <span className="g-sb out">↑ recalled when asked</span>}
      </div>
      <div className={`cmp-point${gap && !p.leftOut ? " learn" : ""}`}>
        <span className="cmp-k">{status === "PARTIAL" ? "The full point" : "The complete point"}</span>
        <div className="cmp-pt">
          <b>{p.label}</b>
          {gap && !p.leftOut && <span className="g-sb part cmp-new">To learn</span>}
          <span className="g-menu-wrap">
            <button type="button" className="g-link quiet" aria-label={`Options for ${p.label}`} aria-expanded={menu} onClick={() => setMenu((x) => !x)}><More /></button>
            {menu && (
              <div className="g-menu">
                <button type="button" disabled={busy} onClick={toggle}>
                  {p.leftOut ? "Count it again" : "Not part of this sub-topic"}
                  <small>{p.leftOut ? "It counts in the score again." : "Leaves it out of the score from now on."}</small>
                </button>
              </div>
            )}
          </span>
        </div>
        <p>{p.description}</p>
      </div>
    </li>
  );
}
