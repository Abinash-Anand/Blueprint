/** Building details (DESIGN.md §5, extended per SRS FR-MAP-04/06/10). */
import { type Ref, useEffect, useState } from "react";
import { api } from "../api/client";
import { INK, mix } from "../lib/color";
import { PRIORITY_LABEL, dayMonth, hm, shortDate } from "../lib/format";
import { LAYERS } from "../lib/layers";
import type { Building } from "../map/geometry";
import { useAppData } from "../state/AppData";
import { RevisionBox } from "./RevisionBox";
import { Bar } from "./ui";
import { StatusIndicator } from "./Status";

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
  const { toggleSubtopic, patchTopic, mutate, topicById } = useAppData();
  const t = building.topic;
  const d = building.block.district;
  const n = t.subtopics.length;
  const k = t.subtopics.filter((s) => s.completedAt).length;
  const demonstrated = t.status === "DEMONSTRATED";
  const [note, setNote] = useState(t.demonstrationNote ?? "");
  const [sched, setSched] = useState<{ date: string; minutes: number } | null>(null);

  useEffect(() => {
    setNote(t.demonstrationNote ?? "");
    setSched(null);
  }, [t.id, t.demonstrationNote]);

  const prev = route[building.ri - 1];
  const next = route[building.ri + 1];

  const addTask = async () => {
    if (!sched) return;
    const r = await mutate(() =>
      api.createTask({ title: `Study: ${t.name}`, scheduledDate: sched.date, estimatedMinutes: sched.minutes, topicId: t.id, kind: "STUDY" }),
    );
    if (r) setSched(null);
  };

  return (
    <section className="panel" ref={ref} aria-live="polite" aria-label={`Topic: ${t.name}`}>
      <div className="pstripe" style={{ background: d.color }} />
      <button className="close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      <div className="pin">
        <div className="pk">
          0{d.layer} · {LAYERS[d.layer]} · {d.name}
        </div>
        <h2>{t.name}</h2>
        <div className="pmeta">
          {k} of {n} floors built{demonstrated ? " · demonstrated" : k === n ? " · learned" : ""}
        </div>
        <Bar value={n ? (demonstrated ? 1 : k / n) : 0} color={mix(d.color, INK, 0.15)} />
        <div className="tags">
          <span className={`tag ${t.priority === "CORE" ? "ink" : ""}`}>{PRIORITY_LABEL[t.priority]}</span>
          <StatusIndicator p={t.presentation} fallback={t.status.toLowerCase().replace("_", " ")} />
          <span className="tag">{t.estimatedHours} h estimated</span>
        </div>
        <p className="note" style={{ borderLeftColor: d.color }}>
          {t.description}
        </p>

        <ul className="checks" aria-label="Sub-topics">
          {t.subtopics.map((s) => (
            <li key={s.id}>
              <label>
                <input type="checkbox" checked={!!s.completedAt} onChange={(e) => void toggleSubtopic(t.id, s.id, e.target.checked)} />
                <span>{s.name}</span>
              </label>
            </li>
          ))}
        </ul>

        <div className="pbox">
          <b>Practical milestone</b>
          <p>{t.exercise}</p>
          {demonstrated ? (
            <>
              <p>
                Demonstrated {t.demonstratedAt ? dayMonth(t.demonstratedAt.slice(0, 10)) : ""}
                {t.demonstrationNote ? ` · ${t.demonstrationNote}` : ""}
              </p>
              <div style={{ marginTop: 8 }}>
                <button className="btn" onClick={() => void patchTopic(t.id, { demonstrated: false })}>
                  Undo demonstration
                </button>
              </div>
            </>
          ) : (
            <div className="form" style={{ marginTop: 8 }}>
              <label className="grow">
                Evidence (optional: repo link, note)
                <input className="inp" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. github.com/you/typed-client" />
              </label>
              <button className="btn primary" onClick={() => void patchTopic(t.id, { demonstrated: true, demonstrationNote: note })}>
                Mark as demonstrated
              </button>
            </div>
          )}
          <p style={{ fontSize: 12.5 }}>Finishing the sub-topics is learning. Doing this exercise on your own is the demonstration.</p>
        </div>

        <RevisionBox topicId={t.id} />

        {t.dependsOn.length > 0 && (
          <div className="pbox">
            <b>Builds on</b>
            <div className="tags" style={{ marginTop: 4 }}>
              {t.dependsOn.map((id) => {
                const dep = topicById.get(id);
                return (
                  <button key={id} className="btn" style={{ padding: "3px 9px", fontSize: 12.5 }} onClick={() => onOpenTopic(id)}>
                    {dep?.name ?? id}
                    {dep?.status === "DEMONSTRATED" ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="pbox">
          <b>Schedule</b>
          <p>
            {t.firstDate && t.lastDate
              ? `Planned ${shortDate(t.firstDate)}${t.lastDate !== t.firstDate ? ` – ${shortDate(t.lastDate)}` : ""}`
              : t.priority === "OPTIONAL"
                ? "Optional: not in the plan. Add it to a day if you want to study it."
                : "No tasks scheduled."}
          </p>
          <p>
            {hm(t.plannedMinutes)} planned · {hm(t.loggedMinutes)} logged
          </p>
          {sched ? (
            <div className="form">
              <label>
                Day
                <input className="inp" type="date" value={sched.date} min={today} onChange={(e) => setSched({ ...sched, date: e.target.value })} />
              </label>
              <label>
                Minutes
                <input
                  className="inp"
                  type="number"
                  min={5}
                  max={720}
                  step={15}
                  value={sched.minutes}
                  style={{ width: 80 }}
                  onChange={(e) => setSched({ ...sched, minutes: Number(e.target.value) })}
                />
              </label>
              <button className="btn primary" onClick={() => void addTask()} disabled={!sched.date || sched.minutes < 5}>
                Add
              </button>
              <button className="btn" onClick={() => setSched(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="tags">
              <button className="btn" onClick={() => setSched({ date: today, minutes: 60 })}>
                Add to a day…
              </button>
              <button className="btn" onClick={() => void patchTopic(t.id, { needsReview: !t.needsReview })}>
                {t.needsReview ? "Clear review flag" : "Mark for review"}
              </button>
            </div>
          )}
        </div>

        <div className="pbox">
          <b>District goal · {d.name}</b>
          <p>{d.goal}</p>
          <p>{d.note}</p>
        </div>

        {t.resources.length > 0 && (
          <div className="pbox">
            <b>Resources</b>
            <ul>
              {t.resources.map((r) => (
                <li key={r.url}>
                  <a href={r.url} target="_blank" rel="noopener noreferrer">
                    {r.label}
                  </a>{" "}
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>· {KIND[r.kind]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="pnav">
          <button className="btn" disabled={!prev} onClick={() => prev && onOpenTopic(prev.topic.id)}>
            ← Previous
          </button>
          <button className="btn" disabled={!next} onClick={() => next && onOpenTopic(next.topic.id)}>
            Next →
          </button>
        </div>
      </div>
    </section>
  );
}
