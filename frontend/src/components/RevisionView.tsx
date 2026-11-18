/**
 * Revision section (Revision enhancement, SRS FR-REV-19 to FR-REV-22): what to retrieve now, what is weak, what is
 * coming, the history, and recall analytics, kept apart from learning and demonstration progress.
 * Read-only over the one revision schedule; every action goes through the existing recall dialog and APIs.
 */
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { RevisionOverview, RevisionUnitRow } from "../api/types";
import { CHECKPOINT_RESULTS, METHOD_LABEL, SCORES, dayMonth, hm, monthName, pct, plural, scoreLabel, shortDate } from "../lib/format";
import { useAppData } from "../state/AppData";
import { type RecallItem, RecallDialog } from "./RecallDialog";
import { RevisionStatus } from "./RevisionStatus";
import { Loading, Stat } from "./ui";

const asItem = (u: { topicId: string; scope: RevisionUnitRow["scope"]; subtopicId: number | null }): RecallItem => ({
  topicId: u.topicId, scope: u.scope, subtopicId: u.subtopicId, mode: "revision",
});

function UnitRow({ u, today, onRevise, onOpenTopic }: { u: RevisionUnitRow; today: string; onRevise: (u: RevisionUnitRow) => void; onOpenTopic: (id: string) => void }) {
  const { mutate } = useAppData();
  return (
    <li className="rv-row">
      <div className="rl-main">
        <span className="rl-name">
          {u.label}{" "}
          <button className="link" onClick={() => onOpenTopic(u.topicId)} aria-label={`Open topic ${u.topicName}`}>{u.scope === "TOPIC" ? "open" : u.topicName}</button>
        </span>
        <RevisionStatus
          x={{ correctionPending: u.correctionPending, nextDueDate: u.nextDueDate, lastAttemptDate: u.lastAttemptDate }}
          today={today}
          weak={u.weak}
          extra={[
            u.overdueDays > 0 ? `due ${shortDate(u.nextDueDate!)}` : "",
            u.lastAttemptDate ? `last ${dayMonth(u.lastAttemptDate)}: ${scoreLabel(u.lastScore)}` : "",
          ].filter(Boolean).join(" · ") || undefined}
        />
      </div>
      <div className="rl-acts">
        {u.correctionPending && u.pendingAttemptId ? (
          <button className="btn" onClick={() => void mutate(() => api.correctAttempt(u.pendingAttemptId!))} aria-label={`Confirm correction: ${u.label}`}>Corrected</button>
        ) : u.lastAttemptDate === today ? null : (
          // One attempt per unit per day: nothing to start for a unit already revised today.
          <button className={`btn${u.status === "SCHEDULED" ? "" : " primary"}`} onClick={() => onRevise(u)} aria-label={`Revise: ${u.label}`}>
            {u.status === "SCHEDULED" ? "Revise early" : "Revise"}
          </button>
        )}
      </div>
    </li>
  );
}

