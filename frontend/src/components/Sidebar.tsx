/**
 * The city's index (DESIGN.md §4, glass §10): which city, how far along the road, and its districts in route order, each
 * opening to its buildings. Today, the forecast and how progress is counted live on their own tabs, so they are not
 * repeated here. On a narrow screen it is a drawer that is out of reach while closed.
 */
import { useEffect, useRef, useState } from "react";
import { INK, mix } from "../lib/color";
import { pct } from "../lib/format";
import { LAYERS, LAYER_SUB } from "../lib/layers";
import { useAppData } from "../state/AppData";
import { Bar } from "./ui";
import { useSession } from "../state/Session";
import { Close } from "./recall/icons";

interface Props {
  selectedId: string | null;
  open: boolean;
  /** Closed drawer on a narrow screen: removed from the tab order and from screen readers. */
  hidden: boolean;
  onClose: () => void;
  onOpenTopic: (topicId: string) => void;
  onOpenDistrict: (districtIdx: number) => void;
}

export function Sidebar({ selectedId, open, hidden, onClose, onOpenTopic, onOpenDistrict }: Props) {
  const { curriculum, progress } = useAppData();
  const { city } = useSession();
  const [openDist, setOpenDist] = useState<Set<number>>(new Set());
  const initialised = useRef(false);

  // On first load, open the current district's card (without moving the camera).
  useEffect(() => {
    if (initialised.current || !progress) return;
    initialised.current = true;
    setOpenDist(new Set([progress.road.currentDistrictIndex]));
  }, [progress]);

  const cls = `gl side${open ? " open" : ""}`;
  if (!curriculum || !progress) return <aside className={cls} aria-label="Districts" inert={hidden} />;

  const floors = progress.districts.reduce((a, d) => a + d.subtopicsLearned, 0);
  const total = progress.districts.reduce((a, d) => a + d.subtopicsTotal, 0);

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
    <aside className={cls} aria-label="Districts" inert={hidden}>
      <button type="button" className="side-close" aria-label="Close districts" onClick={onClose}><Close /></button>
      <p className="kick">{city?.name ?? "Blueprint"}</p>
      <h1 className="side-goal">{city?.goal || city?.name || "Roadmap"}</h1>
      {city?.description && <p className="g-sub side-desc">{city.description}</p>}

      <div className="side-road">
        <p><b>{pct(progress.road.overall)}</b> of the road · {floors} of {total} floors</p>
        <Bar value={progress.road.overall} />
      </div>

      {[1, 2, 3, 4, 5].map((L) => {
        const ds = curriculum.districts.filter((d) => d.layer === L);
        if (!ds.length) return null;
        return (
          <section className="side-layer" key={L} aria-label={city?.template === "engineering" ? `${LAYERS[L]}: ${LAYER_SUB[L]}` : "Districts"}>
            <h2 className="g-cap">
              {/* The layer names belong to the Engineering City; other cities just list their districts. */}
              {city?.template === "engineering" ? <><span className="side-num">0{L}</span>{LAYERS[L]} · {LAYER_SUB[L]}</> : "Districts"}
            </h2>
            {ds.map((d) => {
              const p = progress.districts.find((x) => x.id === d.id)!;
              return (
                <details key={d.id} className="dist" open={openDist.has(d.position)} onToggle={(e) => toggle(d.position, (e.target as HTMLDetailsElement).open)}>
                  <summary>
                    <span className="dot" style={{ background: d.color }} />
                    <span className="dname">
                      {d.position + 1}. {d.name}
                      {p.passed && <><span aria-hidden="true"> ✓</span><span className="sr"> (passed)</span></>}
                    </span>
                    <span className="dnum">{p.subtopicsLearned}/{p.subtopicsTotal}<span className="sr"> floors</span></span>
                    <span className="dsub">{d.subtitle}</span>
                    <span className="dbar" aria-hidden="true">
                      <i style={{ width: `${p.subtopicsTotal ? (p.subtopicsLearned / p.subtopicsTotal) * 100 : 0}%`, background: mix(d.color, INK, 0.15) }} />
                    </span>
                  </summary>
                  <ul className="blist">
                    {d.topics.map((t) => {
                      const k = t.subtopics.filter((s) => s.completedAt).length;
                      const c = [t.id === selectedId && "on", t.status === "DEMONSTRATED" && "full", t.priority === "OPTIONAL" && "opt"].filter(Boolean).join(" ");
                      return (
                        <li key={t.id}>
                          <button type="button" className={c} aria-current={t.id === selectedId ? "true" : undefined} onClick={() => onOpenTopic(t.id)}>
                            <span className="n">{t.name}{t.status === "DEMONSTRATED" && <span className="sr"> (demonstrated)</span>}</span>
                            <span className="c">{t.priority === "OPTIONAL" ? "optional · " : ""}{k}/{t.subtopics.length}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              );
            })}
          </section>
        );
      })}
    </aside>
  );
}
