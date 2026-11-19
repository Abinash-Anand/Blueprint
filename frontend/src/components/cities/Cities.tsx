/**
 * City management and the guided creation workflow (multi-user sprint). Every action goes to the backend, which owns
 * the rules (status transitions, deletion, curriculum validation); this screen shows its answers.
 *
 * Creation: identity → requirements → constraints → curriculum → review. The draft city is saved after step 1, so
 * nothing typed is lost. AI generation is not available yet and says so; the curriculum comes from the Engineering
 * template or a file in the Blueprint curriculum contract, both validated by the backend before review.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, account, cities as api } from "../../api/client";
import type { CityConstraints, CityProposal, CityRequirements, CitySummary, CurriculumVersion, GenerationAvailability, Template } from "../../api/types";
import { dayMonth, plural } from "../../lib/format";
import { isOpenable, useSession } from "../../state/Session";
import { FeedbackMessage, LoadingState, StatusBadge } from "../Status";

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");

/* ======================================================================= city list */

export function CityManager() {
  const { cities, refreshCities, selectCity, city } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const visible = cities.filter((c) => showArchived || c.status !== "ARCHIVED");
  const archived = cities.filter((c) => c.status === "ARCHIVED").length;

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      const xs = await refreshCities();
      if (city && !xs.some((c) => c.id === city.id && isOpenable(c))) selectCity(xs.find((c) => c.status === "ACTIVE")?.id ?? null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const open = (c: CitySummary) => {
    if (c.status === "DRAFT") location.hash = `#/cities/new/${c.id}`;
    else {
      selectCity(c.id);
      location.hash = "#/today";
    }
  };

  return (
    <div className="view"><div className="wrap">
      <div className="vhead">
        <div>
          <div className="kick">Your learning environments</div>
          <h2>Cities</h2>
          <div className="sub">Each city is its own curriculum, plan, progress and revision history.</div>
        </div>
        <button className="btn primary" onClick={() => (location.hash = "#/cities/new")}>New city</button>
      </div>
      {error && <FeedbackMessage tone="danger"><p>{error}</p></FeedbackMessage>}
      {cities.length === 0 ? (
        <div className="card rest"><h3>No cities yet</h3><p>Create your first learning environment: describe the goal, your starting point and your time, then choose its curriculum.</p></div>
      ) : (
        <ul className="city-list">
          {visible.map((c) => (
            <li key={c.id} className={`card city-row${c.id === city?.id ? " current" : ""}`}>
              <div className="city-main">
                <div className="city-title">
                  <h3>{c.name}</h3>
                  <StatusBadge p={c.presentation} fallback={c.status.toLowerCase()} />
                  {c.id === city?.id && <span className="tag ink">Open now</span>}
                </div>
                {c.goal && <p className="city-goal">{c.goal}</p>}
                <p className="city-meta">{c.topics ? `${plural(c.topics, "topic")} · ` : ""}{c.category ? `${c.category} · ` : ""}updated {dayMonth(c.updatedAt.slice(0, 10))}</p>
              </div>
              <div className="city-acts">
                {c.status !== "ARCHIVED" && <button className="btn primary" onClick={() => open(c)}>{c.status === "DRAFT" ? "Continue setup" : "Open"}</button>}
                {c.status !== "ARCHIVED" && <button className="btn" aria-expanded={editing === c.id} onClick={() => setEditing(editing === c.id ? null : c.id)}>Edit</button>}
                {c.status === "ACTIVE" && <button className="btn" disabled={busy === c.id} onClick={() => void act(c.id, () => api.status(c.id, "pause"))}>Pause</button>}
                {c.status === "PAUSED" && <button className="btn" disabled={busy === c.id} onClick={() => void act(c.id, () => api.status(c.id, "resume"))}>Resume</button>}
                {(c.status === "ACTIVE" || c.status === "PAUSED") && <button className="btn" disabled={busy === c.id} onClick={() => void act(c.id, () => api.status(c.id, "complete"))}>Mark completed</button>}
                {c.status === "COMPLETED" && <button className="btn" disabled={busy === c.id} onClick={() => void act(c.id, () => api.status(c.id, "reopen"))}>Reopen</button>}
                {c.status !== "ARCHIVED" && <button className="btn" disabled={busy === c.id} onClick={() => void act(c.id, () => api.status(c.id, "archive"))}>Archive</button>}
                {c.status === "ARCHIVED" && <button className="btn" disabled={busy === c.id} onClick={() => void act(c.id, () => api.status(c.id, "restore"))}>Restore</button>}
                {(c.status === "ARCHIVED" || c.status === "DRAFT") && <button className="btn danger" aria-expanded={deleting === c.id} onClick={() => setDeleting(deleting === c.id ? null : c.id)}>Delete…</button>}
              </div>
              {editing === c.id && <EditCity c={c} onDone={() => { setEditing(null); void refreshCities(); }} />}
              {deleting === c.id && <DeleteCity c={c} onDone={() => { setDeleting(null); void act(c.id, async () => undefined); }} />}
            </li>
          ))}
        </ul>
      )}
      {archived > 0 && <p className="sub"><button className="link" onClick={() => setShowArchived((x) => !x)}>{showArchived ? "Hide archived cities" : `Show ${plural(archived, "archived city", "archived cities")}`}</button></p>}
    </div></div>
  );
}

function EditCity({ c, onDone }: { c: CitySummary; onDone: () => void }) {
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description);
  const [goal, setGoal] = useState(c.goal);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.update(c.id, { name, description, goal });
      onDone();
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <div className="form city-form">
      <label className="grow">Name<input className="inp" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label style={{ flexBasis: "100%" }}>Goal<input className="inp" value={goal} maxLength={500} onChange={(e) => setGoal(e.target.value)} /></label>
      <label style={{ flexBasis: "100%" }}>Description<textarea className="inp" value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} /></label>
      {error && <FeedbackMessage tone="danger"><p>{error}</p></FeedbackMessage>}
      <button className="btn primary" disabled={!name.trim()} onClick={() => void save()}>Save</button>
      <button className="btn" onClick={onDone}>Cancel</button>
    </div>
  );
}

