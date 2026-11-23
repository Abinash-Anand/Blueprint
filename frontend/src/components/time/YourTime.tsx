/**
 * "Your time" (docs/Availability-Phase3-Plan.md): a page of its own (#/your-time) where the learner changes the hours on
 * a study day, the study days, the pace, the target date and the time zone. Every change is previewed by the server
 * (the scheduler and forecast run on the proposed week, nothing saved), and Save writes it and re-plans.
 */
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../api/client";
import type { SlotReport, TimeChoice, TimePace, TimePreview, YourTime } from "../../api/types";
import { dayMonth, hm, plural } from "../../lib/format";
import { useAppData } from "../../state/AppData";
import { DayToggles, NumberStepper, Segmented } from "../kit";
import { Back } from "../recall/icons";

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} h`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
/** "17 Nov 2027" */
const yearDate = (iso: string) => `${dayMonth(iso)} ${iso.slice(0, 4)}`;
/** The time zones this browser knows, for suggestions (older browsers: none, the field still takes any name). */
const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
})();

/** "3 weeks later", "5 days earlier", "the same day". */
export function shiftText(before: string | null, after: string | null) {
  if (!before || !after) return null;
  const d = days(before, after);
  if (d === 0) return "the same day";
  const n = Math.abs(d);
  const amount = n >= 14 ? plural(Math.round(n / 7), "week") : plural(n, "day");
  return `${amount} ${d > 0 ? "later" : "earlier"}`;
}

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

const WEEKDAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Whether this study time clashes with another city, and the next free time (docs/Google-Calendar-MVP-Plan.md §9). */
export function SlotNote({ slot, onUse }: { slot: SlotReport; onUse: (time: string) => void }) {
  if (!slot.start) return <p className="yt-line">No study time set: in your calendar, this city follows your other cities from the default start.</p>;
  if (!slot.clashes.length) return <p className="yt-target ok">Study from {slot.start}: clashes with none of your other cities.</p>;
  return (
    <div className="yt-target miss" role="alert">
      {slot.clashes.map((c) => <p key={c.city} style={{ margin: 0 }}>Clashes with {c.city} ({c.from}–{c.to}) on {c.days.map((d) => WEEKDAYS[d]).join(", ")}.</p>)}
      {slot.suggest
        ? <button type="button" className="g-link" onClick={() => onUse(slot.suggest!)}>Use {slot.suggest} instead</button>
        : <p style={{ margin: 0 }}>No free time left that day: fewer hours, or other study days.</p>}
    </div>
  );
}

export function YourTimePage({ backLabel, onClose }: { backLabel: string; onClose: () => void }) {
  const { mutate } = useAppData();
  const [now, setNow] = useState<YourTime | null>(null);
  const [choice, setChoice] = useState<TimeChoice | null>(null);
  const [preview, setPreview] = useState<TimePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef(0);

  useEffect(() => {
    api.yourTime().then((t) => {
      setNow(t);
      setChoice({ minutesPerDay: t.minutesPerDay, studyDays: t.studyDays, pace: t.pace, targetDate: t.targetDate, timezone: t.timezone, studyStart: t.studyStart });
    }, (e) => setLoadError(errText(e)));
  }, []);

  // The preview follows the choice, a moment after the last change; a late answer to an older choice is dropped.
  useEffect(() => {
    if (!choice) return;
    const n = ++asked.current;
    const t = setTimeout(() => {
      api.previewTime(choice).then(
        (p) => n === asked.current && (setPreview(p), setPreviewError(null)),
        (e) => n === asked.current && (setPreview(null), setPreviewError(errText(e))),
      );
    }, 400);
    return () => clearTimeout(t);
  }, [choice]);

  const save = async () => {
    if (!choice) return;
    setBusy(true);
    const r = await mutate(() => api.saveTime(choice));
    setBusy(false);
    if (r) onClose();
  };

  const set = (c: Partial<TimeChoice>) => setChoice((x) => (x ? { ...x, ...c } : x));
  const paceOptions: { value: TimePace; label: string; hint: string }[] = now ? [
    ...(now.pace === "CURRENT" ? [{ value: "CURRENT" as const, label: "Current", hint: now.share >= 0.999 ? "All new material, no revision time (your split now)" : `${pct(now.share)} new material (your split now)` }] : []),
    { value: "LIGHT", label: "Light", hint: `${pct(now.paces.LIGHT)} new material, more revision and slack` },
    { value: "STEADY", label: "Steady", hint: `${pct(now.paces.STEADY)} new material, a balance with revision` },
    { value: "INTENSIVE", label: "Intensive", hint: `${pct(now.paces.INTENSIVE)} new material, little slack` },
  ] : [];

  const p = preview;
  const share = p && p.split.available ? (p.split.newMaterial / p.split.available) * 100 : 0;
  const shift = p ? shiftText(p.finish.before, p.finish.after) : null;

  return (
    <div className="view gl gl-bg">
      <div className="wrap yt">
        <button type="button" className="g-link rh-back" onClick={onClose} aria-label={`Back to ${backLabel}`}><Back />{backLabel}</button>
        <section className="g-card yt-card" aria-labelledby="yt-title">
          <div className="kick">Plan</div>
          <h2 id="yt-title" className="g-t2 yt-title">Your time</h2>
          <p className="g-sub">How much you can study, and how much of it goes to new material. See what it does before you save; nothing changes until then.</p>
          {loadError && <p className="g-err" role="alert">{loadError}</p>}
          {!now || !choice ? (!loadError && <p className="g-sub" role="status">Loading…</p>) : (
            <div className="yt-grid">
              <div className="yt-form">
                <div className="cc-block">
                  <NumberStepper label="Hours on a study day" value={choice.minutesPerDay / 60} min={0.25} max={16} step={0.25} unit="on a study day"
                    format={(h) => hm(Math.round(h * 60))} onChange={(h) => set({ minutesPerDay: Math.round(h * 60) })} />
                </div>
                {!now.uniform && <p className="g-foot">Your study days now have different hours; saving gives each of them {hm(choice.minutesPerDay)}.</p>}
                <div className="cc-block"><DayToggles value={choice.studyDays} onChange={(d) => set({ studyDays: d })} /></div>
                <div className="cc-block">
                  <Segmented<TimePace> label="Pace" value={choice.pace} onChange={(x) => set({ pace: x })} options={paceOptions} />
                </div>
                <div className="yt-fields">
                  <label className="yt-field">
                    <span>Study from</span>
                    <span className="yt-inline">
                      <input className="inp" type="time" step={900} value={choice.studyStart ?? ""} onChange={(e) => set({ studyStart: e.target.value || null })} />
                      {choice.studyStart && <button type="button" className="g-link" onClick={() => set({ studyStart: null })}>No set time</button>}
                    </span>
                  </label>
                  <label className="yt-field">
                    <span>Finish by</span>
                    <span className="yt-inline">
                      <input className="inp" type="date" min={tomorrow()} value={choice.targetDate ?? ""} onChange={(e) => set({ targetDate: e.target.value || null })} />
                      {choice.targetDate && <button type="button" className="g-link" onClick={() => set({ targetDate: null })}>No date</button>}
                    </span>
                  </label>
                  <label className="yt-field">
                    <span>Time zone</span>
                    <input className="inp" list="yt-zones" value={choice.timezone ?? ""} onChange={(e) => set({ timezone: e.target.value })} />
                    <datalist id="yt-zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
                  </label>
                </div>
              </div>

              <div className="yt-preview" aria-live="polite" aria-busy={!p && !previewError}>
                <div className="kick">What this does</div>
                {previewError ? <p className="g-err" role="alert">{previewError}</p> : !p ? <p className="g-sub" role="status">Working it out…</p> : (
                  <>
                    <div className="yt-finish">
                      <span className="yt-label">Projected finish</span>
                      <b>{p.finish.after ? yearDate(p.finish.after) : "Nothing left to plan"}</b>
                      {p.unchanged ? <span className="yt-note">Your plan as it is.</span>
                        : shift && <span className={`yt-note ${p.finish.before && p.finish.after && p.finish.after > p.finish.before ? "later" : "sooner"}`}>{shift} than now ({p.finish.before ? yearDate(p.finish.before) : "—"})</span>}
                    </div>
                    <SlotNote slot={p.slot} onUse={(t) => set({ studyStart: t })} />
                    {p.target.date && (
                      <p className={`yt-target ${p.target.meets ? "ok" : "miss"}`}>
                        {p.target.meets ? `On track for ${yearDate(p.target.date)}.`
                          : `Not by ${yearDate(p.target.date)} at this pace${p.target.neededNewMinutesPerWeek ? `: it needs about ${hours(p.target.neededNewMinutesPerWeek)} of new material a week (this plans ${hours(p.split.newMaterial)})` : ""}.`}
                      </p>
                    )}
                    <div className="cc-pace">
                      <div className="cc-split-bar" role="img" aria-label={`Each week: ${hours(p.split.newMaterial)} of new material and ${hours(p.split.revision)} of revision`}><i style={{ width: `${share}%` }} /></div>
                      <div className="cc-split-legend"><span><b>{hours(p.split.newMaterial)}</b> new material</span><span><b>{hours(p.split.revision)}</b> revision</span></div>
                    </div>
                    <p className="yt-line">Revision, next 4 weeks: {p.revisionLoad.map((w) => w.recalls).join(" · ")} recalls a week.</p>
                    {!p.unchanged && (
                      <p className="yt-line">
                        {plural(p.moved, "task")} would move{p.splitTasks ? `, ${plural(p.splitTasks, "task")} split to fill your days` : ""}. Original dates are kept, and tasks you moved by hand stay put.
                      </p>
                    )}
                  </>
                )}
                <div className="yt-actions">
                  <button type="button" className="btn primary" disabled={busy || !p || p.unchanged || !!previewError} aria-busy={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
                  <button type="button" className="btn" onClick={onClose}>Cancel</button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
