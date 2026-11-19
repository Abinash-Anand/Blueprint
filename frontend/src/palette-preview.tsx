/**
 * Palette preview (development only, npm run dev → /palette-preview.html): the live design tokens rendered with the
 * real components and classes, plus measured contrast ratios. Used to check a palette change before applying it:
 * put proposed values in a scoped class next to the live panel. Nothing here is part of the app bundle.
 */
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Presentation, Tone } from "./api/types";
import { FeedbackMessage, LoadingState, StatusBadge, StatusIndicator } from "./components/Status";
import { contrast } from "./lib/contrast";
import "./styles.css";

const TONES: Tone[] = ["success", "warning", "danger", "info", "neutral", "ai"];
const SAMPLE: Record<Tone, [string, string]> = {
  success: ["Demonstrated", "check-circle"], warning: ["Correct the gap first", "edit"], danger: ["2 days overdue", "alert-circle"],
  info: ["Due today", "clock"], neutral: ["Not started", "circle"], ai: ["Suggests 2 · Recalled", "sparkle"],
};
const p = (tone: Tone, variant: Presentation["variant"], label = SAMPLE[tone][0]): Presentation => ({ state: `x.${tone}`, tone, variant, icon: SAMPLE[tone][1], label });

function Ratios() {
  const ref = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<[string, number, number, number, number][]>([]);
  useEffect(() => {
    const cs = getComputedStyle(ref.current!);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    setRows(TONES.map((t) => [t, contrast(v(`--${t}`), v(`--${t}-bg`)), contrast(v(`--${t}`), "#f6f4ef"), contrast("#ffffff", v(`--${t}-solid`) || v(`--${t}`)), contrast(v(`--${t}-mid`) || v(`--${t}`), v(`--${t}-bg`))]));
  }, []);
  return (
    <div ref={ref}>
      <table className="dtable">
        <thead><tr><th>Tone</th><th>Text on soft</th><th>Text on paper</th><th>White on solid</th><th>Icon on soft</th></tr></thead>
        <tbody>
          {rows.map(([t, a, b, c, d]) => (
            <tr key={t}><td>{t}</td>{[a, b, c].map((x, i) => <td key={i} className={x < 4.5 ? "pv-bad" : ""}>{x.toFixed(2)}</td>)}<td className={d < 3 ? "pv-bad" : ""}>{d.toFixed(2)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="sub">Text needs 4.5:1, icons 3:1 (WCAG 2.2 AA).</p>
    </div>
  );
}

function Panel({ title }: { title: string }) {
  return (
    <div className="pv-col">
      <h2>{title}</h2>
      <div className="section"><h3>Badges</h3>
        {(["soft", "solid", "outline", "plain"] as const).map((v) => (
          <div className="tags" key={v}>{TONES.map((t) => <StatusBadge key={t} p={p(t, v)} />)}</div>
        ))}
      </div>
      <div className="section"><h3>Buttons</h3>
        <div className="tags">
          <button className="btn primary">Revise</button><button className="btn">Reschedule</button>
          <button className="btn" aria-pressed="true">Selected</button><button className="btn danger">Delete</button>
          <button className="btn danger solid">Delete city</button><button className="btn" disabled>Disabled</button>
          <button className="btn primary" aria-busy="true" disabled>Saving</button>
        </div>
      </div>
      <div className="section"><h3>Navigation</h3>
        <nav className="tabs" aria-label="Preview tabs">
          <button aria-selected="true">Today</button><button>Week</button><button>Revision <span className="tbadge t-danger">3</span></button><button>City</button>
        </nav>
        <div className="tags" style={{ marginTop: 10 }}><button className="btn" style={{ boxShadow: "var(--focus-ring)" }}>Focused button</button></div>
      </div>
      <div className="section"><h3>Status in context</h3>
        <ul className="tasks">
          <li className="task"><div className="top"><input type="checkbox" readOnly /><div className="body"><div className="ttl">Generics</div><div className="meta"><span className="tag kind">Study</span><StatusBadge p={p("danger", "soft", "1 day overdue")} /></div></div></div></li>
          <li className="task done"><div className="top"><input type="checkbox" checked readOnly /><div className="body"><div className="ttl">Utility types</div><div className="meta"><StatusBadge p={p("success", "soft", "Done")} /></div></div></div></li>
          <li className="task"><div className="top"><span className="rvmark">↻</span><div className="body"><div className="ttl">Revise: Narrowing</div><div className="meta"><StatusIndicator p={{ ...p("danger", "soft", "3 days overdue"), flags: [p("warning", "outline", "Weak")] }} detail="due 15 Nov" /></div></div></div></li>
        </ul>
      </div>
      <div className="section"><h3>Cards and feedback</h3>
        <div className="grid3">
          <div className="card stat"><div className="kick">Due now</div><div className="v">4</div><div className="d"><StatusBadge p={p("danger", "soft", "2 overdue")} /></div></div>
          <div className="card stat"><div className="kick">Stage</div><div className="v">Frontend</div><div className="d"><StatusBadge p={p("warning", "soft", "Behind")} /></div></div>
          <div className="card stat interactive"><div className="kick">District</div><div className="v">Backend</div><div className="d"><StatusBadge p={p("info", "soft", "Current")} /></div></div>
        </div>
        <FeedbackMessage tone="success"><p>Recorded as "Recalled". Next revision due Sat 21 Nov.</p></FeedbackMessage>
        <FeedbackMessage tone="danger"><p>The AI check couldn't run: the provider is overloaded.</p></FeedbackMessage>
        <div style={{ marginTop: 10 }}><LoadingState tone="ai" text="Checking your answer…" /></div>
      </div>
      <div className="section"><h3>Contrast (measured)</h3><Ratios /></div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <style>{`body{overflow:auto}.pv{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;padding:24px;max-width:760px;margin:0 auto}
      .pv-col{background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:16px 18px}.pv-col h2{margin:0 0 4px;font-size:18px}
      .pv-bad{color:#a1261d;font-weight:700}@media(max-width:900px){.pv{grid-template-columns:minmax(0,1fr)}}`}</style>
    <div className="pv">
      <Panel title="Live palette" />
    </div>
  </StrictMode>,
);
