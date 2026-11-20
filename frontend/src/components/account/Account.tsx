/**
 * Onboarding and account settings (multi-user sprint): profile, e-mail status, password, application preferences,
 * privacy (consents, export, deletion). Every change is validated and stored by the backend.
 */
import { type ReactNode, useEffect, useState } from "react";
import { ApiError, account } from "../../api/client";
import type { Account as AccountT, ConsentState } from "../../api/types";
import { shortDate } from "../../lib/format";
import { useSession } from "../../state/Session";
import { FeedbackMessage, LoadingState, StatusBadge } from "../Status";

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong.");
const PURPOSE: Record<string, string> = {
  TERMS: "Terms of use", PRIVACY_NOTICE: "Privacy notice", AI_PROCESSING: "AI check of revision answers and revision packs from your material",
  AI_CURRICULUM: "Building new cities with AI (your goal, plan files and voice)",
};

/* ======================================================================= onboarding */

const SLIDES = [
  { title: "Welcome to Blueprint", text: "Blueprint turns a learning goal into a plan you can follow every day, and shows your progress as a city you build." },
  { title: "A city is one learning goal", text: "Each city has districts (the big areas of a subject) and buildings (topics). Learning a sub-topic adds a floor; demonstrating the skill on your own puts the roof on." },
  { title: "Progress you can trust", text: "Today and Week show what to do. Revision brings topics back just before you would forget them. The car on the road moves only when you demonstrate skills, never because a date passed." },
];

export function Onboarding() {
  const { user, setUser, cities } = useSession();
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const finish = async (to: string) => {
    setBusy(true);
    try {
      setUser((await account.update({ onboarded: true })).user);
    } finally {
      setBusy(false);
      location.hash = to;
    }
  };
  const s = SLIDES[i];
  const existing = cities.find((c) => c.status !== "DRAFT");
  return (
    <div className="auth">
      <main className="auth-card card onboard" aria-labelledby="ob-title">
        <p className="brand">Blueprint · {i + 1} of {SLIDES.length}</p>
        <h1 id="ob-title">{i === 0 && user ? `Welcome, ${user.name}` : s.title}</h1>
        <p className="onboard-text">{s.text}</p>
        <ol className="rd-steps" aria-hidden="true">{SLIDES.map((_, k) => <li key={k} className={k === i ? "on" : k < i ? "past" : ""}><span>{k + 1}</span></li>)}</ol>
        <div className="rd-acts">
          {i < SLIDES.length - 1 ? (
            <button className="btn primary" onClick={() => setI(i + 1)}>Next</button>
          ) : existing ? (
            <button className="btn primary" disabled={busy} onClick={() => void finish("#/today")}>Open {existing.name}</button>
          ) : (
            <button className="btn primary" disabled={busy} onClick={() => void finish("#/cities/new")}>Create my first city</button>
          )}
          {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Back</button>}
          <button className="link onboard-skip" disabled={busy} onClick={() => void finish(existing ? "#/today" : "#/cities")}>Skip the introduction</button>
        </div>
      </main>
    </div>
  );
}

/* ======================================================================= settings */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="section"><h3>{title}</h3><div className="card acc-card">{children}</div></section>;
}

const TIMEZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
})();

export function AccountSettings() {
  const { user, setUser, signOut } = useSession();
  if (!user) return null;
  return (
    <div className="view"><div className="wrap">
      <div className="vhead"><div><div className="kick">Account</div><h2>Settings</h2><div className="sub">Your profile, preferences and privacy.</div></div></div>
      <Profile user={user} onSaved={setUser} />
      <Preferences user={user} onSaved={setUser} />
      <Password />
      <Privacy onDeleted={() => void signOut()} />
    </div></div>
  );
}

function Saved({ state }: { state: { tone: "success" | "danger"; text: string } | null }) {
  return state ? <FeedbackMessage tone={state.tone}><p>{state.text}</p></FeedbackMessage> : null;
}

function Profile({ user, onSaved }: { user: AccountT; onSaved: (u: AccountT) => void }) {
  const [name, setName] = useState(user.name);
  const [timezone, setTimezone] = useState(user.timezone);
  const [language, setLanguage] = useState(user.language);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const save = async () => {
    try {
      onSaved((await account.update({ name, timezone, language })).user);
      setMsg({ tone: "success", text: "Saved." });
    } catch (e) {
      setMsg({ tone: "danger", text: errText(e) });
    }
  };
  return (
    <Section title="Profile">
      <div className="form acc-form">
        <label className="grow">Name<input className="inp" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
        <label className="grow">E-mail
          <span className="acc-email">{user.email} <StatusBadge fallback={user.emailVerified ? "Confirmed" : "Not confirmed"} /></span>
        </label>
        <label>Time zone
          {TIMEZONES.length ? (
            <select className="inp" value={timezone} onChange={(e) => setTimezone(e.target.value)}>{TIMEZONES.map((z) => <option key={z}>{z}</option>)}</select>
          ) : <input className="inp" value={timezone} onChange={(e) => setTimezone(e.target.value)} />}
        </label>
        <label>Language<select className="inp" value={language} onChange={(e) => setLanguage(e.target.value)}><option value="en">English</option><option value="de">Deutsch (interface still English)</option></select></label>
      </div>
      <p className="sub">Changing the e-mail address is not available yet. Member since {shortDate(user.createdAt.slice(0, 10))}.</p>
      <Saved state={msg} />
      <div className="rd-acts"><button className="btn primary" disabled={!name.trim()} onClick={() => void save()}>Save profile</button></div>
    </Section>
  );
}

