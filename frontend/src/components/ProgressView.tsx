/** Progress and timeline (SRS §3.6–§3.7): only measurements that support a learning decision. */
import { useState } from "react";
import { api } from "../api/client";
import type { Progress } from "../api/types";
import { INK, mix } from "../lib/color";
import { dayMonth, hours1, monthName, pct, plural, shortDate } from "../lib/format";
import { useAppData } from "../state/AppData";
import { Loading, Stat } from "./ui";
import { StatusBadge } from "./Status";


export function ProgressView({ onOpenDistrict, onOpenRevision }: { onOpenDistrict: (idx: number) => void; onOpenRevision: () => void }) {
  const { progress: p, curriculum, districtById } = useAppData();
  if (!p || !curriculum) return <div className="view"><Loading /></div>;

  const h = p.hours;
  const maxWeek = Math.max(240 * 6, ...p.weekly.map((w) => Math.max(w.actualMinutes, w.plannedMinutes)));
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
          <Stat label="This week" value={hours1(h.thisWeek)} detail="target 24 h" />
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
            <table className="dtable">
              <thead>
                <tr>
                  <th>District</th>
                  <th>Floors learned</th>
                  <th>Core demonstrated</th>
                  <th>Hours</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {p.districts.map((d, i) => {
                  const dist = districtById.get(d.id)!;
                  const c = mix(dist.color, INK, 0.15);
                  return (
                    <tr key={d.id}>
                      <td>
                        <button className="btn" style={{ padding: "3px 9px", fontSize: 13 }} onClick={() => onOpenDistrict(i)}>
                          <span className="swatch" style={{ background: dist.color }} />
                          {dist.name}
                        </button>
                      </td>
                      <td>
                        <div className="mini"><i style={{ width: `${d.subtopicsTotal ? (d.subtopicsLearned / d.subtopicsTotal) * 100 : 0}%`, background: c }} /></div>
                        <span className="pr" style={{ fontSize: 12, color: "var(--muted)" }}>{d.subtopicsLearned}/{d.subtopicsTotal} · {d.topicsLearned}/{d.topicsTotal} topics</span>
                      </td>
                      <td>
                        <div className="mini"><i style={{ width: `${d.coreTotal ? (d.coreDemonstrated / d.coreTotal) * 100 : 0}%` }} /></div>
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>{d.coreDemonstrated}/{d.coreTotal}</span>
                      </td>
                      <td className="n">{hours1(d.actualMinutes)} <span style={{ color: "var(--muted)" }}>/ {hours1(d.plannedMinutes)}</span></td>
                      <td className="n"><StatusBadge p={d.presentation} fallback={d.passed ? "Passed" : i === p.road.currentDistrictIndex ? "Current" : undefined} /></td>
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
                <div className="chart" role="img" aria-label="Weekly planned and actual study hours">
                  {p.weekly.map((w, i) => (
                    <div key={w.weekStart} className={`col${i === p.weekly.length - 1 ? " now" : ""}`} title={`Week of ${dayMonth(w.weekStart)}: ${hours1(w.actualMinutes)} actual, ${hours1(w.plannedMinutes)} planned`}>
                      <i style={{ height: `${(w.plannedMinutes / maxWeek) * 100}%`, background: "#d3d8da" }} />
                      <i style={{ height: `${(w.actualMinutes / maxWeek) * 100}%`, background: "var(--accent)" }} />
                    </div>
                  ))}
                </div>
                <div className="axis">
                  <span>{dayMonth(p.weekly[0].weekStart)}</span>
                  <span>this week</span>
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
          <h3>Recall and revision</h3>
          <div className="grid4">
            <Stat label="Attempts" value={p.revision.attempts} detail={p.revision.attempts ? `${pct(p.revision.successful / p.revision.attempts)} recalled (score 2–3)` : "none yet"} />
            <Stat
              label="Scores 0 · 1 · 2 · 3"
              value={<span style={{ fontSize: 17 }}>{p.revision.distribution.join(" · ")}</span>}
              detail="Forgot · Struggled · Recalled · Strong recall"
            />
            <Stat label="Weak units" value={p.revision.weakUnits.length} detail="failed twice or more in a row" />
            <Stat label="Overdue" value={p.revision.overdue} detail={p.revision.awaitingCorrection ? `${p.revision.awaitingCorrection} awaiting correction` : "none awaiting correction"} />
          </div>
          <div className="sub">
            Remembering is tracked separately: it never changes floors, demonstrations, districts or the road above.{" "}
            <button className="btn" style={{ padding: "2px 9px", fontSize: 12.5 }} onClick={onOpenRevision}>Open Revision</button>
          </div>
        </div>

        <Timeline p={p} />
      </div>
    </div>
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
