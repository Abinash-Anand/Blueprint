/**
 * Building details (DESIGN.md §5, extended per SRS FR-MAP-04/06/10), in glass (§10). Ordered by what you do with a topic:
 * tick its sub-topics (and recall them), study from its resources, demonstrate it, then what it builds on, its schedule
 * and its district's goal. It takes keyboard focus when it opens; it is not a live region, so it is read in order.
 */
import { type Ref, useEffect, useRef, useState } from "react";
import { INK, mix } from "../lib/color";
import { PRIORITY_LABEL, dayMonth, hm, shortDate } from "../lib/format";
import { LAYERS } from "../lib/layers";
import type { Building } from "../map/geometry";
import { useAppData } from "../state/AppData";
import { Bar } from "./ui";
import { addTaskHash, openPage, recallHash } from "../lib/nav";
import { StatusIndicator } from "./Status";
import { Chevron, Close } from "./recall/icons";
import { OUTCOME } from "./recall/RecallPage";

interface Props {
  ref?: Ref<HTMLElement>;
  building: Building;
  route: Building[];
  today: string;
  onOpenTopic: (id: string) => void;
  onClose: () => void;
}

const KIND = { ROADMAP: "Roadmap", DOCS: "Docs", COURSE: "Course", ARTICLE: "Article" } as const;

