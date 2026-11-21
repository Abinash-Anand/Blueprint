/**
 * The Revision tab (docs/Recall-Plan.md §3.1) in glass (DESIGN.md §10): the one recall to do next, then grouped lists
 * of what is due today within the daily limit, what waits for a free day, the next two weeks, recent recalls (each
 * opens its history over time) and the earlier revision systems' history, read-only.
 */
import { useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import type { RecallHistoryRow, RecallHome, RecallItem, RevisionArchive } from "../api/types";
import { CHECKPOINT_RESULTS, METHOD_LABEL, dayMonth, plural, scoreLabel } from "../lib/format";
import { useAppData } from "../state/AppData";
import { Chevron, ChevronDown, Spark } from "./recall/icons";
import { historyHash, openPage, recallHash } from "../lib/nav";
import { Sheet } from "./recall/Sheet";
import { Loading } from "./ui";

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");
const DEPTH = { FOUNDATIONAL: "Foundational", INTERMEDIATE: "Intermediate", MASTERY: "Mastery" } as const;
const OUTCOME = { PASS: "remembered well", HOLD: "partly remembered", LAPSE: "mostly forgotten" } as const;
const TONE = { PASS: "ok", HOLD: "part", LAPSE: "miss" } as const;
const OPEN = { DRAFT: "Started", WAITING: "Being checked", CHECKED: "Results ready", COMPLETE: "" } as const;

export function RevisionView() {
  const { version, invalidate, topicById, districtById } = useAppData();
  const [h, setH] = useState<RecallHome | null>(null);
  const [a, setA] = useState<RevisionArchive | null>(null);
  const [hist, setHist] = useState<RecallHistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.recallHome(), api.revisionArchive(), api.recallHistory()]).then(
      ([x, y, z]) => live && (setH(x), setA(y), setHist(z), setError(null)),
      (e) => live && setError(errText(e)),
    );
    return () => {
      live = false;
    };
  }, [version]);

  if (error) return <div className="view gl gl-bg"><div className="wrap"><p className="g-err">{error}</p></div></div>;
  if (!h || !a) return <div className="view gl gl-bg"><Loading /></div>;

  const status = (s: RecallItem) => h.open.find((o) => o.subtopicId === s.subtopicId)?.status;
  const color = (s: RecallItem) => districtById?.get(topicById?.get(s.topicId)?.districtId ?? "")?.color;
  const next = h.due[0] ?? h.later[0] ?? null;
  const soon = next ? null : h.upcoming[0] ?? null;
  const can = h.ai.available;
  // With nothing due, the next two weeks move into the first column so the page never opens on an empty half.
  const upcomingFirst = !h.due.length && !h.later.length && h.upcoming.length > 0;
  const upcoming = h.upcoming.length > 0 && (
    <>
      <h3 className="g-cap">Next two weeks <span className="g-r">{h.upcoming.length}</span></h3>
      <ul className="g-group">
        {h.upcoming.map((s) => (
          <li key={s.subtopicId}>
            <button type="button" className="g-row" disabled={!can} onClick={() => openPage(recallHash(s.subtopicId))} aria-label={`Revise ${s.subtopic} early`}>
              <span className="g-lbl">{s.subtopic}<small>{s.topic}</small></span>
              <span className="g-val">{dayMonth(s.scheduledDate)}</span>
              <Chevron />
            </button>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <div className="view gl gl-bg">
      <div className="wrap">
        <div className="kick">Revision · active recall</div>
        <h2 className="g-lt">{h.due.length ? `${plural(h.due.length, "sub-topic")} to recall today` : "Nothing to recall today"}</h2>
        <p className="g-sub">
          Say or type everything you remember. The AI checks it against a checklist you see afterwards.
          {" "}Up to {plural(h.limit, "review")} planned a day{h.doneToday ? ` · ${h.doneToday} done today${h.doneToday > h.limit ? `, ${h.doneToday - h.limit} extra` : ""}` : ""}.
        </p>

        <AiNotice h={h} onAccepted={() => void invalidate()} />

        {next && (
          <section className="g-hero" aria-label="Up next">
            <div className="g-grow">
              <div className="kick">Up next</div>
              <div className="g-hero-name"><span className="g-dot" style={{ background: color(next) }} />{next.subtopic}</div>
              <p className="g-sub">{next.topic} · {next.district} · {next.lastReviewDate ? `last recalled ${dayMonth(next.lastReviewDate)}` : "first recall"}{status(next) ? ` · ${OPEN[status(next)!].toLowerCase()}` : ""}</p>
            </div>
            <NotToday s={next} onDone={() => void invalidate()} />
            <button type="button" className="btn primary big" disabled={!can} onClick={() => openPage(recallHash(next.subtopicId))}>
              {status(next) === "CHECKED" ? "See results" : status(next) ? "Continue" : "Start recall"}
            </button>
          </section>
        )}

        {soon && (
          <section className="g-hero quiet" aria-label="Next recall">
            <div className="g-grow">
              <div className="kick">Next recall · {dayMonth(soon.scheduledDate)}</div>
              <div className="g-hero-name"><span className="g-dot" style={{ background: color(soon) }} />{soon.subtopic}</div>
              <p className="g-sub">{soon.topic} · {soon.district} · {soon.lastReviewDate ? `last recalled ${dayMonth(soon.lastReviewDate)}` : "first recall"}</p>
            </div>
            <button type="button" className="btn quiet big" disabled={!can} onClick={() => openPage(recallHash(soon.subtopicId))} aria-label={`Recall ${soon.subtopic} early`}>Recall early</button>
          </section>
        )}

        <div className="g-cols">
          <div>
            {h.due.length > 0 && (
              <>
                <h3 className="g-cap">Due today <span className="g-r">{h.due.length}</span></h3>
                <ul className="g-group">
                  {h.due.map((s) => (
                    <li key={s.subtopicId}>
                      <button type="button" className="g-row" disabled={!can} onClick={() => openPage(recallHash(s.subtopicId))} aria-label={`Revise ${s.subtopic}`}>
                        <span className="g-dot" style={{ background: color(s) }} />
                        <span className="g-lbl">
                          {s.subtopic}
                          <small>
                            {s.topic} · {s.overdueDays > 0 ? <b className="rc-late">{plural(s.overdueDays, "day")} overdue · </b> : null}
                            {s.lastReviewDate ? `last recalled ${dayMonth(s.lastReviewDate)}` : "first recall"}
                          </small>
                        </span>
                        {status(s) && OPEN[status(s)!] && <span className="g-sb info">{OPEN[status(s)!]}</span>}
                        <Chevron />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {h.later.length > 0 && (
              <>
                <h3 className="g-cap">Waiting for a free day <span className="g-r">{h.later.length}</span></h3>
                <ul className="g-group">
                  {h.later.map((s) => (
                    <li key={s.subtopicId}>
                      <button type="button" className="g-row" disabled={!can} onClick={() => openPage(recallHash(s.subtopicId))} aria-label={`Revise ${s.subtopic} now`}>
                        <span className="g-lbl">{s.subtopic}<small>{s.topic}</small></span>
                        <span className="g-val">since {dayMonth(s.nextDueDate!)}</span>
                        <Chevron />
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="g-foot">Today's limit is {plural(h.limit, "recall")}, so these wait for a lighter day. Open one to recall it now.</p>
              </>
            )}

            {upcomingFirst && upcoming}

            {!h.due.length && !h.later.length && !h.upcoming.length && (
              <>
                <h3 className="g-cap">How revision starts</h3>
                <div className="g-group"><p className="g-row" style={{ margin: 0 }}>When you tick a sub-topic as learned, its first recall is due the next day and shows up here and on Today.</p></div>
              </>
            )}
          </div>

          <div>
            {!upcomingFirst && upcoming}

            {hist.length > 0 && (
              <>
                <h3 className="g-cap">Recent recalls <span className="g-r">{hist.length}</span></h3>
                <ul className="g-group">
                  {hist.map((r) => (
                    <li key={r.reviewId}>
                      <button type="button" className="g-row" onClick={() => openPage(historyHash("revision", r.subtopicId))} aria-label={`Recall over time: ${r.subtopic}`}>
                        <span className="g-lbl">
                          {r.subtopic}
                          <small>{dayMonth(r.date)} · {DEPTH[r.depth]} · {OUTCOME[r.outcome]}{r.nextDueDate ? ` · next ${dayMonth(r.nextDueDate)}` : ""}</small>
                        </span>
                        <span className={`g-sb ${TONE[r.outcome]}`}>{Math.round(r.score * 100)} %</span>
                        <Chevron />
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="g-foot">Open one to see every point across your recalls.</p>
              </>
            )}

            <Archive a={a} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Not today" on the next recall: moves it to the next free day. */
function NotToday({ s, onDone }: { s: RecallItem; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn quiet big" disabled={busy} aria-label={`Not today: ${s.subtopic}`}
      onClick={() => {
        setBusy(true);
        void api.postponeRecall(s.subtopicId).then(onDone, () => undefined).finally(() => setBusy(false));
      }}>
      Not today
    </button>
  );
}

/** The AI notice for recall (§11): a sheet on the first visit; recall needs it. "Not now" leaves a short reminder. */
function AiNotice({ h, onAccepted }: { h: RecallHome; onAccepted: () => void }) {
  const [shown, setShown] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (h.ai.reason === "AI_DISABLED" || h.ai.reason === "NO_PROVIDER") {
    return <div className="g-callout info" style={{ marginTop: 14 }}><span>Recall needs the AI check, which is switched off on this server.</span></div>;
  }
  if (h.ai.reason !== "CONSENT_REQUIRED") return null;
  const accept = async () => {
    setBusy(true);
    try {
      await api.aiConsent();
      setShown(false);
      onAccepted();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const provider = h.ai.provider === "gwdg" ? "GWDG Academic Cloud" : h.ai.provider;
  return (
    <>
      <div className="g-callout info" style={{ marginTop: 14 }}>
        <span style={{ flex: 1 }}><span className="h">Recall needs your OK to use AI</span>Nothing is sent until you accept.</span>
        <button type="button" className="btn" onClick={() => setShown(true)}>Review</button>
      </div>
      {shown && (
        <Sheet labelledBy="ai-notice-title" onClose={() => setShown(false)}>
          <Spark />
          <h2 id="ai-notice-title" className="g-t2" style={{ margin: "14px 0 6px" }}>Recall uses AI</h2>
          <p className="g-sub" style={{ color: "var(--ink)" }}>
            To check your recall, Blueprint sends a few things to {provider}, which checks them against the sub-topic's checklist.
            {h.ai.provider === "gwdg" && " GWDG runs the models itself in Germany and states that it does not store what you send."}
          </p>
          <h3 className="g-cap" style={{ marginTop: 18 }}>What is sent</h3>
          <ul className="g-group" aria-label="What is sent">
            <li className="g-row"><span className="g-lbl">Your recording<small>To write it down; never stored</small></span></li>
            <li className="g-row"><span className="g-lbl">What you said or typed</span></li>
            <li className="g-row"><span className="g-lbl">Photos of sketches you add<small>Described once; never stored</small></span></li>
            <li className="g-row"><span className="g-lbl">Your answer to a follow-up question</span></li>
            <li className="g-row"><span className="g-lbl">The sub-topic's names</span></li>
          </ul>
          <p className="g-foot">Nothing else is sent: no history, no other sub-topics, nothing that identifies you. You can withdraw this in Account at any time.</p>
          {error && <p className="g-err" role="alert">{error}</p>}
          <div className="g-sheet-acts">
            <button type="button" className="btn quiet big" onClick={() => setShown(false)}>Not now</button>
            <button type="button" className="btn primary big" disabled={busy} onClick={() => void accept()}>Accept</button>
          </div>
        </Sheet>
      )}
    </>
  );
}

/** The retired revision systems' history (§9), read-only, folded into one row. */
function Archive({ a }: { a: RevisionArchive }) {
  const [open, setOpen] = useState(false);
  const rows = [
    ...a.attempts.map((x) => ({ key: `a${x.id}`, date: x.date, kind: "attempt" as const, x })),
    ...a.checkpoints.map((x) => ({ key: `c${x.id}`, date: x.date, kind: "check" as const, x })),
  ].sort((p, q) => q.date.localeCompare(p.date));
  if (!rows.length) return null;
  return (
    <>
      <h3 className="g-cap">Earlier</h3>
      <div className="g-group">
        <button type="button" className="g-row" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
          <span className="g-lbl">Earlier revision<small>From the revision systems before recall, kept as history</small></span>
          <span className="g-val">{rows.length}</span>
          {open ? <ChevronDown /> : <Chevron />}
        </button>
        {open && (
          <ul className="g-hist" aria-label="Earlier revision">
            {rows.map((r) =>
              r.kind === "attempt" ? (
                <li key={r.key}>
                  <b>{dayMonth(r.date)}</b> · {r.x.label} <span className="g-small">({r.x.topicName})</span> · {r.x.score} {scoreLabel(r.x.score)}
                  <span className="g-small"> · {METHOD_LABEL[r.x.method as keyof typeof METHOD_LABEL] ?? r.x.method}{r.x.withHelp ? " · with help" : ""}</span>
                  {r.x.gap && <div className="g-small">Gap: {r.x.gap}</div>}
                </li>
              ) : (
                <li key={r.key}>
                  <b>{dayMonth(r.date)}</b> · {r.x.label} <span className="g-small">({r.x.topicName})</span> · check: {CHECKPOINT_RESULTS.find((c) => c.result === r.x.result)?.label ?? r.x.result}
                  {r.x.gaps && <div className="g-small">Gap: {r.x.gaps}</div>}
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </>
  );
}