function Preferences({ user, onSaved }: { user: AccountT; onSaved: (u: AccountT) => void }) {
  const [motion, setMotion] = useState(user.preferences.reducedMotion ?? "system");
  const [minutes, setMinutes] = useState(user.preferences.defaultDailyMinutes ?? 120);
  const [days, setDays] = useState(user.preferences.defaultDaysPerWeek ?? 5);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const save = async () => {
    try {
      onSaved((await account.update({ preferences: { reducedMotion: motion, defaultDailyMinutes: minutes, defaultDaysPerWeek: days } })).user);
      setMsg({ tone: "success", text: "Saved." });
    } catch (e) {
      setMsg({ tone: "danger", text: errText(e) });
    }
  };
  return (
    <Section title="Application">
      <div className="form acc-form">
        <label>Motion<select className="inp" value={motion} onChange={(e) => setMotion(e.target.value as typeof motion)}>
          <option value="system">Follow the system setting</option><option value="reduce">Reduce motion</option><option value="no-preference">Full motion</option></select></label>
        <label>Theme<select className="inp" value="light" disabled><option value="light">Light (the only theme so far)</option></select></label>
        <label>Default study minutes per day<input className="inp" type="number" min={0} max={720} step={15} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></label>
        <label>Default days per week<input className="inp" type="number" min={1} max={7} value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
      </div>
      <p className="sub">The defaults prefill the time step when you create a city.</p>
      <Saved state={msg} />
      <div className="rd-acts"><button className="btn primary" onClick={() => void save()}>Save preferences</button></div>
    </Section>
  );
}

function Password() {
  const [f, setF] = useState({ currentPassword: "", newPassword: "", newPasswordConfirm: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const mismatch = !!f.newPasswordConfirm && f.newPassword !== f.newPasswordConfirm;
  const save = async () => {
    try {
      setMsg({ tone: "success", text: (await account.changePassword(f)).message });
      setF({ currentPassword: "", newPassword: "", newPasswordConfirm: "" });
    } catch (e) {
      setMsg({ tone: "danger", text: errText(e) });
    }
  };
  return (
    <Section title="Password">
      <div className="form acc-form">
        <label>Current password<input className="inp" type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></label>
        <label>New password<input className="inp" type="password" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></label>
        <label>Repeat new password<input className="inp" type="password" autoComplete="new-password" value={f.newPasswordConfirm} aria-invalid={mismatch} onChange={(e) => setF({ ...f, newPasswordConfirm: e.target.value })} /></label>
      </div>
      <Saved state={msg} />
      <div className="rd-acts"><button className="btn primary" disabled={!f.currentPassword || f.newPassword.length < 10 || mismatch} onClick={() => void save()}>Change password</button></div>
    </Section>
  );
}

function Privacy({ onDeleted }: { onDeleted: () => void }) {
  const [consents, setConsents] = useState<ConsentState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    account.consents().then(setConsents, (e) => setError(errText(e)));
  }, []);
  const toggle = async (purpose: "AI_PROCESSING" | "AI_CURRICULUM", granted: boolean) => {
    try {
      setConsents(await account.setConsent(purpose, granted));
    } catch (e) {
      setError(errText(e));
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await account.remove(password);
      onDeleted();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };
  return (
    <Section title="Privacy">
      {!consents ? <LoadingState text="Loading your choices…" /> : (
        <ul className="list acc-consents">
          {consents.current.map((c) => (
            <li key={c.purpose}>
              <span>
                <b>{PURPOSE[c.purpose] ?? c.purpose}</b> <span className="m">{c.optional ? "optional" : "required for an account"}</span>
                <div className="m">{c.at ? `${c.granted ? "Agreed" : "Withdrawn"} ${shortDate(c.at.slice(0, 10))}, version ${c.policyVersion}` : "Not given"}{c.granted && c.policyVersion !== c.currentVersion ? ` · current version ${c.currentVersion}` : ""}</div>
              </span>
              {c.optional && (c.purpose === "AI_PROCESSING" || c.purpose === "AI_CURRICULUM") && (c.granted
                ? <button className="btn" onClick={() => void toggle(c.purpose as "AI_PROCESSING" | "AI_CURRICULUM", false)}>Withdraw</button>
                : <button className="btn" onClick={() => void toggle(c.purpose as "AI_PROCESSING" | "AI_CURRICULUM", true)}>Allow</button>)}
            </li>
          ))}
        </ul>
      )}
      <p className="sub">Withdrawing the AI choice stops all AI checks at once; answers already sent cannot be recalled from the provider.</p>
      <div className="rd-acts">
        <a className="btn" href={account.exportUrl} download>Download all my data (JSON)</a>
        <button className="btn danger" aria-expanded={confirming} onClick={() => setConfirming((x) => !x)}>Delete my account…</button>
      </div>
      {error && <FeedbackMessage tone="danger"><p>{error}</p></FeedbackMessage>}
      {confirming && (
        <div className="form acc-form">
          <FeedbackMessage tone="danger"><p>This permanently deletes your account, every city with its curriculum, tasks, progress and revision history, and your choices. It cannot be undone. Download your data first if you want a copy.</p></FeedbackMessage>
          <label>Password<input className="inp" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label>Type DELETE to confirm<input className="inp" value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
          <button className="btn danger solid" aria-busy={busy} disabled={busy || !password || typed !== "DELETE"} onClick={() => void remove()}>Delete account permanently</button>
          <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      )}
    </Section>
  );
}