export function TopicPanel({ ref, building, route, today, onOpenTopic, onClose }: Props) {
  const { patchTopic, toggleSubtopic, topicById } = useAppData();
  const t = building.topic;
  const d = building.block.district;
  const n = t.subtopics.length;
  const k = t.subtopics.filter((s) => s.completedAt).length;
  const demonstrated = t.status === "DEMONSTRATED";
  const [note, setNote] = useState(t.demonstrationNote ?? "");
  const head = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setNote(t.demonstrationNote ?? "");
  }, [t.id, t.demonstrationNote]);
  // Opening a building (or moving to the previous or next one) puts keyboard focus on its name.
  useEffect(() => {
    head.current?.focus({ preventScroll: true });
  }, [t.id]);

  const prev = route[building.ri - 1];
  const next = route[building.ri + 1];

  return (
    <section className="panel gl" ref={ref} aria-labelledby="tp-name">
      <div className="pstripe" style={{ background: d.color }} />
      <button type="button" className="close" aria-label={`Close ${t.name}`} onClick={onClose}><Close /></button>
      <div className="pin">
        <div className="kick pk">0{d.layer} · {LAYERS[d.layer]} · {d.name}</div>
        <h2 id="tp-name" ref={head} tabIndex={-1}>{t.name}</h2>
        <div className="pmeta">{k} of {n} floors built{demonstrated ? " · demonstrated" : k === n ? " · learned" : ""}</div>
        <Bar value={n ? (demonstrated ? 1 : k / n) : 0} color={mix(d.color, INK, 0.15)} />
        <div className="tags">
          <span className={`tag ${t.priority === "CORE" ? "ink" : ""}`}>{PRIORITY_LABEL[t.priority]}</span>
          <StatusIndicator p={t.presentation} fallback={t.status.toLowerCase().replace("_", " ")} />
          <span className="tag lc">{t.estimatedHours} h estimated</span>
          <button type="button" className="g-link quiet p-review" aria-pressed={t.needsReview} onClick={() => void patchTopic(t.id, { needsReview: !t.needsReview })}>
            {t.needsReview ? "Marked for review" : "Mark for review"}
          </button>
        </div>
        <p className="note" style={{ borderLeftColor: d.color }}>{t.description}</p>

        <h3 className="p-h">Sub-topics</h3>
        <ul className="checks">
          {t.subtopics.map((s) => (
            <li key={s.id}>
              <label>
                <input type="checkbox" checked={!!s.completedAt} onChange={(e) => void toggleSubtopic(t.id, s.id, e.target.checked)} />
                <span>{s.name}</span>
              </label>
              {/* Recall (docs/Recall-Plan.md): when it comes back, how the last check went, and a way to recall now. */}
              {s.completedAt && s.recall && (
                <div className="rc-sub">
                  <span className="m">
                    <span aria-hidden="true">↻ </span>
                    {s.recall.nextDueDate ? (s.recall.nextDueDate <= today ? "Recall due now" : `Recall on ${dayMonth(s.recall.nextDueDate)}`) : "No recall planned"}
                    {s.recall.last && ` · last: ${s.recall.last.outcome ? OUTCOME[s.recall.last.outcome] : `${Math.round(s.recall.last.score * 100)} %`}, ${dayMonth(s.recall.last.date)}`}
                  </span>
                  {s.recall.nextDueDate && (
                    <button type="button" className="g-link" onClick={() => openPage(recallHash(s.id))} aria-label={`Recall ${s.name} now`}>Recall now</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        {t.resources.length > 0 && (
          <>
            <h3 className="p-h">Resources</h3>
            <ul className="g-group p-links">
              {t.resources.map((r) => (
                <li key={r.url}>
                  <a className="g-row" href={r.url} target="_blank" rel="noopener noreferrer">
                    <span className="g-lbl">{r.label}<small>{KIND[r.kind]} · opens in a new tab</small></span>
                    <Chevron />
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}

        <h3 className="p-h">Practical milestone</h3>
        <div className="pbox">
          <p>{t.exercise}</p>
          {demonstrated ? (
            <>
              <p className="p-done">
                Demonstrated {t.demonstratedAt ? dayMonth(t.demonstratedAt.slice(0, 10)) : ""}
                {t.demonstrationNote ? ` · ${t.demonstrationNote}` : ""}
              </p>
              <div className="p-acts">
                <button type="button" className="btn" onClick={() => void patchTopic(t.id, { demonstrated: false })}>Undo demonstration</button>
              </div>
            </>
          ) : (
            <div className="p-form">
              <label>
                Evidence (optional: repo link, note)
                <input className="inp" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. github.com/you/typed-client" />
              </label>
              <button type="button" className="btn primary" onClick={() => void patchTopic(t.id, { demonstrated: true, demonstrationNote: note })}>Mark as demonstrated</button>
            </div>
          )}
          <p className="p-foot">Finishing the sub-topics is learning. Doing this exercise on your own is the demonstration.</p>
        </div>

        {t.dependsOn.length > 0 && (
          <>
            <h3 className="p-h">Builds on</h3>
            <div className="g-pills">
              {t.dependsOn.map((id) => {
                const dep = topicById.get(id);
                return (
                  <button key={id} type="button" className="g-pill" onClick={() => onOpenTopic(id)}>
                    {dep?.name ?? id}
                    {dep?.status === "DEMONSTRATED" && <><span aria-hidden="true"> ✓</span><span className="sr"> (demonstrated)</span></>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <h3 className="p-h">Schedule</h3>
        <div className="pbox">
          <p>
            {t.firstDate && t.lastDate
              ? `Planned ${shortDate(t.firstDate)}${t.lastDate !== t.firstDate ? ` – ${shortDate(t.lastDate)}` : ""}`
              : t.priority === "OPTIONAL"
                ? "Optional: not in the plan. Add it to a day if you want to study it."
                : "No tasks scheduled."}
            {" · "}{hm(t.plannedMinutes)} planned · {hm(t.loggedMinutes)} logged
          </p>
          <div className="p-acts">
            <button type="button" className="btn" onClick={() => openPage(addTaskHash(today, t.id))}>Add to a day</button>
          </div>
        </div>

        <h3 className="p-h">District goal · {d.name}</h3>
        <div className="pbox">
          <p>{d.goal}</p>
          <p className="p-muted">{d.note}</p>
        </div>

        <nav className="pnav" aria-label="Topics in route order">
          <button type="button" className="btn" disabled={!prev} onClick={() => prev && onOpenTopic(prev.topic.id)}>← Previous</button>
          <button type="button" className="btn" disabled={!next} onClick={() => next && onOpenTopic(next.topic.id)}>Next →</button>
        </nav>
      </div>
    </section>
  );
}
