/** Progress and timeline (SRS §3.6–§3.7): only measurements that support a learning decision. */
import { useState } from "react";
import { api } from "../api/client";
import type { Progress, RecallCoaching } from "../api/types";
import { INK, mix } from "../lib/color";
import { dayMonth, hours1, monthName, pct, plural, shortDate } from "../lib/format";
import { useAppData } from "../state/AppData";
import { historyHash, openPage } from "../lib/nav";
import { Loading, Stat } from "./ui";
import { StatusBadge } from "./Status";


export function ProgressView({ onOpenDistrict }: { onOpenDistrict: (idx: number) => void }) {
  const { progress: p, curriculum, districtById } = useAppData();
  if (!p || !curriculum) return <div className="view"><Loading /></div>;

  const h = p.hours;
  // The chart's scale comes from this city's own weeks (at least an hour), never a fixed weekly target.
  const maxWeek = Math.max(60, ...p.weekly.map((w) => Math.max(w.actualMinutes, w.plannedMinutes)));
  const thisWeekPlanned = p.weekly.length ? p.weekly[p.weekly.length - 1].plannedMinutes : 0;
  const curDistrict = curriculum.districts[p.road.currentDistrictIndex];

  return (
    <div className="view">
      <div className="wrap">
        <div className="vhead">
          <div>
            <div className="kick">Progress · as of {shortDate(p.today)}</div>
            <h2>{pct(p.road.overall)} of the road travelled</h2>
            <div className="sub">
              {curDistrict
                ? `Checkpoint ${p.road.currentDistrictIndex + 1} of 7: ${curDistrict.name} (${pct(p.road.districtFraction)} of its core work).`
                : "Every checkpoint passed."}{" "}
              The road counts demonstrated core topics only.
            </div>
          </div>
        </div>

        <div className="grid4">
          <Stat label="Actual hours" value={hours1(h.actualTotal)} detail={`of ${hours1(h.plannedToDate)} planned to date`} />
          <Stat label="This week" value={hours1(h.thisWeek)} detail={thisWeekPlanned ? `of ${hours1(thisWeekPlanned)} planned` : "nothing planned"} />
          <Stat label="This month" value={hours1(h.thisMonth)} detail={`${hours1(h.plannedTotal)} planned in total`} />
          <Stat
            label="Core topics"
            value={p.core.demonstrated}
            unit={`/ ${p.core.total} demonstrated`}
            detail={`${p.core.learned} learned · ${p.practice.done}/${p.practice.total} practical assignments done`}
          />
        </div>

        <div className="section">
          <h3>Districts · learned vs demonstrated</h3>
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="dtable" role="table">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader">District</th>
                  <th role="columnheader">Floors learned</th>
                  <th role="columnheader">Core demonstrated</th>
                  <th role="columnheader">Hours</th>
                  <th role="columnheader"><span className="sr">Status</span></th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {p.districts.map((d, i) => {
                  const dist = districtById.get(d.id)!;
                  const c = mix(dist.color, INK, 0.15);
                  return (
                    <tr key={d.id} role="row">
                      <td role="cell">
                        <button className="btn" style={{ padding: "3px 9px", fontSize: 13 }} onClick={() => onOpenDistrict(i)}>
                          <span className="swatch" style={{ background: dist.color }} />
                          {dist.name}
                        </button>
                      </td>
                      <td role="cell" data-label="Floors learned">
                        <div className="mini"><i style={{ width: `${d.subtopicsTotal ? (d.subtopicsLearned / d.subtopicsTotal) * 100 : 0}%`, background: c }} /></div>
                        <span className="pr" style={{ fontSize: 12, color: "var(--muted)" }}>{d.subtopicsLearned}/{d.subtopicsTotal} · {d.topicsLearned}/{d.topicsTotal} topics</span>
                      </td>
                      <td role="cell" data-label="Core demonstrated">
                        <div className="mini"><i style={{ width: `${d.coreTotal ? (d.coreDemonstrated / d.coreTotal) * 100 : 0}%` }} /></div>
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>{d.coreDemonstrated}/{d.coreTotal}</span>
                      </td>
                      <td role="cell" data-label="Hours" className="n">{hours1(d.actualMinutes)} <span style={{ color: "var(--muted)" }}>/ {hours1(d.plannedMinutes)}</span></td>
                      <td role="cell" className="n st"><StatusBadge p={d.presentation} fallback={d.passed ? "Passed" : i === p.road.currentDistrictIndex ? "Current" : undefined} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="legend">
              <span><i style={{ background: "#8ea58b" }} />Learned = every sub-topic ticked (learning activity)</span>
              <span><i style={{ background: "var(--accent)" }} />Demonstrated = exercise done on your own (skill)</span>
            </div>
          </div>
        </div>

        <div className="section">
          <h3>Weekly hours</h3>
          <div className="card">
            {p.weekly.length === 0 ? (
              <div className="empty" style={{ padding: 0 }}>The journey hasn't started yet.</div>
            ) : (
              <>
                <div className="chart-box" style={{ ["--weeks" as string]: p.weekly.length }}>
                <div className="chart" role="img" aria-label="Weekly planned and actual study hours">
                  {p.weekly.map((w, i) => (
                    <div key={w.weekStart} className={`col${i === p.weekly.length - 1 ? " now" : ""}`} title={`Week of ${dayMonth(w.weekStart)}: ${hours1(w.actualMinutes)} actual, ${hours1(w.plannedMinutes)} planned`}>
                      <i style={{ height: `${(w.plannedMinutes / maxWeek) * 100}%`, background: "#d3d8da" }} />
                      <i style={{ height: `${(w.actualMinutes / maxWeek) * 100}%`, background: "var(--accent)" }} />
                    </div>
                  ))}
                </div>
                <div className="axis">
                  {p.weekly.length > 1 && <span>{dayMonth(p.weekly[0].weekStart)}</span>}
                  <span>this week</span>
                </div>
                </div>
                <div className="legend">
                  <span><i style={{ background: "#d3d8da" }} />Planned (original plan)</span>
                  <span><i style={{ background: "var(--accent)" }} />Actual</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="section">
          <h3>Monthly hours</h3>
          <div className="card">
            <ul className="list">
              {p.monthly.map((m) => (
                <li key={m.month}>
                  <span>{monthName(m.month)}</span>
                  <span className="m">{hours1(m.actualMinutes)} actual · {hours1(m.plannedMinutes)} planned</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="section">
          <h3>Recall</h3>
          <div className="grid4">
            <Stat label="In recall" value={p.recall.inRecall} detail={p.recall.dueNow ? `${p.recall.dueNow} to recall now` : "nothing due now"} />
            <Stat label="Recalls done" value={p.recall.reviews} detail={p.recall.reviews ? `${p.recall.outcomes.PASS} remembered well · ${p.recall.outcomes.LAPSE} mostly forgotten` : "none yet"} />
            <Stat label="Average score" value={p.recall.averageScore === null ? "—" : pct(p.recall.averageScore)} detail="share of each checklist recalled" />
            <Stat
              label="Depth"
              value={<span style={{ fontSize: 17 }}>{p.recall.depth.FOUNDATIONAL} · {p.recall.depth.INTERMEDIATE} · {p.recall.depth.MASTERY}</span>}
              detail="Foundational · Intermediate · Mastery"
            />
          </div>
          {p.recall.monthly.length > 0 && (
            <ul className="list" style={{ marginTop: 10 }}>
              {p.recall.monthly.map((m) => (
                <li key={m.month}><span>{monthName(m.month)}</span><span className="m">{m.reviews} recalled · average {m.averageScore === null ? "—" : pct(m.averageScore)}</span></li>
              ))}
            </ul>
          )}
          {p.recall.coaching && <RecallCoachingView c={p.recall.coaching} />}
          <div className="sub">Remembering is tracked separately: it never changes floors, demonstrations, districts or the road above.</div>
        </div>

        <Timeline p={p} />
      </div>
    </div>
  );
}

/**
 * Recall coaching (Recall-Plan §3.5, §7): blind spots across sub-topics, then each recalled sub-topic with what is
 * newly locked in, what slipped and mistakes that came back, and the note written after its last review. Each opens
 * the sub-topic's recall over time.
 */
export function RecallCoachingView({ c }: { c: RecallCoaching }) {
  if (!c.subtopics.length) return null;
  const delta = (d: number | null) => (d === null ? "first recall" : d === 0 ? "same as last time" : `${d > 0 ? "+" : "−"}${Math.round(Math.abs(d) * 100)} points since last time`);
  return (
    <>
      {c.blindSpots.length > 0 && (
        <>
          <h4 className="pg-h4">Blind spots · missed in a row</h4>
          <ul className="list card" aria-label="Blind spots">
            {c.blindSpots.map((b) => (
              <li key={`${b.subtopicId}-${b.label}`}>
                <span><b>{b.label}</b> <span className="m">({b.subtopic})</span></span>
                <span className="m">missed {b.missedInARow}× · <button type="button" className="pg-link" onClick={() => openPage(historyHash("progress", b.subtopicId))} aria-label={`Recall over time: ${b.subtopic}`}>over time</button></span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h4 className="pg-h4">By sub-topic</h4>
      <ul className="list card pg-coach" aria-label="Recall by sub-topic">
        {c.subtopics.map((s) => (
          <li key={s.subtopicId}>
            <div style={{ minWidth: 0 }}>
              <b>{s.subtopic}</b> <span className="m">({s.topic}) · {plural(s.reviews, "recall")} · last {dayMonth(s.lastDate)}</span>
              {s.narrative && <p className="pg-note">{s.narrative}</p>}
              <div className="pg-tags">
                {s.newlyMastered.length > 0 && <span className="sb v-soft t-success">Newly remembered: {s.newlyMastered.join(", ")}</span>}
                {s.slipped.length > 0 && <span className="sb v-soft t-warning">Slipped: {s.slipped.join(", ")}</span>}
                {s.blindSpots.length > 0 && <span className="sb v-soft t-danger">Keeps missing: {s.blindSpots.map((b) => b.label).join(", ")}</span>}
                {s.recurringMisconceptions.length > 0 && <span className="sb v-soft t-danger">A corrected mistake came back: “{s.recurringMisconceptions[0].claim}”</span>}
              </div>
            </div>
            <span className="pg-score">
              <b>{pct(s.lastScore)}</b>
              <span className="m">{delta(s.scoreDelta)}</span>
              <button type="button" className="pg-link" onClick={() => openPage(historyHash("progress", s.subtopicId))} aria-label={`Recall over time: ${s.subtopic}`}>Over time</button>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Timeline({ p }: { p: Progress }) {
  const { mutate } = useAppData();
  const [edit, setEdit] = useState<{ id: string; start: string; end: string } | null>(null);
  return (
    <div className="section">
      <h3>Roadmap timeline</h3>
      <div className="card">
        {p.stages.map((s) => (
          <div className="stage" key={s.id}>
            <div>
              <div className="nm">{s.name}{s.kind === "PARALLEL" ? " · parallel" : ""}</div>
              <div className="dt">{shortDate(s.startDate)} – {shortDate(s.endDate)}</div>
            </div>
            <div className="pr">
              <div className="mini"><i style={{ width: `${s.minutesTotal ? (s.minutesDone / s.minutesTotal) * 100 : 0}%` }} /></div>
              <div style={{ marginTop: 4 }}>
                {s.tasksDone}/{s.tasksTotal} tasks · {hours1(s.minutesDone)} of {hours1(s.minutesTotal)}
                {s.bufferDays > 0 && ` · ${plural(s.bufferDays, "buffer day")}`}
              </div>
            </div>
            <div className="st">
              <StatusBadge p={s.presentation} fallback={s.status.toLowerCase().replace("_", " ")} />
              {s.overdueTasks > 0 && <div className="dt">{plural(s.overdueTasks, "task")} overdue</div>}
              <div>
                <button className="btn" style={{ padding: "2px 8px", fontSize: 12, marginTop: 4 }} onClick={() => setEdit(edit?.id === s.id ? null : { id: s.id, start: s.startDate, end: s.endDate })}>
                  Edit dates
                </button>
              </div>
            </div>
            {edit?.id === s.id && (
              <div className="edit form">
                <label>Start<input className="inp" type="date" value={edit.start} onChange={(e) => setEdit({ ...edit, start: e.target.value })} /></label>
                <label>End<input className="inp" type="date" value={edit.end} onChange={(e) => setEdit({ ...edit, end: e.target.value })} /></label>
                <button
                  className="btn primary"
                  disabled={!edit.start || !edit.end || edit.start > edit.end}
                  onClick={async () => {
                    const r = await mutate(() => api.patchStage(s.id, { startDate: edit.start, endDate: edit.end }));
                    if (r) setEdit(null);
                  }}
                >
                  Save
                </button>
                <span className="sub" style={{ marginTop: 0 }}>Changing dates moves the deadline only. Tasks stay where they are; reschedule them from Today.</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