function DeleteCity({ c, onDone }: { c: CitySummary; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await api.remove(c.id, typed);
      onDone();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };
  return (
    <div className="form city-form">
      <FeedbackMessage tone="danger"><p>This permanently deletes <b>{c.name}</b> with its curriculum, tasks, progress and revision history. It cannot be undone. Export your data first if you want a copy (Account → Privacy).</p></FeedbackMessage>
      <label className="grow">Type the city's name to confirm<input className="inp" value={typed} onChange={(e) => setTyped(e.target.value)} aria-invalid={!!typed && typed !== c.name} /></label>
      {error && <FeedbackMessage tone="danger"><p>{error}</p></FeedbackMessage>}
      <button className="btn danger solid" aria-busy={busy} disabled={busy || typed !== c.name} onClick={() => void remove()}>Delete permanently</button>
      <button className="btn" onClick={onDone}>Cancel</button>
    </div>
  );
}

/* ======================================================================= creation workflow */

const STEPS = [
  { id: "identity", label: "Identity" },
  { id: "requirements", label: "Requirements" },
  { id: "constraints", label: "Time" },
  { id: "curriculum", label: "Curriculum" },
  { id: "review", label: "Review" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

const LEVELS = { NONE: "No experience", BEGINNER: "Beginner", INTERMEDIATE: "Intermediate", ADVANCED: "Advanced" } as const;
const TARGETS = { FOUNDATIONS: "Solid foundations", WORKING: "Working knowledge", PROFESSIONAL: "Professional", EXPERT: "Expert" } as const;
const PACES = { LIGHT: "Light", STEADY: "Steady", INTENSIVE: "Intensive" } as const;
const list = (s: string) => s.split(/\n|,/).map((x) => x.trim()).filter(Boolean);

function Step({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="card wiz-step rd-step" aria-label={title}>
      <h3>{title}</h3>
      {sub && <p className="sub">{sub}</p>}
      {children}
    </section>
  );
}

export function CityWizard({ draftId }: { draftId: string | null }) {
  const { refreshCities, selectCity, user } = useSession();
  const [step, setStep] = useState<StepId>("identity");
  const [id, setId] = useState<string | null>(draftId);
  const [loading, setLoading] = useState(!!draftId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; issues?: { path: string; message: string }[] } | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [goal, setGoal] = useState("");
  const [category, setCategory] = useState("");
  const [req, setReq] = useState<CityRequirements>({});
  const [subjects, setSubjects] = useState("");
  const [resources, setResources] = useState("");
  const [prereq, setPrereq] = useState("");
  const tz = useMemo(() => user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, [user]);
  const [con, setCon] = useState<CityConstraints>({
    hoursPerDay: (user?.preferences.defaultDailyMinutes ?? 120) / 60, daysPerWeek: user?.preferences.defaultDaysPerWeek ?? 5, pace: "STEADY",
    startDate: new Date().toISOString().slice(0, 10), timezone: tz,
  });
  const [templates, setTemplates] = useState<Template[]>([]);
  const [proposal, setProposal] = useState<CityProposal | null>(null);
  const [preview, setPreview] = useState<CurriculumVersion | null>(null);

  useEffect(() => {
    void api.templates().then(setTemplates, () => undefined);
    if (!draftId) return;
    void api.get(draftId).then((c) => {
      setName(c.name);
      setDescription(c.description);
      setGoal(c.goal);
      setCategory(c.category ?? "");
      setReq(c.requirements ?? {});
      setSubjects((c.requirements?.subjects ?? []).join("\n"));
      setResources((c.requirements?.resources ?? []).join("\n"));
      setPrereq((c.requirements?.prerequisites ?? []).join("\n"));
      if (c.constraints) setCon(c.constraints);
      setStep("requirements");
    }, (e) => setError({ text: errText(e) })).finally(() => setLoading(false));
    void api.versions(draftId).then((vs) => {
      const open = vs.find((v) => v.status === "PROPOSED");
      if (vs.some((v) => v.status === "GENERATING")) setStep("curriculum");
      if (open) void api.version(draftId, open.version).then((v) => {
        setProposal({ ...v, blockedRemovals: [] });
        setPreview(v);
      });
    }, () => undefined);
  }, [draftId]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const issues = e instanceof ApiError && Array.isArray(e.details) ? (e.details as { path: string; message: string }[]) : undefined;
      setError({ text: errText(e), issues });
    } finally {
      setBusy(false);
    }
  };

  const requirements = (): CityRequirements => ({ ...req, subjects: list(subjects), resources: list(resources), prerequisites: list(prereq) });
  const saveIdentity = () => run(async () => {
    const body = { name, description, goal, category: category || null };
    if (id) await api.update(id, body);
    else {
      const c = await api.create(body);
      setId(c.id);
      history.replaceState(null, "", `#/cities/new/${c.id}`);
    }
    await refreshCities();
    setStep("requirements");
  });
  const saveRequirements = () => run(async () => {
    await api.update(id!, { requirements: requirements() });
    setStep("constraints");
  });
  const saveConstraints = () => run(async () => {
    await api.update(id!, { constraints: con });
    setStep("curriculum");
  });
  const propose = (body: Parameters<typeof api.propose>[1]) => run(async () => {
    const p = await api.propose(id!, body);
    setProposal(p);
    setPreview(await api.version(id!, p.version));
    setStep("review");
  });
  const importFile = async (file: File) => {
    let doc: unknown;
    try {
      doc = JSON.parse(await file.text());
    } catch {
      setError({ text: "The file is not valid JSON." });
      return;
    }
    await propose({ source: "IMPORT", document: doc, note: file.name.slice(0, 100) });
  };
  const approve = () => run(async () => {
    await api.approve(id!, proposal!.version);
    await refreshCities();
    selectCity(id!);
    location.hash = "#/today";
  });

  if (loading) return <div className="view"><div className="wrap"><LoadingState text="Loading the draft…" /></div></div>;
  const idx = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="view"><div className="wrap wiz">
      <div className="vhead">
        <div>
          <div className="kick">New city</div>
          <h2>{name || "Create a learning environment"}</h2>
          <div className="sub">Describe what you want to learn. Nothing becomes active until you approve its curriculum.</div>
        </div>
        <button className="btn" onClick={() => (location.hash = "#/cities")}>{id ? "Save and close" : "Cancel"}</button>
      </div>
      <ol className="rd-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i === idx ? "on" : i < idx ? "past" : ""} aria-current={i === idx ? "step" : undefined}>
            <span>{i < idx ? "✓" : i + 1}</span>{s.label}
          </li>
        ))}
      </ol>
      {error && (
        <FeedbackMessage tone="danger">
          <p>{error.text}</p>
          {error.issues && <ul className="wiz-issues">{error.issues.slice(0, 12).map((x, i) => <li key={i}><code>{x.path || "document"}</code>: {x.message}</li>)}</ul>}
        </FeedbackMessage>
      )}

      {step === "identity" && (
        <Step title="1 · Identity" sub="What is this city about?">
          <div className="form wiz-form">
            <label className="grow">City name<input className="inp" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. German City" /></label>
            <label>Category (optional)<input className="inp" value={category} maxLength={60} onChange={(e) => setCategory(e.target.value)} placeholder="Language, Software…" /></label>
            <label style={{ flexBasis: "100%" }}>Learning goal<input className="inp" value={goal} maxLength={500} onChange={(e) => setGoal(e.target.value)} placeholder="What will you be able to do at the end?" /></label>
            <label style={{ flexBasis: "100%" }}>Description (optional)<textarea className="inp" value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} /></label>
          </div>
          <div className="rd-acts"><button className="btn primary" aria-busy={busy} disabled={busy || !name.trim()} onClick={() => void saveIdentity()}>Save and continue</button></div>
        </Step>
      )}

      {step === "requirements" && (
        <Step title="2 · Learning requirements" sub="Where you start, where you want to get, and what it should cover.">
          <div className="form wiz-form">
            <label style={{ flexBasis: "100%" }}>Desired outcome<textarea className="inp" value={req.outcome ?? ""} maxLength={1000} onChange={(e) => setReq({ ...req, outcome: e.target.value })} /></label>
            <label>Current level<select className="inp" value={req.currentLevel ?? ""} onChange={(e) => setReq({ ...req, currentLevel: (e.target.value || undefined) as CityRequirements["currentLevel"] })}>
              <option value="">Choose…</option>{Object.entries(LEVELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Target level<select className="inp" value={req.targetLevel ?? ""} onChange={(e) => setReq({ ...req, targetLevel: (e.target.value || undefined) as CityRequirements["targetLevel"] })}>
              <option value="">Choose…</option>{Object.entries(TARGETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="grow">Subjects or technologies (one per line)<textarea className="inp" value={subjects} onChange={(e) => setSubjects(e.target.value)} /></label>
            <label className="grow">Prerequisites you already have (one per line)<textarea className="inp" value={prereq} onChange={(e) => setPrereq(e.target.value)} /></label>
            <label style={{ flexBasis: "100%" }}>Learning resources you want to use (optional, one per line)<textarea className="inp" value={resources} onChange={(e) => setResources(e.target.value)} /></label>
          </div>
          <div className="rd-acts">
            <button className="btn primary" aria-busy={busy} disabled={busy} onClick={() => void saveRequirements()}>Save and continue</button>
            <button className="btn" onClick={() => setStep("identity")}>Back</button>
          </div>
        </Step>
      )}

      {step === "constraints" && (
        <Step title="3 · Time" sub="How much time you have. The plan never exceeds it.">
          <div className="form wiz-form">
            <label>Hours per day<input className="inp" type="number" min={0.25} max={12} step={0.25} value={con.hoursPerDay ?? ""} onChange={(e) => setCon({ ...con, hoursPerDay: Number(e.target.value) })} /></label>
            <label>Days per week<input className="inp" type="number" min={1} max={7} value={con.daysPerWeek ?? ""} onChange={(e) => setCon({ ...con, daysPerWeek: Number(e.target.value) })} /></label>
            <label>Pace<select className="inp" value={con.pace ?? "STEADY"} onChange={(e) => setCon({ ...con, pace: e.target.value as CityConstraints["pace"] })}>{Object.entries(PACES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Start date<input className="inp" type="date" value={con.startDate ?? ""} onChange={(e) => setCon({ ...con, startDate: e.target.value })} /></label>
            <label>Target date (optional)<input className="inp" type="date" value={con.targetDate ?? ""} onChange={(e) => setCon({ ...con, targetDate: e.target.value || undefined })} aria-invalid={!!con.targetDate && !!con.startDate && con.targetDate < con.startDate} /></label>
            <label className="grow">Time zone<input className="inp" value={con.timezone ?? ""} maxLength={64} onChange={(e) => setCon({ ...con, timezone: e.target.value })} /></label>
          </div>
          <div className="rd-acts">
            <button className="btn primary" aria-busy={busy} disabled={busy || !con.startDate} onClick={() => void saveConstraints()}>Save and continue</button>
            <button className="btn" onClick={() => setStep("requirements")}>Back</button>
          </div>
        </Step>
      )}

      {step === "curriculum" && (
        <Step title="4 · Curriculum" sub="The districts, topics, exercises and milestones of this city.">
          <div className="wiz-options">
            {id && <GenerateCard cityId={id} onProposal={(v) => { setProposal({ ...v, blockedRemovals: [] }); setPreview(v); setStep("review"); }} />}
            {templates.map((t) => (
              <div key={t.id} className="card wiz-option">
                <h4>Start from the {t.name} template</h4>
                <p>{t.description} {t.districts} districts, {t.topics} topics, about {t.hours} hours over {t.weeks} weeks, starting {con.startDate ? dayMonth(con.startDate) : "today"}.</p>
                <button className="btn primary" aria-busy={busy} disabled={busy} onClick={() => void propose({ source: "TEMPLATE", template: t.id, start: con.startDate })}>Use this template</button>
              </div>
            ))}
            <div className="card wiz-option">
              <h4>Import a curriculum file</h4>
              <p>A JSON file in the Blueprint curriculum contract (version 1). It is checked completely before you see it; nothing is created until you approve it.</p>
              <label className="btn">Choose a file…<input type="file" accept="application/json,.json" className="sr" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} /></label>
            </div>
          </div>
          <div className="rd-acts"><button className="btn" onClick={() => setStep("constraints")}>Back</button></div>
        </Step>
      )}

      {step === "review" && proposal?.summary && preview?.content && (
        <Step title="5 · Review and approve" sub="This is what the city will contain. Approve it to create the city and its plan.">
          <div className="grid4">
            <div className="card stat"><div className="kick">Districts</div><div className="v">{proposal.summary!.districts}</div></div>
            <div className="card stat"><div className="kick">Topics</div><div className="v">{proposal.summary!.topics}</div></div>
            <div className="card stat"><div className="kick">Estimated</div><div className="v">{proposal.summary!.hours}<small>h</small></div></div>
            <div className="card stat"><div className="kick">Journey</div><div className="v" style={{ fontSize: 16 }}>{dayMonth(proposal.summary!.start)} – {dayMonth(proposal.summary!.end)}</div></div>
          </div>
          <ol className="wiz-districts">
            {preview.content.districts.map((d) => (
              <li key={d.key}>
                <span className="dot" style={{ background: d.color }} aria-hidden="true" /> <b>{d.name}</b> <span className="m">· {plural(d.topics.length, "topic")} · {d.topics.reduce((a, t) => a + t.hours, 0)} h</span>
                <details><summary>Topics, sequence and exercises</summary>
                  <ol>{d.topics.map((t) => <li key={t.key}>{t.name} <span className="m">({t.hours} h, {t.priority.toLowerCase()}{t.dependsOn.length ? `, after ${t.dependsOn.length}` : ""})</span><div className="m">Exercise: {t.exercise}</div></li>)}</ol>
                </details>
              </li>
            ))}
          </ol>
          <p className="sub">Milestones: {preview.content.stages.map((s) => `${s.name} (${dayMonth(s.start)} – ${dayMonth(s.end)})`).join(" · ")}</p>
          {con.targetDate && proposal.summary!.end > con.targetDate && (
            <FeedbackMessage tone="warning">
              <p>At {con.hoursPerDay ?? "your"} h a day this plan ends on {dayMonth(proposal.summary!.end)}, after your target date ({dayMonth(con.targetDate)}). You can approve it and edit stage dates later, add study time, or choose another curriculum.</p>
            </FeedbackMessage>
          )}
          <div className="rd-acts">
            <button className="btn primary" aria-busy={busy} disabled={busy} onClick={() => void approve()}>{busy ? "Creating the city…" : "Approve and create the city"}</button>
            <button className="btn" disabled={busy} onClick={() => setStep("curriculum")}>Choose another curriculum</button>
          </div>
        </Step>
      )}
    </div></div>
  );
}

/* ======================================================================= AI generation (AI design §10.3) */

const providerLabel = (p: string) => (p === "gwdg" ? "GWDG Academic Cloud" : p === "gemini" ? "Google (Gemini)" : "a local test generator");

/**
 * "Generate from your answers": consent (never pre-ticked), start, follow the background job, hand the proposal to
 * the review step. The answers already saved with the draft are what is sent; nothing else.
 */
function GenerateCard({ cityId, onProposal }: { cityId: string; onProposal: (v: CurriculumVersion) => void }) {
  // Stable for the poller: a new callback from the parent must not restart it.
  const done = useRef(onProposal);
  done.current = onProposal;
  const [avail, setAvail] = useState<GenerationAvailability | null>(null);
  const [agree, setAgree] = useState(false);
  const [running, setRunning] = useState<number | null>(null);
  const [progress, setProgress] = useState<string>("Starting");
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<number>(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void api.generation().then(setAvail, () => setAvail(null));
    // Resume a generation that is still running for this draft (page reload, back and forth).
    void api.versions(cityId).then((vs) => {
      const g = vs.find((v) => v.status === "GENERATING");
      if (g) {
        setRunning(g.version);
        setStarted(Date.now());
      }
    }, () => undefined);
  }, [cityId]);

  useEffect(() => {
    if (running === null) return;
    let stop = false;
    const tick = async () => {
      try {
        const v = await api.version(cityId, running);
        if (stop) return;
        if (v.status === "GENERATING") setProgress(v.progress?.label ?? "Working");
        else {
          setRunning(null);
          if (v.status === "PROPOSED") done.current(v);
          else setError(v.error ?? "The generation did not finish.");
          return;
        }
      } catch (e) {
        if (!stop) setError(errText(e));
        setRunning(null);
        return;
      }
      if (!stop) setTimeout(() => void tick(), 2500);
    };
    void tick();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [running, cityId]);

  const start = async () => {
    setError(null);
    try {
      if (avail && !avail.consented) {
        await account.setConsent("AI_CURRICULUM", true);
        setAvail({ ...avail, consented: true, available: true, reason: null });
      }
      const r = await api.generate(cityId);
      setProgress("Starting");
      setStarted(Date.now());
      setRunning(r.version);
    } catch (e) {
      setError(errText(e));
    }
  };

  if (!avail) return <div className="card soft wiz-option"><LoadingState text="Checking whether generation is available…" /></div>;
  const off = avail.reason === "AI_DISABLED" || avail.reason === "NO_PROVIDER";
  const secs = Math.max(0, Math.round((now - started) / 1000));
  return (
    <div className="card wiz-option wiz-gen" aria-disabled={off}>
      <div className="city-title"><h4>Generate from your answers</h4>{off && <span className="tag">Not available</span>}</div>
      {off ? (
        <p>AI is switched off on this server, so curricula cannot be generated. Use the template or a curriculum file.</p>
      ) : running !== null ? (
        <>
          <LoadingState tone="ai" text={progress} />
          <p className="wiz-gen-time">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")} · a whole curriculum takes a few minutes. You can leave this page; it keeps running.</p>
        </>
      ) : (
        <>
          <p>
            Your saved answers (name, goal, requirements and time) are sent to <b>{providerLabel(avail.provider)}</b> ({avail.model}) to write the districts,
            topics, exercises and questions.{avail.provider === "gwdg" ? " GWDG states that it does not store them." : ""} Blueprint checks the result, and nothing is created until you approve it.
          </p>
          {!avail.consented && (
            <label className="af-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> Send my answers to {providerLabel(avail.provider)} to generate this curriculum</label>
          )}
          {error && <FeedbackMessage tone="danger"><p>{error}</p></FeedbackMessage>}
          <button className="btn primary" disabled={!avail.consented && !agree} onClick={() => void start()}>{error ? "Try again" : "Generate curriculum"}</button>
        </>
      )}
    </div>
  );
}
