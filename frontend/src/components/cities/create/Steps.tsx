/**
 * The four screens of city creation (one question each) and the small sheet that edits one value. They only render
 * and report; saving, AI calls and navigation live in CreateCity.tsx.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { CityAttachment, CityProposal, CurriculumVersion, Understanding } from "../../../api/types";
import { dayMonth, plural } from "../../../lib/format";
import { CheckRow, DayToggles, DisclosureRow, Group, NumberStepper, Pill, Segmented, Sheet, TextRow } from "../../kit";
import { FeedbackMessage, LoadingState } from "../../Status";
import { canRecord, Recorder } from "../../voice/Recorder";
import { type Pace, type TimeInput, type TimePlan, fileSummary, longDate } from "./logic";

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="cc-head">
      <h2 className="cc-title">{children}</h2>
      {sub && <p className="cc-sub">{sub}</p>}
    </div>
  );
}

/* ---------------- edit one value ---------------- */

export interface EditRequest { title: string; label: string; value: string; kind?: "text" | "longtext" | "date" | "number"; clearLabel?: string; min?: string; max?: string; onSave: (v: string) => void }

export function EditSheet({ req, onClose }: { req: EditRequest | null; onClose: () => void }) {
  const [v, setV] = useState("");
  useEffect(() => setV(req?.value ?? ""), [req]);
  if (!req) return null;
  const kind = req.kind ?? "text";
  const save = (value: string) => { req.onSave(value); onClose(); };
  return (
    <Sheet open title={req.title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim() || kind === "date") save(v.trim()); }}>
        <label className="af">
          {req.label}
          {kind === "longtext"
            ? <textarea className="inp" value={v} maxLength={500} rows={3} onChange={(e) => setV(e.target.value)} />
            : <input className="inp" type={kind === "number" ? "number" : kind} value={v} min={req.min} max={req.max} maxLength={kind === "text" ? 80 : undefined} onChange={(e) => setV(e.target.value)} />}
        </label>
        <button className="btn primary wide" style={{ marginTop: 14 }} disabled={!v.trim()}>Save</button>
        {req.clearLabel && <button type="button" className="btn wide cc-quiet" onClick={() => save("")}>{req.clearLabel}</button>}
      </form>
    </Sheet>
  );
}

/* ---------------- 1 · What would you like to learn? ---------------- */

const EXAMPLES: [string, string][] = [
  ["A language", "I want to reach German B2 so I can work in Germany. I'm around A2 now and I like learning with podcasts."],
  ["An exam", "I want to pass the AWS Solutions Architect Associate exam. I know Linux and some Docker."],
  ["A new career", "I want to move into full-stack development with Java and Angular. I know basic Java and HTML."],
];

