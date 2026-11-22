/**
 * The results' main column as short screens, one kind of result each (DESIGN.md §10, results): what to correct,
 * what was partly there, what was missed, and what was remembered with the whole answer. A screen with nothing in it is
 * left out, so there are at most four. The step bar names every screen and how many points it holds, so nothing is
 * hidden behind Next; Back, Next and the arrow keys move between them. Everything is shown from what was graded:
 * nothing is rewritten and nothing changes the score. The complete point is its statement once written, else the
 * grader's description.
 */
import { type KeyboardEvent, useState } from "react";
import { api } from "../../api/client";
import type { RecallAnswer, RecallPointView, RecallReview } from "../../api/types";
import { dayMonth, plural } from "../../lib/format";
import { Back, Chevron, ChevronDown, More } from "./icons";

type Run = (f: () => Promise<RecallReview>) => Promise<boolean>;
type Status = NonNullable<RecallPointView["status"]>;
type Result = NonNullable<RecallReview["result"]>;

export const STATUS: Record<Status, string> = { ACCURATE: "Remembered", PARTIAL: "Partly", MISSED: "Missed" };
const TONE: Record<Status, "ok" | "part" | "miss"> = { ACCURATE: "ok", PARTIAL: "part", MISSED: "miss" };
const TIER: Record<number, string> = { 1: "Definition", 2: "How it works", 3: "Edge cases" };

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

type Key = "correct" | "partly" | "missed" | "remembered";
interface Screen { key: Key; name: string; count: number; tone: "miss" | "part" | "neutral" | "ok" }

/** The screens this result needs, worst first; the last one also carries your whole answer and any left-out points. */
export function screensFor(res: Result): Screen[] {
  const counted = res.points.filter((p) => !p.leftOut);
  const n = (s: Status) => counted.filter((p) => p.status === s).length;
  const last = n("ACCURATE") > 0 || !!res.answer?.text || res.points.some((p) => p.leftOut);
  const all: (Screen | false)[] = [
    res.misconceptions.length > 0 && { key: "correct", name: "To correct", count: res.misconceptions.length, tone: "miss" },
    n("PARTIAL") > 0 && { key: "partly", name: "Partly", count: n("PARTIAL"), tone: "part" },
    n("MISSED") > 0 && { key: "missed", name: "Missed", count: n("MISSED"), tone: "neutral" },
    last && { key: "remembered", name: n("ACCURATE") > 0 ? "Remembered" : "Your answer", count: n("ACCURATE"), tone: "ok" },
  ];
  return all.filter((s): s is Screen => !!s);
}

export function ResultScreens({ r, busy, run }: { r: RecallReview; busy: boolean; run: Run }) {
  const res = r.result!;
  const screens = screensFor(res);
  const [want, setWant] = useState<Key | null>(null);
  const at = Math.max(0, screens.findIndex((s) => s.key === want));
  const screen = screens[at];
  if (!screen) return null;
  const go = (i: number) => setWant(screens[Math.max(0, Math.min(screens.length - 1, i))].key);
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("textarea,input,.g-menu")) return;
    if (e.key === "ArrowRight") go(at + 1);
    else if (e.key === "ArrowLeft") go(at - 1);
    else return;
    e.preventDefault();
  };
  const next = screens[at + 1];

  return (
    <div className="rs" onKeyDown={onKey}>
      <nav className="rs-steps" aria-label="Result screens" style={{ gridTemplateColumns: `repeat(${screens.length}, minmax(0,1fr))` }}>
        {screens.map((s, i) => (
          <button key={s.key} type="button" className={`rs-step ${s.tone}${i <= at ? " seen" : ""}`} aria-current={i === at ? "step" : undefined}
            aria-label={s.count ? `${s.name}: ${plural(s.count, s.key === "correct" ? "idea" : "point")}` : s.name} onClick={() => go(i)}>
            <span className="rs-sn">{s.name}</span>
            {/* "Your answer" holds no points: it keeps the row's height without a 0. */}
            <b aria-hidden={!s.count}>{s.count || " "}</b>
            <i aria-hidden="true" />
          </button>
        ))}
      </nav>
      <p className="sr" aria-live="polite">{`${screen.name}, ${at + 1} of ${screens.length}`}</p>

      <section className="rs-screen" aria-label={screen.name}>
        {screen.key === "correct" && <Correct res={res} />}
        {screen.key === "partly" && <Points r={r} busy={busy} run={run} status="PARTIAL" lead="You had the idea; the complete point shows what a full answer says." />}
        {screen.key === "missed" && (
          <Points r={r} busy={busy} run={run} status="MISSED"
            lead={`Not in your answer. Read them once${res.nextDueDate ? `; they come back on ${dayMonth(res.nextDueDate)}` : ""}.`} />
        )}
        {screen.key === "remembered" && <Remembered r={r} busy={busy} run={run} />}
      </section>

      {screens.length > 1 && (
        <div className="rs-nav">
          <button type="button" className="btn quiet" disabled={at === 0} onClick={() => go(at - 1)}><Back />Back</button>
          <span className="rs-of">{at + 1} of {screens.length}</span>
          {next ? <button type="button" className="btn" onClick={() => go(at + 1)}>Next: {next.name}<Chevron /></button> : <span />}
        </div>
      )}
    </div>
  );
}

