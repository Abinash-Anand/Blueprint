/**
 * Flow kit preview (development only, npm run dev → /kit-preview.html): every building block of the city creation
 * flow in a phone-sized frame, with live state, to check look, keyboard use and reduced motion before the real screens
 * use them. Nothing here is part of the app bundle.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { CheckRow, DayToggles, DisclosureRow, FlowHeader, Group, NumberStepper, Pill, Segmented, Sheet, SwitchRow, TextRow } from "./components/kit";
import { CityPreview, type PreviewDistrict } from "./components/cities/create/CityPreview";
import "./styles.css";

const NAMES = ["Grammar Foundations", "Listening", "Speaking", "Professional German"];
function HeroDemo() {
  const [written, setWritten] = useState(-1); // -1: confirmed (step 2/3); 0..4 while building
  const ds: PreviewDistrict[] = NAMES.map((name, i) => ({ name, state: written < 0 || i < written ? "planned" : "ghost", topics: [3, 4, 5, 3, 4, 6] }));
  return (
    <div className="card" style={{ width: "min(400px,100%)", padding: "16px 18px 22px", borderRadius: 24 }}>
      <h2 style={{ fontSize: 22, margin: "4px 0 8px" }}>City preview</h2>
      <CityPreview districts={ds} caption={written < 0 ? "4 districts · Finishes around 23 November 2027" : `${Math.max(0, written)} of 4 districts written`} />
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={() => setWritten(0)}>Start building</button>
        <button className="btn" onClick={() => setWritten((w) => Math.min(4, w + 1))}>Write next district</button>
        <button className="btn" onClick={() => setWritten(-1)}>Reset</button>
      </div>
      <div style={{ marginTop: 12 }}><CityPreview districts={[]} /></div>
    </div>
  );
}

const PACES = [
  { value: "LIGHT", label: "Light", hint: "More revision and slack days" },
  { value: "STEADY", label: "Steady", hint: "A balance of new topics and revision" },
  { value: "INTENSIVE", label: "Intensive", hint: "Mostly new material, little slack" },
] as const;
const FOCUS = [
  { value: "speak", label: "Speaking" },
  { value: "both", label: "Both" },
  { value: "exam", label: "Exam" },
] as const;

function Preview() {
  const [step, setStep] = useState(2);
  const [hours, setHours] = useState(1.5);
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  const [pace, setPace] = useState<string>("STEADY");
  const [focus, setFocus] = useState<string>("both");
  const [subs, setSubs] = useState<[string, boolean][]>([["Grammar", true], ["Vocabulary", true], ["Listening", true], ["Speaking", true], ["Writing", false]]);
  const [ok, setOk] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [pill, setPill] = useState<string | null>(null);
  const [motion, setMotion] = useState(false);
  const kept = subs.filter(([, on]) => on).length;

  return (
    <div style={{ minHeight: "100vh", overflowY: "auto", padding: "24px 16px", display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap", alignItems: "flex-start" }}>
      <div className="card" style={{ width: "min(400px,100%)", padding: "16px 18px 22px", borderRadius: 24 }}>
        <FlowHeader step={step} total={4} onBack={step > 1 ? () => setStep(step - 1) : undefined} onCancel={() => setStep(1)} />
        <h2 style={{ fontSize: 22, margin: "14px 0 4px" }}>How much time do you have?</h2>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 16px" }}>Your plan never asks for more than this.</p>
        <NumberStepper label="Hours a day" value={hours} min={0.5} max={6} step={0.5} unit="hours a day" onChange={setHours} />
        <div style={{ margin: "16px 0" }}><DayToggles value={days} onChange={setDays} /></div>
        <Segmented label="Pace" options={[...PACES]} value={pace} onChange={setPace} />
        <div style={{ margin: "18px 0 6px" }}>
          <p className="kit-caption">Examples</p>
          {["A language", "An exam", "A new career"].map((p) => <span key={p} style={{ marginRight: 6 }}><Pill pressed={pill === p} onClick={() => setPill(p)}>{p}</Pill></span>)}
        </div>
        <button className="btn primary wide" style={{ marginTop: 14 }} onClick={() => setSheet(true)}>Continue</button>
      </div>

      <div className="card" style={{ width: "min(400px,100%)", padding: "16px 18px 22px", borderRadius: 24 }}>
        <h2 style={{ fontSize: 22, margin: "4px 0 12px" }}>Here's what I understood</h2>
        <Group caption="Goal">
          <DisclosureRow label="German C1, for work" onClick={() => {}} />
          <DisclosureRow label="Starting level" value="A2" onClick={() => {}} />
        </Group>
        <p className="kit-caption">Focus</p>
        <div style={{ marginBottom: 14 }}><Segmented label="Focus" options={[...FOCUS]} value={focus} onChange={setFocus} /></div>
        <Group caption="Districts" footer={`${kept} districts · tap to leave one out`}>
          {subs.map(([name, on], i) => (
            <CheckRow key={name} label={name} checked={on} disabled={on && kept === 1} onToggle={() => setSubs(subs.map((s, j) => (j === i ? [s[0], !s[1]] : s)))} />
          ))}
        </Group>
        <Group>
          <SwitchRow label="Send my goal and time to GWDG Academic Cloud" description="GWDG states it doesn't store it." checked={ok} onChange={setOk} />
          <TextRow>Plain row for read-only text</TextRow>
        </Group>
        <Group>
          <SwitchRow label="Reduced motion" description="Preview only: sets data-motion on the page." checked={motion} onChange={(v) => { setMotion(v); document.documentElement.dataset.motion = v ? "reduce" : "full"; }} />
        </Group>
      </div>

      <HeroDemo />

      <Sheet open={sheet} title="Allow Blueprint to use GWDG?" onClose={() => setSheet(false)}>
        <p>Blueprint uses GWDG Academic Cloud to understand your goal and build your city. GWDG states it doesn't store what you send.</p>
        <button className="btn primary wide" onClick={() => setSheet(false)}>Allow</button>
        <button className="btn wide" style={{ marginTop: 8, background: "none", border: 0, color: "var(--accent)" }} onClick={() => setSheet(false)}>Not now</button>
      </Sheet>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Preview /></StrictMode>);