export function RevisionView({ onOpenTopic }: { onOpenTopic: (id: string) => void }) {
  const { version, progress } = useAppData();
  const [o, setO] = useState<RevisionOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recall, setRecall] = useState<RecallItem[] | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  useEffect(() => {
    let live = true;
    api.revisionOverview().then(
      (d) => live && (setO(d), setError(null)),
      (e) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [version]);

  if (error) return <div className="view"><div className="wrap"><div className="card empty">{error}</div></div></div>;
  if (!o) return <div className="view"><Loading /></div>;

  const c = o.counts;
  const now = c.due + c.overdue;
  const isSunday = new Date(`${o.today}T12:00:00Z`).getUTCDay() === 0;
  const revise = (u: RevisionUnitRow) => setRecall([asItem(u)]);
  const history = [
    ...o.history.map((a) => ({ key: `a${a.id}`, date: a.attemptDate, at: a.attemptedAt, kind: "attempt" as const, a })),
    ...o.checkpoints.map((k) => ({ key: `c${k.id}`, date: k.date, at: k.date, kind: "check" as const, k })),
  ].sort((x, y) => y.at.localeCompare(x.at));
  const shownHistory = showAllHistory ? history : history.slice(0, 8);
  const list = (title: string, rows: RevisionUnitRow[], note?: string) =>
    rows.length > 0 && (
      <div className="section">
        <h3>{title} · {rows.length}</h3>
        <div className="card">
          {note && <div className="sub" style={{ marginTop: 0, marginBottom: 6 }}>{note}</div>}
          <ul className="rlist">{rows.map((u) => <UnitRow key={u.scheduleId} u={u} today={o.today} onRevise={revise} onOpenTopic={onOpenTopic} />)}</ul>
        </div>
      </div>
    );

  return (
    <div className="view">
      <div className="wrap">
        <div className="vhead">
          <div>
            <div className="kick">Revision · as of {shortDate(o.today)}</div>
            <h2>{now ? `${plural(now, "revision")} due now` : c.active ? "Nothing due right now" : "Revision hasn't started yet"}</h2>
            <div className="sub">
              Retrieve from memory, check, correct. Tracked separately from learning (floors) and demonstration (roofs): it never moves the car.
              {isSunday && " Sunday: everything here is optional."}
            </div>
          </div>
          {o.session.length > 0 && (
            <div className="nav">
              <button className="btn primary" onClick={() => setRecall(o.session.map(asItem))}>Start session ({o.session.length})</button>
            </div>
          )}
        </div>

        <div className="grid4">
          <Stat label="Due now" value={now} detail={c.overdue ? <span className="delayed">{c.overdue} overdue</span> : "none overdue"} />
          <Stat label="Weak" value={c.weak} detail="failed twice or more in a row" />
          <Stat label="Next 14 days" value={c.upcoming} detail={c.later ? `${c.later} later` : "nothing later yet"} />
          <Stat label="In revision" value={c.active} detail={c.paused ? `${c.paused} paused (unticked)` : `${c.awaitingCorrection} awaiting correction`} />
        </div>

        {c.active === 0 && (
          <div className="card rest" style={{ marginTop: 16 }}>
            <h3>How revision starts</h3>
            <p>While you study, press <b>Check</b> next to a sub-topic in the topic panel to test yourself. When you tick a sub-topic as learned, its first revision is due the next day and shows up here and on Today.</p>
          </div>
        )}

        {list("Needs a correction", o.awaitingCorrection, "Go back to the material for the gap you noted, then confirm. The next attempt is blocked until then.")}
        {list("Overdue", o.overdue, "Weak units first, then the oldest due date.")}
        {list("Due today", o.due)}
        {list("Weak concepts", o.weak.filter((u) => u.status === "SCHEDULED"), "Weak units that aren't due yet. Revisiting the original material helps more than another question.")}
        {list(`Upcoming · next ${o.upcomingDays} days`, o.upcoming.filter((u) => !u.weak), o.upcoming.some((u) => u.weak) ? "Weak units are listed above." : undefined)}

        {history.length > 0 && (
          <div className="section">
            <h3>
              History
              {history.length > 8 && <button className="btn" onClick={() => setShowAllHistory((x) => !x)}>{showAllHistory ? "Show fewer" : `Show all ${history.length}`}</button>}
            </h3>
            <div className="card">
              <ul className="rhist">
                {shownHistory.map((h) =>
                  h.kind === "attempt" ? (
                    <li key={h.key}>
                      <div>
                        <b>{dayMonth(h.date)}</b> · {h.a.label} <span className="m">({h.a.topicName})</span> ·{" "}
                        <span className={h.a.score <= 1 ? "delayed" : ""}>{h.a.score} {scoreLabel(h.a.score)}</span>
                        <span className="m"> · {METHOD_LABEL[h.a.retrievalMethod]}{h.a.usedHints || h.a.usedNotes ? " · with help" : ""}</span>
                      </div>
                      {h.a.mistakes && <div className="m">Gap: {h.a.mistakes}{h.a.score <= 1 ? (h.a.correctionCompleted ? " · corrected" : " · not corrected yet") : ""}</div>}
                    </li>
                  ) : (
                    <li key={h.key}>
                      <div>
                        <b>{dayMonth(h.date)}</b> · {h.k.label} <span className="m">({h.k.topicName})</span> · check: {CHECKPOINT_RESULTS.find((x) => x.result === h.k.result)?.label}
                      </div>
                      {h.k.gaps && <div className="m">Gap: {h.k.gaps}</div>}
                    </li>
                  ),
                )}
              </ul>
            </div>
          </div>
        )}

        {progress && <RevisionAnalytics r={progress.revision} weekly={o.weeklyOvertimeMinutes} />}
      </div>
      {recall && <RecallDialog items={recall} onClose={() => setRecall(null)} />}
    </div>
  );
}

/** Recall behaviour over time (spec §14.4): descriptive only, no streaks or points. */
function RevisionAnalytics({ r, weekly }: { r: NonNullable<ReturnType<typeof useAppData>["progress"]>["revision"]; weekly: number }) {
  const { mutate } = useAppData();
  const [caps, setCaps] = useState<{ daily: number; weekly: number } | null>(null);
  const valid = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max && n % 5 === 0;
  const maxDist = Math.max(1, ...r.distribution);
  const months = r.monthly.filter((m) => m.attempts > 0);
  return (
    <div className="section">
      <h3>Recall analytics</h3>
      <div className="card">
        <div className="sub" style={{ marginTop: 0, marginBottom: 8 }}>
          {r.attempts ? `${plural(r.attempts, "attempt")}, ${pct(r.successful / r.attempts)} recalled (score 2–3) · ` : "No attempts yet · "}
          {plural(r.checkpoints, "recall check")} during initial study
        </div>
        <div className="kick" style={{ marginBottom: 6 }}>Scores</div>
        <ul className="list scores">
          {SCORES.map((s) => (
            <li key={s.score}>
              <span>{s.score} · {s.label}</span>
              <span className="sbar"><i style={{ width: `${(r.distribution[s.score] / maxDist) * 100}%` }} /></span>
              <span className="m">{r.distribution[s.score]}</span>
            </li>
          ))}
        </ul>
        {months.length > 0 && (
          <>
            <div className="kick" style={{ margin: "12px 0 6px" }}>By month</div>
            <ul className="list">
              {months.map((m) => (
                <li key={m.month}>
                  <span>{monthName(m.month)}</span>
                  <span className="m">{plural(m.attempts, "attempt")} · {m.successful} recalled · average {m.averageScore!.toFixed(1)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="sub" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
          Over-target revision allowed: <b style={{ color: "var(--ink)" }}>{hm(r.dailyAllowanceMinutes)}</b> a day,{" "}
          <b style={{ color: "var(--ink)" }}>{hm(weekly)}</b> a week
          {caps === null ? (
            <button className="btn" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setCaps({ daily: r.dailyAllowanceMinutes, weekly })}>Change</button>
          ) : (
            <>
              <input className="inp" type="number" aria-label="Daily over-target revision minutes" min={0} max={240} step={5} value={caps.daily} style={{ width: 74 }} onChange={(e) => setCaps({ ...caps, daily: Number(e.target.value) })} />
              <input className="inp" type="number" aria-label="Weekly over-target revision minutes" min={0} max={720} step={5} value={caps.weekly} style={{ width: 74 }} onChange={(e) => setCaps({ ...caps, weekly: Number(e.target.value) })} />
              <button
                className="btn primary"
                style={{ padding: "2px 8px", fontSize: 12 }}
                disabled={!valid(caps.daily, 240) || !valid(caps.weekly, 720)}
                onClick={async () => {
                  const ok = await mutate(() => api.patchSettings({ revisionDailyMinutes: caps.daily, revisionWeeklyOvertimeMinutes: caps.weekly }));
                  if (ok) setCaps(null);
                }}
              >
                Save
              </button>
            </>
          )}
          <span>Revision uses free time first. Set both to 0 for a strict 4 h day (revision then waits for free time). New placements use the values; planned revisions stay where they are.</span>
        </div>
      </div>
    </div>
  );
}
