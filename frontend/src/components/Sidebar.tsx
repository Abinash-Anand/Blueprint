import { useEffect, useRef, useState } from "react";
import type { Today } from "../api/types";
import { INK, mix } from "../lib/color";
import { hm, pct, shortDate } from "../lib/format";
import { LAYERS, LAYER_SUB } from "../lib/layers";
import { useAppData } from "../state/AppData";
import { Bar } from "./ui";

interface Props {
  today: Today | null;
  selectedId: string | null;
  open: boolean;
  onOpenTopic: (topicId: string) => void;
  onOpenDistrict: (districtIdx: number) => void;
  onOpenToday: () => void;
}

export function Sidebar({ today, selectedId, open, onOpenTopic, onOpenDistrict, onOpenToday }: Props) {
  const { curriculum, progress, topicById, districtById } = useAppData();
  const [openDist, setOpenDist] = useState<Set<number>>(new Set());
  const initialised = useRef(false);

  // On first load, open the current district's card (without moving the camera).
  useEffect(() => {
    if (initialised.current || !progress) return;
    initialised.current = true;
    setOpenDist(new Set([progress.road.currentDistrictIndex]));
  }, [progress]);

  if (!curriculum || !progress) return <aside className={open ? "open" : ""} aria-label="Roadmap overview" />;

  const floors = progress.districts.reduce((a, d) => a + d.subtopicsLearned, 0);
  const total = progress.districts.reduce((a, d) => a + d.subtopicsTotal, 0);
  const road = progress.road;
  const curTopic = today?.current.topicId ? topicById.get(today.current.topicId) : undefined;
  const curDistrict = curTopic ? districtById.get(curTopic.districtId) : undefined;
  const doneTasks = today?.tasks.filter((t) => t.status === "DONE").length ?? 0;
  const liveTasks = today?.tasks.filter((t) => t.status !== "SKIPPED").length ?? 0;

  const toggle = (idx: number, isOpen: boolean) => {
    if (isOpen === openDist.has(idx)) return; // re-render of an already-open card: no camera move
    if (isOpen) onOpenDistrict(idx); // fly only when the user opens it (DESIGN.md §6)
    setOpenDist((s) => {
      const n = new Set(s);
      if (isOpen) n.add(idx);
      else n.delete(idx);
      return n;
    });
  };

  return (
    <aside className={open ? "open" : ""} aria-label="Roadmap overview">
      <p className="brand">Engineering City</p>
      <h1>Full-stack engineer roadmap</h1>
      <p className="goal">
        Become a strong full-stack software engineer, with foundations in software architecture, cloud engineering and applied AI.
        17 Nov 2026 – 17 Aug 2027.
      </p>

      <div className="overall">
        <div className="row">
          <span>
            <span className="big">{pct(road.overall)}</span> of the road
          </span>
          <span>
            {floors} of {total} floors
          </span>
        </div>
        <Bar value={road.overall} />
      </div>

      {today && (
        <div className="next">
          <div className="k">Today · {shortDate(today.date)}</div>
          {today.isRestDay ? (
            <div className="t">Rest day. Optional revision only.</div>
          ) : (
            <>
              <div className="t">
                {curDistrict ? `${curDistrict.name} › ` : ""}
                <b>{curTopic?.name ?? "No topic"}</b>
                <br />
                <span style={{ color: "var(--muted)", fontSize: 13 }}>
                  {hm(today.actualMinutes)} of {hm(today.targetMinutes)} · {doneTasks} of {liveTasks} tasks done
                </span>
              </div>
              <Bar value={today.targetMinutes ? today.actualMinutes / today.targetMinutes : 0} />
            </>
          )}
          <div style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={onOpenToday}>
              Open today
            </button>
          </div>
        </div>
      )}

      {today?.next && topicById.get(today.next.topicId) && (
        <div className="next">
          <div className="k">Next up</div>
          <div className="t">
            {districtById.get(topicById.get(today.next.topicId)!.districtId)?.name} › {topicById.get(today.next.topicId)!.name}
            {today.next.subtopic && (
              <>
                {" "}
                › <b>{today.next.subtopic}</b>
              </>
            )}
          </div>
          <button className="btn" onClick={() => onOpenTopic(today.next!.topicId)}>
            Go there
          </button>
        </div>
      )}

      <p className="how">
        Each sub-topic you learn adds a floor. A roof goes on only when you have demonstrated the skill yourself. The car moves as you
        demonstrate core topics, not as the calendar moves.
      </p>

      {[1, 2, 3, 4, 5].map((L) => {
        const ds = curriculum.districts.filter((d) => d.layer === L);
        if (!ds.length) return null;
        return (
          <div className="layer" key={L}>
            <h3>
              <span>0{L}</span>
              {LAYERS[L]} · {LAYER_SUB[L]}
            </h3>
            {ds.map((d) => {
              const p = progress.districts.find((x) => x.id === d.id)!;
              return (
                <details
                  key={d.id}
                  className="dist"
                  open={openDist.has(d.position)}
                  onToggle={(e) => toggle(d.position, (e.target as HTMLDetailsElement).open)}
                >
                  <summary>
                    <span className="dot" style={{ background: d.color }} />
                    <span className="dname">
                      {d.position + 1}. {d.name}
                      {p.passed ? " ✓" : ""}
                    </span>
                    <span className="dnum">
                      {p.subtopicsLearned}/{p.subtopicsTotal}
                    </span>
                    <span className="dsub">{d.subtitle}</span>
                    <span className="dbar">
                      <i style={{ width: `${p.subtopicsTotal ? (p.subtopicsLearned / p.subtopicsTotal) * 100 : 0}%`, background: mix(d.color, INK, 0.15) }} />
                    </span>
                  </summary>
                  <ul className="blist">
                    {d.topics.map((t) => {
                      const k = t.subtopics.filter((s) => s.completedAt).length;
                      const cls = [t.id === selectedId && "on", t.status === "DEMONSTRATED" && "full", t.priority === "OPTIONAL" && "opt"].filter(Boolean).join(" ");
                      return (
                        <li key={t.id}>
                          <button className={cls} onClick={() => onOpenTopic(t.id)}>
                            <span className="n">{t.name}</span>
                            <span className="c">
                              {t.priority === "OPTIONAL" ? "optional · " : ""}
                              {k}/{t.subtopics.length}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              );
            })}
          </div>
        );
      })}

      <div className="foot">
        Progress is saved in your local PostgreSQL database (Docker volume <code>pgdata</code>). See the README for backup and reset.
      </div>
    </aside>
  );
}
