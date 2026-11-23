/**
 * Progress and timeline (SRS §3.6–§3.7), in glass (DESIGN.md §10): only measurements that support a learning decision.
 * The answer first (on track or not, and when you finish), then study time, then districts, remembering and stages.
 * Each number appears once; the rules behind them are one click away.
 */
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Forecast, PlanChange, Progress, RecallCoaching } from "../api/types";
import { dayMonth, hours1, monthName, pct, plural, shortDate } from "../lib/format";
import { useAppData } from "../state/AppData";
import { YOUR_TIME, historyHash, openPage, stageHash } from "../lib/nav";
import { Bar, Loading } from "./ui";
import { StatusBadge } from "./Status";
import { Chevron } from "./recall/icons";
import { changeText, finishText } from "./PlanNotice";

export function ProgressView({ onOpenDistrict }: { onOpenDistrict: (idx: number) => void }) {
  const { progress: p, curriculum, districtById, version } = useAppData();
  const [change, setChange] = useState<PlanChange | null>(null);
  useEffect(() => {
    let live = true;
    api.planChanges().then((xs) => live && setChange(xs[0] ?? null), () => undefined);
    return () => {
      live = false;
    };
  }, [version]);
  if (!p || !curriculum) return <div className="view gl gl-bg"><Loading /></div>;

  const h = p.hours;
  const curDistrict = curriculum.districts[p.road.currentDistrictIndex];
  const r = p.recall;

  return (
    <div className="view gl gl-bg">
      <div className="wrap pg">
        <header className="td-head">
          <div>
            <div className="kick">Progress · as of {shortDate(p.today)}</div>
            <h2 className="g-title">{pct(p.road.overall)} of the road travelled</h2>
            <p className="g-sub">
              {curDistrict
                ? `Checkpoint ${p.road.currentDistrictIndex + 1} of ${curriculum.districts.length}: ${curDistrict.name}, ${pct(p.road.districtFraction)} of its core work.`
                : "Every checkpoint passed."}
            </p>
          </div>
        </header>

        <div className="td-split">
          <div className="td-aside">
            {p.forecast && <ForecastView f={p.forecast} change={change} />}

            <section className="td-card pg-hours" aria-labelledby="pg-hours">
              <h3 id="pg-hours" className="kick">Study time</h3>
              <div className="td-v">
                {hours1(h.actualTotal)}
                <small>of {hours1(h.plannedToDate)} planned so far</small>
              </div>
              <Bar value={h.plannedToDate ? h.actualTotal / h.plannedToDate : 0} />
              <p className="g-small">This month {hours1(h.thisMonth)} · the whole plan {hours1(h.plannedTotal)}</p>
              <WeeklyChart weeks={p.weekly} />
            </section>

            <details className="pg-how">
              <summary>How progress is counted</summary>
              <p>The road counts core topics. Learned sub-topics take a topic up to 80 %; demonstrating it (doing its exercise on your own) completes it.</p>
              <p>The projected finish is the last day of your plan as it stands. The plan is re-planned each day and whenever your study time changes; each stage keeps its start date. Due revision comes first in a day and may take up to half of its new-material time. The revision ahead is the best case: every recall remembered.</p>
              <p>Remembering is tracked separately: it never changes floors, demonstrations, districts or the road.</p>
            </details>
          </div>

          <div className="td-main pg-main">
            <h3 className="g-cap">Districts</h3>
            <p className="g-foot pg-lead">
              Core topics: {p.core.demonstrated} of {p.core.total} demonstrated, {p.core.learned} learned · {p.practice.done} of {p.practice.total} practice assignments done.
            </p>
            <ul className="g-group">
              {p.districts.map((d, i) => {
                const dist = districtById.get(d.id)!;
                const current = i === p.road.currentDistrictIndex;
                return (
                  <li key={d.id}>
                    <button type="button" className="g-row pg-row" onClick={() => onOpenDistrict(i)}>
                      <span className="g-dot" style={{ background: dist.color }} />
                      <span className="g-lbl">
                        {dist.name}
                        <small>
                          {d.subtopicsLearned}/{d.subtopicsTotal} floors learned · {d.coreDemonstrated}/{d.coreTotal} core demonstrated · {hours1(d.actualMinutes)} of {hours1(d.plannedMinutes)}
                        </small>
                        <span className="pg-bars" aria-hidden="true">
                          <Bar className="bar pg-learned" value={d.subtopicsTotal ? d.subtopicsLearned / d.subtopicsTotal : 0} />
                          <Bar className="bar pg-shown" value={d.coreTotal ? d.coreDemonstrated / d.coreTotal : 0} />
                        </span>
                      </span>
                      {(d.passed || current) && <StatusBadge p={d.presentation} fallback={d.passed ? "Passed" : "Current"} />}
                      <Chevron />
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="g-foot pg-legend"><i className="pg-key learned" />floors learned <i className="pg-key shown" />core topics demonstrated</p>

            <h3 className="g-cap">Remembering</h3>
            <section className="td-card" aria-label="Recall so far">
              <div className="td-v">
                {r.reviews}
                <small>{r.reviews === 1 ? "recall" : "recalls"}</small>
              </div>
              <p className="g-small pg-line">
                {r.reviews
                  ? `${r.outcomes.PASS} remembered well · ${r.outcomes.HOLD} partly remembered · ${r.outcomes.LAPSE} mostly forgotten`
                  : "None yet: a sub-topic's first recall comes the day after you tick it as learned."}
              </p>
              <p className="g-small pg-line">
                {plural(r.inRecall, "sub-topic")} in recall · {r.dueNow ? `${r.dueNow} due now` : "nothing due now"}
                {r.reviews > 0 && <> · depth: {r.depth.FOUNDATIONAL} foundational, {r.depth.INTERMEDIATE} intermediate, {r.depth.MASTERY} mastery</>}
                {r.averageScore !== null && <> · on average {pct(r.averageScore)} of each checklist recalled</>}
              </p>
            </section>
            {r.monthly.length > 1 && (
              <ul className="g-group pg-months" aria-label="Recall by month">
                {r.monthly.map((m) => (
                  <li key={m.month} className="g-row">
                    <span className="g-lbl">{monthName(m.month)}</span>
                    <span className="g-val">{plural(m.reviews, "recall")} · average {m.averageScore === null ? "—" : pct(m.averageScore)}</span>
                  </li>
                ))}
              </ul>
            )}
            {r.coaching && <RecallCoachingView c={r.coaching} />}

            <h3 className="g-cap">Stages</h3>
            <ul className="g-group">
              {p.stages.map((s) => (
                <li key={s.id}>
                  <button type="button" className="g-row g-top pg-row" onClick={() => openPage(stageHash(s.id))}>
                    <span className="g-lbl">
                      {s.name}{s.kind === "PARALLEL" ? " · parallel" : ""}
                      <small>
                        {shortDate(s.startDate)} – {shortDate(s.endDate)} · {s.tasksDone}/{s.tasksTotal} tasks · {hours1(s.minutesDone)} of {hours1(s.minutesTotal)}
                        {s.bufferDays > 0 && ` · ${plural(s.bufferDays, "buffer day")}`}
                        {s.overdueTasks > 0 && ` · ${plural(s.overdueTasks, "task")} overdue`}
                      </small>
                      <span className="pg-bars" aria-hidden="true"><Bar value={s.minutesTotal ? s.minutesDone / s.minutesTotal : 0} /></span>
                    </span>
                    <StatusBadge p={s.presentation} fallback={s.status.toLowerCase().replace("_", " ")} />
                    <Chevron />
                  </button>
                </li>
              ))}
            </ul>
            <p className="g-foot">A stage opens its dates. Changing them moves the deadline only.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Weekly hours: planned (outlined) and actual (solid) bars, with the numbers as text for anyone who can't see them. */
function WeeklyChart({ weeks }: { weeks: Progress["weekly"] }) {
  if (weeks.length === 0) return <p className="g-small pg-line">The journey hasn't started yet.</p>;
  // The scale comes from this city's own weeks (at least an hour), never a fixed weekly target.
  const max = Math.max(60, ...weeks.map((w) => Math.max(w.actualMinutes, w.plannedMinutes)));
  const said = (w: Progress["weekly"][number], i: number) => `${i === weeks.length - 1 ? "This week" : `Week of ${dayMonth(w.weekStart)}`}: ${hours1(w.actualMinutes)} of ${hours1(w.plannedMinutes)} planned`;
  const now = weeks[weeks.length - 1];
  return (
    <figure className="pg-chart">
      <figcaption className="kick">Weekly hours</figcaption>
      <div className="chart-box" style={{ ["--weeks" as string]: weeks.length }}>
        <div className="chart" aria-hidden="true">
          {weeks.map((w, i) => (
            <div key={w.weekStart} className={`col${i === weeks.length - 1 ? " now" : ""}`}>
              <i className="pl" style={{ height: `${(w.plannedMinutes / max) * 100}%` }} />
              <i className={`ac${w.actualMinutes > 0 ? " some" : ""}`} style={{ height: `${(w.actualMinutes / max) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="axis" aria-hidden="true">
          {weeks.length > 1 && <span>{dayMonth(weeks[0].weekStart)}</span>}
          <span>this week</span>
        </div>
      </div>
      <ul className="sr">{weeks.map((w, i) => <li key={w.weekStart}>{said(w, i)}</li>)}</ul>
      <p className="g-small pg-line" aria-hidden="true">This week {hours1(now.actualMinutes)} of {hours1(now.plannedMinutes)} planned</p>
      <p className="g-foot pg-legend" aria-hidden="true"><i className="pg-key plan" />planned <i className="pg-key shown" />actual</p>
    </figure>
  );
}

/** How far "days" are from the plan, in words: "on the plan's last day", "3 weeks after it", "5 days before it". */
const vsPlan = (days: number) => {
  if (days === 0) return "on the plan's last day";
  const n = Math.abs(days), unit = n >= 14 ? plural(Math.round(n / 7), "week") : plural(n, "day");
  return `${unit} ${days > 0 ? "after" : "before"} the plan's end`;
};
const yearDate = (iso: string) => `${dayMonth(iso)} ${iso.slice(0, 4)}`;

/** The answer to "am I on track?", in words, from the forecast. */
function verdict(f: Forecast) {
  if (!f.projectedFinish) return f.remainingNewMinutes ? "Not within 3 years at this pace" : "Everything is learned";
  if (f.meetsTarget === false) return "Behind your finish date";
  if (f.daysVsPlan !== null && f.daysVsPlan > 0) return "Behind the plan";
  return "On track";
}

/** The forecast (Blueprint relationship model): what the learner's week realistically achieves. Reported only. */
export function ForecastView({ f, change }: { f: Forecast; change?: PlanChange | null }) {
  const recalls = f.revisionLoad.reduce((a, w) => a + w.recalls, 0);
  return (
    <section className="g-hero pg-hero" aria-labelledby="pg-verdict">
      <div className="g-grow">
        <div className="kick">Forecast</div>
        <h3 id="pg-verdict" className="g-hero-name">{verdict(f)}</h3>
        <p className="g-sub">
          {f.projectedFinish
            ? <>Projected finish <b>{yearDate(f.projectedFinish)}</b>{f.daysVsPlan !== null && `, ${vsPlan(f.daysVsPlan)} (${yearDate(f.planEnd)})`}. </>
            : null}
          {hours1(f.remainingNewMinutes)} of new material left.
        </p>
        {f.targetDate && (
          <p className="g-sub pg-target">
            {f.meetsTarget
              ? `On track for your finish date, ${yearDate(f.targetDate)}.`
              : f.neededNewMinutesPerWeek !== null
                ? `Not by ${yearDate(f.targetDate)} at this pace: it needs about ${hours1(f.neededNewMinutesPerWeek)} of new material a week (you plan ${hours1(f.week.newMaterial)}).`
                : `Your finish date, ${yearDate(f.targetDate)}, has passed.`}
          </p>
        )}
        <ul className="pg-facts">
          <li><span>Your week</span><b>{hours1(f.week.available)}</b><small>{hours1(f.week.newMaterial)} new material · {hours1(f.week.revision)} revision</small></li>
          <li><span>Revision, next 4 weeks</span><b>{plural(recalls, "recall")}</b><small>{f.revisionLoad.map((w) => w.recalls).join(" · ")} a week</small></li>
        </ul>
        {change && <p className="g-small pg-line">Last change, {dayMonth(change.at.slice(0, 10))}: {changeText(change)} {finishText(change)}</p>}
      </div>
      <button type="button" className="g-link" onClick={() => openPage(YOUR_TIME)}>Change your time</button>
    </section>
  );
}

/**
 * Recall coaching (Recall-Plan §3.5, §7): each recalled sub-topic with what is newly locked in, what slipped, what it
 * keeps missing (its blind spots, with how many times in a row) and mistakes that came back, and the note written after
 * its last review. Each row opens the sub-topic's recall over time.
 */
export function RecallCoachingView({ c }: { c: RecallCoaching }) {
  if (!c.subtopics.length) return null;
  const delta = (d: number | null) => (d === null ? "first recall" : d === 0 ? "same as last time" : `${d > 0 ? "up" : "down"} ${Math.round(Math.abs(d) * 100)} points since last time`);
  return (
    <ul className="g-group pg-coach" aria-label="Recall by sub-topic">
      {c.subtopics.map((s) => (
        <li key={s.subtopicId}>
          <button type="button" className="g-row g-top pg-row" onClick={() => openPage(historyHash("progress", s.subtopicId))}>
            <span className="g-lbl">
              {s.subtopic} <span className="pg-topic">({s.topic})</span>
              <small>{plural(s.reviews, "recall")} · last {dayMonth(s.lastDate)} · {pct(s.lastScore)} of the checklist, {delta(s.scoreDelta)}</small>
              {s.narrative && <span className="pg-note">{s.narrative}</span>}
              {(s.newlyMastered.length > 0 || s.slipped.length > 0 || s.blindSpots.length > 0 || s.recurringMisconceptions.length > 0) && (
                <span className="pg-tags">
                  {s.newlyMastered.length > 0 && <span className="sb v-soft t-success">Newly remembered: {s.newlyMastered.join(", ")}</span>}
                  {s.slipped.length > 0 && <span className="sb v-soft t-warning">Slipped: {s.slipped.join(", ")}</span>}
                  {s.blindSpots.length > 0 && (
                    <span className="sb v-soft t-danger">Keeps missing: {s.blindSpots.map((b) => `${b.label} (${b.missedInARow}× in a row)`).join(", ")}</span>
                  )}
                  {s.recurringMisconceptions.length > 0 && <span className="sb v-soft t-danger">A corrected mistake came back: “{s.recurringMisconceptions[0].claim}”</span>}
                </span>
              )}
            </span>
            <span className="sr">: recall over time</span>
            <Chevron />
          </button>
        </li>
      ))}
    </ul>
  );
}
