/**
 * Creating a city (AI design §10.4, LLD §4.7): four calm screens, one question each.
 *
 *   1 goal        the learner's own words (typed or spoken) and, if they like, their own plan files
 *   2 understood  the AI's reading of it, every line correctable; districts kept or left out
 *   3 time        hours, days, pace, dates; the finish date shown is the one the plan will have
 *   4 build       the AI writes the city in the background; the learner reviews and approves it
 *
 * The draft is created on the first save and every step is saved before moving on, so a learner can close the page
 * and continue later. Sending anything to the AI needs consent (AI_CURRICULUM), asked once in a sheet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, account, cities as api } from "../../../api/client";
import type { CityAttachment, CityConstraints, CityProposal, CityRequirements, CurriculumVersion, GenerationAvailability, Understanding } from "../../../api/types";
import { useSession } from "../../../state/Session";
import { FlowHeader, Sheet } from "../../kit";
import { LoadingState } from "../../Status";
import { DEFAULT_PACES, FILE_LIMITS, type Pace, type StepId, type TimeInput, addMonthsIso, fileType, longDate, provisionalName, resumeStep, timePlan } from "./logic";
import { CityPreview, type PreviewDistrict, fromDocument } from "./CityPreview";
import { BuildStep, EditSheet, type EditRequest, GoalStep, type Subject, TimeStep, UnderstoodStep } from "./Steps";
import { useGeneration } from "./useGeneration";

const ORDER: StepId[] = ["goal", "understood", "time", "build"];
const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");
const today = () => new Date().toISOString().slice(0, 10);

export function CreateCity({ draftId }: { draftId: string | null }) {
  const { user, refreshCities, selectCity } = useSession();
  const [id, setId] = useState<string | null>(draftId);
  const idRef = useRef<string | null>(draftId);
  const [loading, setLoading] = useState(!!draftId);
  const [step, setStep] = useState<StepId>("goal");
  const [avail, setAvail] = useState<GenerationAvailability | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [brief, setBrief] = useState("");
  const [files, setFiles] = useState<CityAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [u, setU] = useState<Understanding>({});
  const [readFrom, setReadFrom] = useState<string | null>(null); // the brief and files the summary was read from
  const [manual, setManual] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [time, setTime] = useState<TimeInput>({
    hoursPerDay: Math.round(((user?.preferences.defaultDailyMinutes ?? 90) / 60) * 2) / 2 || 1.5,
    weekdays: [1, 2, 3, 4, 5, 6, 7].slice(0, user?.preferences.defaultDaysPerWeek ?? 5),
    pace: "STEADY", startDate: today(),
  });
  const [targetTouched, setTargetTouched] = useState(false);
  const [timezone, setTimezone] = useState(user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [edit, setEdit] = useState<EditRequest | null>(null);
  const [consentFor, setConsentFor] = useState<null | (() => void)>(null);
  const [proposal, setProposal] = useState<CityProposal | null>(null);
  const [preview, setPreview] = useState<CurriculumVersion | null>(null);
  const [approving, setApproving] = useState(false);

  const paces = (avail?.paces ?? DEFAULT_PACES) as Record<Pace, number>;
  const fingerprint = `${brief.trim()}|${files.map((f) => f.id).join(",")}`;

  /* ---------------- load or resume ---------------- */
  useEffect(() => {
    void api.generation().then(setAvail, () => setAvail(null));
    if (!draftId) return;
    void (async () => {
      try {
        const [c, fs, vs] = await Promise.all([api.get(draftId), api.attachments(draftId), api.versions(draftId)]);
        const r: CityRequirements = c.requirements ?? {};
        const con: CityConstraints = c.constraints ?? {};
        setBrief(r.brief ?? "");
        setFiles(fs);
        if (r.understood) {
          setU({ ...r.understood, name: r.understood.name ?? c.name });
          setSubjects((r.understood.subjects ?? []).map((name) => ({ name, on: true })));
          setFocus(r.focus ?? r.understood.focusOptions?.[0] ?? null);
          setAnswers(Object.fromEntries((r.answers ?? []).map((a) => [a.question, a.answer])));
          setReadFrom(`${(r.brief ?? "").trim()}|${fs.map((f) => f.id).join(",")}`);
        }
        if (con.startDate) {
          setTime((t) => ({ ...t, hoursPerDay: con.hoursPerDay ?? t.hoursPerDay, weekdays: con.weekdays?.length ? con.weekdays : t.weekdays, pace: con.pace ?? t.pace, startDate: con.startDate!, targetDate: con.targetDate }));
          setTargetTouched(true);
        }
        if (con.timezone) setTimezone(con.timezone);
        setStep(resumeStep(r, con, vs));
      } catch (e) {
        setError(msg(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [draftId]);

  /* ---------------- helpers ---------------- */
  /** The draft city, created on first need (first save, first file, first recording). */
  const ensureDraft = useCallback(async () => {
    if (idRef.current) return idRef.current;
    const c = await api.create({ name: provisionalName(brief) });
    idRef.current = c.id;
    setId(c.id);
    history.replaceState(null, "", `#/cities/new/${c.id}`);
    void refreshCities();
    return c.id;
  }, [brief, refreshCities]);

  /** Runs `then` once the learner has agreed to send their answers to the AI provider (asks in a sheet if needed). */
  const withConsent = (then: () => void) => {
    if (avail?.consented) then();
    else setConsentFor(() => then);
  };
  const allow = async () => {
    const then = consentFor;
    setConsentFor(null);
    try {
      await account.setConsent("AI_CURRICULUM", true);
      setAvail((a) => (a ? { ...a, consented: true, available: a.reason === "CONSENT_REQUIRED" ? true : a.available, reason: a.reason === "CONSENT_REQUIRED" ? null : a.reason } : a));
      then?.();
    } catch (e) {
      setError(msg(e));
    }
  };

  const requirements = (extra: Partial<CityRequirements> = {}): CityRequirements => ({
    brief: brief.trim(),
    ...(Object.keys(u).length ? { understood: { ...u, subjects: subjects.filter((s) => s.on).map((s) => s.name) } } : {}),
    ...(focus ? { focus } : {}),
    answers: Object.entries(answers).map(([question, answer]) => ({ question, answer })),
    ...extra,
  });

  /* ---------------- step 1 ---------------- */
  const addFiles = async (fs: File[]) => {
    setError(null);
    setUploading(true);
    try {
      const cid = await ensureDraft();
      for (const f of fs) {
        if (files.length >= FILE_LIMITS.maxFiles) throw new Error(`You can add up to ${FILE_LIMITS.maxFiles} files.`);
        const type = fileType(f);
        if (!type) throw new Error(`${f.name}: add a PDF or a text file (.txt, .md).`);
        if (f.size > FILE_LIMITS.maxBytes) throw new Error(`${f.name} is larger than 5 MB.`);
        const a = await api.addAttachment(cid, f, f.name, type);
        setFiles((xs) => [...xs, a]);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const removeFile = async (aid: number) => {
    if (!idRef.current) return;
    setError(null);
    try {
      await api.removeAttachment(idRef.current, aid);
      setFiles((xs) => xs.filter((x) => x.id !== aid));
    } catch (e) {
      setError(msg(e));
    }
  };

  /** Reads the goal and plan with the AI; on failure the learner can fill the summary in themselves. */
  const understand = async (cid: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.understand(cid);
      setU(r);
      setSubjects((r.subjects ?? []).map((name) => ({ name, on: true })));
      setFocus(r.focusOptions?.[0] ?? null);
      setAnswers({});
      setReadFrom(fingerprint);
      setManual(null);
      if (r.planMonths && !targetTouched) setTime((t) => ({ ...t, targetDate: addMonthsIso(t.startDate, r.planMonths!) }));
      setStep("understood");
    } catch (e) {
      if (e instanceof ApiError && e.code === "AI_CONSENT_REQUIRED") {
        setAvail((a) => (a ? { ...a, consented: false } : a));
        withConsentAfter(() => void understand(cid));
        return;
      }
      // Fill it in by hand: the goal as written, the districts to add.
      setU((x) => (Object.keys(x).length ? x : { name: provisionalName(brief), goal: brief.trim().slice(0, 200) }));
      setManual(`${msg(e)} You can fill this in yourself and add the districts, or try again.`);
      setStep("understood");
    } finally {
      setBusy(false);
    }
  };
  // Consent can be withdrawn elsewhere meanwhile: ask again without the stale "already agreed".
  const withConsentAfter = (then: () => void) => setConsentFor(() => then);

  const continueFromGoal = async () => {
    setBusy(true);
    setError(null);
    try {
      const cid = await ensureDraft();
      await api.update(cid, { requirements: requirements() });
      setBusy(false);
      if (readFrom === fingerprint && subjects.length) { setStep("understood"); return; } // nothing new to read
      withConsent(() => void understand(cid));
    } catch (e) {
      setError(msg(e));
      setBusy(false);
    }
  };

  /* ---------------- step 2 ---------------- */
  const confirmUnderstood = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = (u.name || provisionalName(brief)).slice(0, 80);
      await api.update(idRef.current!, { name, goal: (u.goal ?? "").slice(0, 500), ...(u.category ? { category: u.category.slice(0, 60) } : {}), requirements: requirements() });
      void refreshCities();
      setStep("time");
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  /* ---------------- step 3 ---------------- */
  const tInput = { ...time, estimatedHours: u.estimatedHours };
  const plan = useMemo(() => timePlan(tInput, paces), [time, u.estimatedHours, paces]); // eslint-disable-line react-hooks/exhaustive-deps
  const confirmTime = async () => {
    setBusy(true);
    setError(null);
    try {
      const constraints: CityConstraints = {
        hoursPerDay: time.hoursPerDay, daysPerWeek: time.weekdays.length, weekdays: time.weekdays, pace: time.pace,
        startDate: time.startDate, ...(time.targetDate ? { targetDate: time.targetDate } : {}), timezone,
      };
      await api.update(idRef.current!, { constraints });
      setStep("build");
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  /* ---------------- step 4 ---------------- */
  const onProposal = useCallback((v: CurriculumVersion) => {
    setProposal({ ...v, blockedRemovals: [] });
    setPreview(v);
    setStep("build");
  }, []);
  const gen = useGeneration(id, onProposal);
  const build = () => withConsent(() => { setProposal(null); setPreview(null); void gen.start(); });
  const approve = async () => {
    setApproving(true);
    setError(null);
    try {
      await api.approve(idRef.current!, proposal!.version);
      await refreshCities();
      selectCity(idRef.current!);
      location.hash = "#/city";
    } catch (e) {
      setError(msg(e));
      setApproving(false);
    }
  };

  /* ---------------- the city as it takes shape ---------------- */
  const keptNames = subjects.filter((s) => s.on).map((s) => s.name);
  // Before the curriculum exists: buildings per district from the estimated hours (about 8 h a topic), 3 floors each.
  const perDistrict = Math.min(9, Math.max(3, Math.round((u.estimatedHours ?? 120) / Math.max(1, keptNames.length) / 8)));
  const finishText = plan.finish ? `Finishes around ${longDate(plan.finish)}` : time.targetDate ? `By ${longDate(time.targetDate)}` : "";
  const hero = useMemo((): { districts: PreviewDistrict[]; caption?: string } => {
    const planned = (state: PreviewDistrict["state"]) => keptNames.map((name): PreviewDistrict => ({ name, state, topics: Array(perDistrict).fill(3) }));
    if (preview?.content && proposal?.summary) {
      const s = proposal.summary;
      return { districts: fromDocument(preview.content), caption: `${s.districts} districts · ${s.topics} topics · finishes ${longDate(s.end)}` };
    }
    if (step === "build" && gen.running !== null) {
      if (!gen.districts.length) return { districts: planned("ghost"), caption: "Designing the districts…" };
      const done = gen.districts.filter((d) => d.done).length;
      return {
        districts: gen.districts.map((d): PreviewDistrict => ({ name: d.name, state: d.done ? "planned" : "ghost", topics: Array(perDistrict).fill(3) })),
        caption: `${done} of ${gen.districts.length} districts written`,
      };
    }
    if (step === "goal") return { districts: brief.trim() ? ["", "", ""].map((name): PreviewDistrict => ({ name, state: "ghost", topics: [1, 1, 1, 1] })) : [] };
    return { districts: planned("planned"), caption: [`${keptNames.length} district${keptNames.length === 1 ? "" : "s"}`, step !== "understood" ? finishText : ""].filter(Boolean).join(" · ") };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, !!brief.trim(), keptNames.join("|"), perDistrict, finishText, gen.running, JSON.stringify(gen.districts), preview, proposal]);

  /* ---------------- render ---------------- */
  if (loading) return <div className="cc"><LoadingState text="Loading your draft…" /></div>;
  const n = ORDER.indexOf(step);
  const back = n > 0 && gen.running === null && !approving ? () => { setError(null); setStep(ORDER[n - 1]); } : undefined;
  const aiOff = avail?.reason === "AI_DISABLED" || avail?.reason === "NO_PROVIDER";
  const kept = subjects.filter((s) => s.on).map((s) => s.name);
  const summary = `${kept.length} districts · ${time.hoursPerDay} h on ${time.weekdays.length} days a week${plan.finish ? ` · finishes around ${longDate(plan.finish)}` : time.targetDate ? ` · by ${longDate(time.targetDate)}` : ""}`;

  return (
    <div className="cc">
      <div className="cc-card">
        <FlowHeader step={n + 1} total={4} onBack={back} onCancel={() => (location.hash = "#/cities")} cancelLabel={id ? "Save and close" : "Cancel"} />
        <CityPreview districts={hero.districts} caption={hero.caption} />
        <div className="cc-body" key={step}>
          {step === "goal" && (
            <GoalStep
              brief={brief} onBrief={setBrief} files={files} onAddFiles={(fs) => void addFiles(fs)} onRemoveFile={(x) => void removeFile(x)} uploading={uploading}
              canSpeak={!!avail?.consented} onSpeakWithoutConsent={() => withConsentAfter(() => undefined)}
              transcribe={async (wav) => api.dictate(await ensureDraft(), wav)}
              aiOff={aiOff} busy={busy} error={error} onContinue={() => void continueFromGoal()}
            />
          )}
          {step === "understood" && (
            <UnderstoodStep
              u={u} onU={setU} subjects={subjects} onSubjects={setSubjects} focus={focus} onFocus={setFocus}
              answers={answers} onAnswer={(q, a) => setAnswers((x) => ({ ...x, [q]: a }))}
              manual={manual} retrying={busy} onRetry={() => idRef.current && withConsent(() => void understand(idRef.current!))}
              edit={setEdit} error={error} busy={busy} onContinue={() => void confirmUnderstood()}
            />
          )}
          {step === "time" && (
            <TimeStep
              t={tInput} onT={(t) => { if (t.targetDate !== time.targetDate) setTargetTouched(true); setTime({ hoursPerDay: t.hoursPerDay, weekdays: t.weekdays, pace: t.pace, startDate: t.startDate, targetDate: t.targetDate }); }}
              plan={plan} paces={paces} timezone={timezone} onTimezone={setTimezone} edit={setEdit} error={error} busy={busy} onContinue={() => void confirmTime()}
            />
          )}
          {step === "build" && (
            <BuildStep
              summary={summary} districts={kept} consented={!!avail?.consented} provider={avail?.provider ?? ""} gen={gen} onBuild={build}
              proposal={proposal} preview={preview} targetDate={time.targetDate} hoursPerDay={time.hoursPerDay}
              approving={approving} onApprove={() => void approve()} onRebuild={build} error={error}
            />
          )}
        </div>
      </div>

      <EditSheet req={edit} onClose={() => setEdit(null)} />
      <Sheet open={consentFor !== null} title={`Allow Blueprint to use ${avail?.provider === "gwdg" ? "GWDG Academic Cloud" : "the AI service"}?`} onClose={() => setConsentFor(null)}>
        <p>
          To understand your goal and build your city, Blueprint sends what you write or say, the text of your plan files and your time settings to
          {avail?.provider === "gwdg" ? " GWDG Academic Cloud in Göttingen. GWDG states it doesn't store what you send." : " the AI service."} Nothing else about you is sent. You can withdraw this in Account → Privacy.
        </p>
        <button className="btn primary wide" onClick={() => void allow()}>Allow</button>
        <button className="btn wide cc-quiet" onClick={() => setConsentFor(null)}>Not now</button>
      </Sheet>
    </div>
  );
}