function Correct({ res }: { res: Result }) {
  return (
    <>
      <p className="rs-lead">{res.misconceptions.length > 1 ? "These ideas in your answer aren't right." : "One idea in your answer isn't right."} Start here.</p>
      <ul className="rs-list" aria-label="Misconceptions">
        {res.misconceptions.map((m, i) => (
          <li key={i} className="rs-item">
            <div className="rs-mine miss"><span className="g-sb miss">You said</span><p>“{m.claim}”</p></div>
            <span className="rs-k">Correct</span>
            <p className="rs-text">{m.correction}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

function Points({ r, busy, run, status, lead }: { r: RecallReview; busy: boolean; run: Run; status: Status; lead: string }) {
  const res = r.result!;
  const rows = res.points.filter((p) => !p.leftOut && p.status === status).sort((a, b) => a.tier - b.tier);
  return (
    <>
      <p className="rs-lead">{lead}</p>
      <ul className="rs-list">{rows.map((p) => <Point key={p.id} r={r} p={p} busy={busy} run={run} />)}</ul>
    </>
  );
}

function Remembered({ r, busy, run }: { r: RecallReview; busy: boolean; run: Run }) {
  const res = r.result!;
  const rows = res.points.filter((p) => !p.leftOut && p.status === "ACCURATE").sort((a, b) => a.tier - b.tier);
  const out = res.points.filter((p) => p.leftOut);
  const [whole, setWhole] = useState(rows.length === 0);
  const answer = res.answer;
  const statusOf = new Map(res.points.map((p) => [p.id, p]));
  const marks: Mark[] = (answer?.spans ?? []).flatMap((s): Mark[] => {
    if (s.kind === "claim") return [{ start: s.start, end: s.end, cls: "cmp-wrong" }];
    const p = statusOf.get(s.pointId);
    return p && !p.leftOut && p.status ? [{ start: s.start, end: s.end, cls: `cmp-hit ${TONE[p.status]}` }] : [];
  });
  return (
    <>
      <p className="rs-lead">{rows.length ? "What you recalled on your own." : "Nothing in your answer matched a point yet."}</p>
      {rows.length > 0 && <ul className="rs-list">{rows.map((p) => <Point key={p.id} r={r} p={p} busy={busy} run={run} />)}</ul>}
      {answer?.text && (
        <div className="rs-whole">
          <button type="button" className="g-link" aria-expanded={whole} onClick={() => setWhole((x) => !x)}>
            {whole ? <ChevronDown /> : <Chevron />}{whole ? "Hide your whole answer" : "Show your whole answer"}
          </button>
          {whole && (
            <>
              {marks.length > 0 && (
                <p className="cmp-key" aria-hidden="true">
                  <mark className="cmp-hit ok">remembered</mark> <mark className="cmp-hit part">partly</mark> <mark className="cmp-wrong">to correct</mark>
                </p>
              )}
              <div className="rs-text-box" aria-label="Your whole answer"><Marked text={answer.text} marks={marks} /></div>
            </>
          )}
        </div>
      )}
      {out.length > 0 && (
        <>
          <h3 className="g-cap">Left out · not counted</h3>
          <ul className="rs-list">{out.map((p) => <Point key={p.id} r={r} p={p} busy={busy} run={run} />)}</ul>
        </>
      )}
    </>
  );
}

function Point({ r, p, busy, run }: { r: RecallReview; p: RecallPointView; busy: boolean; run: Run }) {
  const [menu, setMenu] = useState(false);
  const toggle = () => {
    setMenu(false);
    void run(async () => (await api.leaveOutPoint(p.id, !p.leftOut)).review ?? api.recallReview(r.id));
  };
  const status = p.status;
  const words = status && status !== "MISSED" ? yourWords(p, r.result!.answer) : null;
  return (
    <li className={`rs-item${p.leftOut ? " out" : ""}`} aria-label={`${p.label}: ${status ? STATUS[status] : "not graded"}`}>
      <div className="rs-head">
        <b>{p.label}</b>
        <span className="rs-tier">{TIER[p.tier] ?? ""}</span>
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
      {words && (
        <div className={`rs-mine ${TONE[status!]}`}>
          {status === "PARTIAL" && <span className="g-sb part">Your words</span>}
          <p>{words}</p>
        </div>
      )}
      {status === "PARTIAL" && <span className="rs-k">The complete point</span>}
      {status !== "ACCURATE" && <p className="rs-text">{p.statement || p.description}</p>}
      {p.recalledWhenAsked && <span className="g-sb out">↑ recalled when asked</span>}
    </li>
  );
}