export function GoalStep(p: {
  brief: string; onBrief: (v: string) => void;
  files: CityAttachment[]; onAddFiles: (fs: File[]) => void; onRemoveFile: (id: number) => void; uploading: boolean;
  canSpeak: boolean; onSpeakWithoutConsent: () => void; transcribe: (wav: Blob) => Promise<{ text: string }>;
  aiOff: boolean; busy: boolean; error: string | null; onContinue: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [invalid, setInvalid] = useState(false);
  const go = () => {
    if (!p.brief.trim()) { setInvalid(true); return; }
    p.onContinue();
  };
  return (
    <>
      <Title sub="Say it in your own words: what, why, where you're starting from. Blueprint works out the rest.">What would you like to learn?</Title>
      {p.aiOff && <FeedbackMessage tone="warning"><p>AI is switched off on this server, so cities can't be built from a description right now.</p></FeedbackMessage>}
      <label className="sr" htmlFor="cc-goal">What would you like to learn?</label>
      <textarea
        id="cc-goal" className="inp cc-goal" value={p.brief} maxLength={4000} rows={5} aria-invalid={invalid || undefined} aria-describedby={invalid ? "cc-goal-err" : undefined}
        placeholder="I want to reach German C1 so I can work in Germany…" onChange={(e) => { p.onBrief(e.target.value); setInvalid(false); }}
      />
      {invalid && <p className="af-err" id="cc-goal-err">Tell Blueprint what you'd like to learn first.</p>}
      <div className="cc-under">
        {canRecord() && (p.canSpeak
          ? <Recorder transcribe={p.transcribe} maxSeconds={60} maxBytes={4 * 1024 * 1024} label="Speak instead" workingText="Writing down what you said…" onTranscript={(t) => p.onBrief(p.brief ? `${p.brief.trimEnd()} ${t}` : t)} />
          : <button type="button" className="btn" onClick={p.onSpeakWithoutConsent}><span className="rv-dot" aria-hidden="true" /> Speak instead</button>)}
      </div>
      <div className="cc-pills" aria-label="Examples">
        {EXAMPLES.map(([label, text]) => <Pill key={label} pressed={p.brief === text} onClick={() => { p.onBrief(text); setInvalid(false); }}>{label}</Pill>)}
      </div>
      <Group caption="Your own plan (optional)" footer="PDF or text, up to 3 files. Blueprint follows its order and milestones. Only the text is kept, never the file.">
        {p.files.map((f) => (
          <div key={f.id} className="kit-row cc-file">
            <span className="kit-row-label">{f.name}<small className={f.hasText ? "" : "cc-warn"}>{fileSummary(f)}</small></span>
            <button type="button" className="kit-link quiet" onClick={() => p.onRemoveFile(f.id)} aria-label={`Remove ${f.name}`}>Remove</button>
          </div>
        ))}
        {p.files.length < 3 && (
          <DisclosureRow icon={<span>＋</span>} label={p.uploading ? "Reading the file…" : p.files.length ? "Add another file" : "Add your plan"} value="PDF or text" onClick={() => input.current?.click()} />
        )}
      </Group>
      <input ref={input} type="file" className="sr" tabIndex={-1} aria-hidden="true" multiple accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
        onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; if (fs.length) p.onAddFiles(fs); }} />
      {p.error && <FeedbackMessage tone="danger"><p>{p.error}</p></FeedbackMessage>}
      <button className="btn primary wide cc-go" aria-busy={p.busy} disabled={p.busy || p.aiOff} onClick={go}>{p.busy ? "Reading your goal…" : "Continue"}</button>
    </>
  );
}

/* ---------------- 2 · Here's what I understood ---------------- */

export interface Subject { name: string; on: boolean }

export function UnderstoodStep(p: {
  u: Understanding; onU: (u: Understanding) => void;
  subjects: Subject[]; onSubjects: (s: Subject[]) => void;
  focus: string | null; onFocus: (f: string) => void;
  answers: Record<string, string>; onAnswer: (q: string, a: string) => void;
  manual: string | null; onRetry: () => void; retrying: boolean;
  edit: (r: EditRequest) => void; error: string | null; busy: boolean; onContinue: () => void;
}) {
  const kept = p.subjects.filter((s) => s.on).length;
  const field = (key: keyof Understanding, title: string, label: string, kind: EditRequest["kind"] = "text") => () =>
    p.edit({ title, label, value: String(p.u[key] ?? ""), kind, onSave: (v) => p.onU({ ...p.u, [key]: kind === "number" ? Math.max(1, Math.round(Number(v))) || undefined : v }) });
  const [missing, setMissing] = useState(false);
  return (
    <>
      <Title sub={p.manual ? undefined : "Tap anything that isn't quite right."}>Here's what I understood</Title>
      {p.manual && (
        <FeedbackMessage tone="warning">
          <p>{p.manual}</p>
          <button className="btn" aria-busy={p.retrying} disabled={p.retrying} onClick={p.onRetry}>{p.retrying ? "Reading your goal…" : "Try again"}</button>
        </FeedbackMessage>
      )}
      <Group caption="Goal">
        <DisclosureRow label="Name" value={p.u.name || "Add a name"} onClick={field("name", "Name this city", "Name")} />
        <DisclosureRow label={p.u.goal || "Describe the goal"} onClick={field("goal", "The goal", "What you'll be able to do at the end", "longtext")} />
        <DisclosureRow label="Starting level" value={p.u.currentLevel || "Add"} onClick={field("currentLevel", "Starting level", "Where you are now (e.g. A2, beginner)")} />
        <DisclosureRow label="Target level" value={p.u.targetLevel || "Add"} onClick={field("targetLevel", "Target level", "Where you want to get")} />
        <DisclosureRow label="Study time needed" value={p.u.estimatedHours ? `about ${p.u.estimatedHours} h` : "Add"} onClick={field("estimatedHours", "Study time needed", "Hours of focused study, roughly", "number")} />
      </Group>
      {!!p.u.focusOptions?.length && (
        <div className="kit-group-wrap">
          <h3 className="kit-caption">Focus</h3>
          <Segmented label="Focus" options={p.u.focusOptions.map((f) => ({ value: f, label: f }))} value={p.focus} onChange={p.onFocus} />
        </div>
      )}
      <Group caption="Districts" footer={kept ? `${plural(kept, "district")} · one per subject, in this order` : "Keep at least one district."}>
        {p.subjects.map((s, i) => (
          <CheckRow key={`${s.name}-${i}`} label={s.name} checked={s.on} disabled={s.on && kept === 1} onToggle={() => { setMissing(false); p.onSubjects(p.subjects.map((x, j) => (j === i ? { ...x, on: !x.on } : x))); }} />
        ))}
        {kept < 7 && (
          <DisclosureRow icon={<span>＋</span>} label="Add a district" onClick={() => p.edit({ title: "Add a district", label: "Subject", value: "", onSave: (v) => { setMissing(false); p.onSubjects([...p.subjects, { name: v.slice(0, 60), on: true }]); } })} />
        )}
      </Group>
      {p.u.plan && <Group caption="Your plan"><TextRow>Following your plan: {p.u.plan}</TextRow></Group>}
      {p.u.questions?.map((q) => (
        <div key={q.question} className="kit-group-wrap">
          <h3 className="kit-caption cc-q">{q.question}</h3>
          <div className="cc-pills" role="group" aria-label={q.question}>
            {q.options.map((o) => <Pill key={o} pressed={p.answers[q.question] === o} onClick={() => p.onAnswer(q.question, o)}>{o}</Pill>)}
          </div>
        </div>
      ))}
      {(!!p.u.alreadyKnown?.length || !!p.u.resources?.length) && (
        <Group caption="Also noted">
          {!!p.u.alreadyKnown?.length && <TextRow>You already know: {p.u.alreadyKnown.join(", ")}</TextRow>}
          {!!p.u.resources?.length && <TextRow>You like to use: {p.u.resources.join(", ")}</TextRow>}
        </Group>
      )}
      {missing && <p className="af-err">Add at least one district.</p>}
      {p.error && <FeedbackMessage tone="danger"><p>{p.error}</p></FeedbackMessage>}
      <button className="btn primary wide cc-go" aria-busy={p.busy} disabled={p.busy} onClick={() => (kept ? p.onContinue() : setMissing(true))}>Looks right</button>
    </>
  );
}

/* ---------------- 3 · How much time do you have? ---------------- */

export function TimeStep(p: {
  t: TimeInput; onT: (t: TimeInput) => void; plan: TimePlan; paces: Record<Pace, number>; timezone: string; onTimezone: (tz: string) => void;
  edit: (r: EditRequest) => void; error: string | null; busy: boolean; onContinue: () => void;
}) {
  const pct = (x: Pace) => `${Math.round(p.paces[x] * 100)}%`;
  const today = new Date().toISOString().slice(0, 10);
  // Pace never changes the hours or the days (they are the learner's limit): it splits those hours between new
  // material and revision, which moves the finish date. The split is shown so the choice visibly does something.
  const h1 = (x: number) => Math.round(x * 10) / 10;
  const newH = h1(p.plan.newHoursPerWeek), revH = h1(p.plan.weeklyHours - p.plan.newHoursPerWeek);
  const share = p.plan.weeklyHours ? (p.plan.newHoursPerWeek / p.plan.weeklyHours) * 100 : 0;
  return (
    <>
      <Title sub="Your plan never asks for more than this.">How much time do you have?</Title>
      <div className="cc-block">
        <NumberStepper label="Hours a day" value={p.t.hoursPerDay} min={0.5} max={8} step={0.5} unit={p.t.hoursPerDay === 1 ? "hour a day" : "hours a day"} onChange={(h) => p.onT({ ...p.t, hoursPerDay: h })} />
      </div>
      <div className="cc-block"><DayToggles value={p.t.weekdays} onChange={(w) => p.onT({ ...p.t, weekdays: w })} /></div>
      <div className="cc-block">
        <Segmented<Pace>
          label="Pace" value={p.t.pace} onChange={(x) => p.onT({ ...p.t, pace: x })}
          options={[
            { value: "LIGHT", label: "Light", hint: `${pct("LIGHT")} new material, more revision and slack days` },
            { value: "STEADY", label: "Steady", hint: `${pct("STEADY")} new material, a balance with revision` },
            { value: "INTENSIVE", label: "Intensive", hint: `${pct("INTENSIVE")} new material, little slack` },
          ]}
        />
        <div className="cc-pace" aria-live="polite">
          <div className="cc-split-bar" role="img" aria-label={`Each week: ${newH} hours of new material and ${revH} hours of revision`}><i style={{ width: `${share}%` }} /></div>
          <div className="cc-split-legend"><span><b>{newH} h</b> new material</span><span><b>{revH} h</b> revision</span></div>
          <p className="cc-split-note">Pace splits your {p.plan.weeklyHours} hours a week between new material and revision. It never adds hours; it moves the finish date.</p>
        </div>
      </div>
      <Group>
        <DisclosureRow label="Starts" value={longDate(p.t.startDate)} onClick={() => p.edit({ title: "When do you start?", label: "Start date", value: p.t.startDate, kind: "date", min: today, onSave: (v) => v && p.onT({ ...p.t, startDate: v }) })} />
        <DisclosureRow label="Finish by" value={p.t.targetDate ? longDate(p.t.targetDate) : "No date"} onClick={() => p.edit({ title: "Finish by a date?", label: "Finish by", value: p.t.targetDate ?? "", kind: "date", min: p.t.startDate, clearLabel: "No date", onSave: (v) => p.onT({ ...p.t, targetDate: v || undefined }) })} />
        <DisclosureRow label="Time zone" value={p.timezone} onClick={() => p.edit({ title: "Time zone", label: "Time zone (e.g. Europe/Berlin)", value: p.timezone, onSave: (v) => v && p.onTimezone(v) })} />
      </Group>
      <div className="cc-result" aria-live="polite">
        {p.plan.finish && <div className="cc-result-big">You'll finish around {longDate(p.plan.finish)}</div>}
        {p.t.targetDate && <div className="cc-result-big">About {p.plan.fitHours} hours by {longDate(p.t.targetDate)}</div>}
      </div>
      {p.plan.short && p.t.targetDate && p.t.estimatedHours && (
        <FeedbackMessage tone="warning"><p>Your goal needs about {p.t.estimatedHours} hours; about {p.plan.fitHours} fit before {dayMonth(p.t.targetDate)}. Blueprint plans the essentials first. Add time, choose a faster pace or move the date to cover more.</p></FeedbackMessage>
      )}
      {p.plan.tooLong && (
        <FeedbackMessage tone="warning"><p>At this pace your goal would take more than three years. Blueprint plans up to three years with the essentials first; add time or choose a faster pace to cover more.</p></FeedbackMessage>
      )}
      {p.error && <FeedbackMessage tone="danger"><p>{p.error}</p></FeedbackMessage>}
      <button className="btn primary wide cc-go" aria-busy={p.busy} disabled={p.busy} onClick={p.onContinue}>Continue</button>
    </>
  );
}

/* ---------------- 4 · Build ---------------- */

export function BuildStep(p: {
  summary: string; districts: string[]; consented: boolean; provider: string;
  gen: { running: number | null; label: string; districts: { name: string; done: boolean }[]; error: string | null; startedAt: number };
  onBuild: () => void; proposal: CityProposal | null; preview: CurriculumVersion | null; targetDate?: string; hoursPerDay: number;
  approving: boolean; onApprove: () => void; onRebuild: () => void; error: string | null;
}) {
  const [now, setNow] = useState(Date.now());
  const [district, setDistrict] = useState<string | null>(null);
  useEffect(() => {
    if (p.gen.running === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [p.gen.running]);

  if (p.proposal?.summary && p.preview?.content) {
    const s = p.proposal.summary;
    const districts = p.preview.content.districts;
    const open = districts.find((d) => d.key === district) ?? null;
    return (
      <>
        <Title sub="This is the city you'll get. Tap a district to see its topics. Nothing is created until you approve it.">Your city is ready</Title>
        <div className="cc-stats">
          <div><b>{s.districts}</b><span>districts</span></div>
          <div><b>{s.topics}</b><span>topics</span></div>
          <div><b>{s.hours}</b><span>hours</span></div>
          <div><b>{dayMonth(s.end)}</b><span>finish</span></div>
        </div>
        <Group caption="Districts" footer={`From ${longDate(s.start)} to ${longDate(s.end)}`}>
          {districts.map((d) => (
            <DisclosureRow
              key={d.key} icon={<span className="cc-swatch" style={{ background: d.color }} />} label={d.name}
              value={`${plural(d.topics.length, "topic")} · ${d.topics.reduce((a, t) => a + t.hours, 0)} h`} onClick={() => setDistrict(d.key)}
            />
          ))}
        </Group>
        <Sheet open={!!open} title={open?.name ?? ""} onClose={() => setDistrict(null)}>
          {open && (
            <Group footer={`${plural(open.topics.filter((t) => t.priority !== "OPTIONAL").length, "topic")} planned in order; optional ones stay in the city to learn later.`}>
              {open.topics.map((t, i) => (
                <div key={t.key} className="kit-row kit-text-row cc-topic">
                  <span className="kit-row-label"><b>{i + 1}. {t.name}</b><small>{t.exercise}</small></span>
                  <span className="kit-row-value">{t.hours} h{t.priority === "OPTIONAL" ? " · optional" : ""}</span>
                </div>
              ))}
            </Group>
          )}
          <button className="btn primary wide" onClick={() => setDistrict(null)}>Done</button>
        </Sheet>
        {p.targetDate && s.end > p.targetDate && (
          <FeedbackMessage tone="warning"><p>At {p.hoursPerDay} h a day this plan ends on {dayMonth(s.end)}, after your date ({dayMonth(p.targetDate)}). You can approve it and adjust stage dates later, or build it again with more time.</p></FeedbackMessage>
        )}
        {p.error && <FeedbackMessage tone="danger"><p>{p.error}</p></FeedbackMessage>}
        <button className="btn primary wide cc-go" aria-busy={p.approving} disabled={p.approving} onClick={p.onApprove}>{p.approving ? "Creating your city…" : "Approve and create the city"}</button>
        <button className="btn wide cc-quiet" disabled={p.approving} onClick={p.onRebuild}>Build it again</button>
      </>
    );
  }

  if (p.gen.running !== null) {
    const secs = Math.max(0, Math.round((now - p.gen.startedAt) / 1000));
    return (
      <>
        <Title sub="Usually 1 to 5 minutes, longer when the AI service is busy. You can leave this page; it keeps building.">Building your city</Title>
        <LoadingState tone="ai" text={p.gen.label} />
        {p.gen.districts.length > 0 && (
          <Group caption="Districts">
            {p.gen.districts.map((d) => (
              <div key={d.name} className="kit-row kit-text-row cc-gen-row"><span className="kit-row-label">{d.name}</span><span aria-label={d.done ? "written" : "being written"}>{d.done ? "✓" : "…"}</span></div>
            ))}
          </Group>
        )}
        <p className="cc-sub">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</p>
      </>
    );
  }

  return (
    <>
      <Title sub={p.summary}>Ready to build</Title>
      <Group caption="Districts">{p.districts.map((d) => <TextRow key={d}>{d}</TextRow>)}</Group>
      <p className="cc-sub">Your goal, plan text and time go to {p.provider === "gwdg" ? "GWDG Academic Cloud, which states it doesn't store them" : "the AI provider"}. Blueprint checks the result before you see it.</p>
      {(p.gen.error || p.error) && <FeedbackMessage tone="danger"><p>{p.gen.error ?? p.error}</p></FeedbackMessage>}
      <button className="btn primary wide cc-go" onClick={p.onBuild}>{p.gen.error ? "Try again" : "Build my city"}</button>
    </>
  );
}
