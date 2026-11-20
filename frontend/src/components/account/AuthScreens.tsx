/**
 * Sign-in, sign-up, e-mail verification and password reset (multi-user sprint). Same paper-and-ink look as the app;
 * required acknowledgements are never pre-ticked; messages never reveal whether an address has an account.
 */
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { ApiError, auth } from "../../api/client";
import { useSession } from "../../state/Session";
import { FeedbackMessage } from "../Status";

export type AuthRoute = "login" | "register" | "verify-email" | "forgot-password" | "reset-password" | "privacy" | "terms";

const tokenFromHash = () => new URLSearchParams(location.hash.split("?")[1] ?? "").get("token") ?? "";
const go = (r: AuthRoute) => {
  location.hash = `#/${r}`;
};
const fieldErrors = (e: unknown): Record<string, string> => {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return {};
  return Object.fromEntries((e.details as { path: string; message: string }[]).map((d) => [d.path, d.message]));
};

function Shell({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="auth">
      <main className="auth-card card" aria-labelledby="auth-title">
        <p className="brand">Blueprint</p>
        <h1 id="auth-title">{title}</h1>
        {sub && <p className="sub">{sub}</p>}
        {children}
      </main>
    </div>
  );
}

function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="af">
      <span>{label}</span>
      {children}
      {hint && !error && <small className="af-hint">{hint}</small>}
      {error && <small className="af-err" role="alert">{error}</small>}
    </label>
  );
}

function Login() {
  const { signedIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [resent, setResent] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await auth.login({ email, password, remember });
      await signedIn(r.user);
      location.hash = "#/today";
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "ERROR", "Sign-in failed."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Sign in" sub="Your cities, tasks and progress are waiting.">
      <form className="af-form" onSubmit={(e) => void submit(e)} noValidate>
        <Field label="E-mail"><input className="inp" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input className="inp" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <label className="af-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Keep me signed in on this device for 30 days</label>
        {error && (
          <FeedbackMessage tone={error.status === 429 ? "warning" : "danger"}>
            <p>{error.message}</p>
            {error.code === "EMAIL_NOT_VERIFIED" && (
              <p><button type="button" className="link" onClick={() => void auth.resendVerification(email).then((r) => setResent(r.message))}>Send the confirmation link again</button></p>
            )}
          </FeedbackMessage>
        )}
        {resent && <FeedbackMessage tone="info"><p>{resent}</p></FeedbackMessage>}
        <button className="btn primary af-submit" aria-busy={busy} disabled={busy || !email || !password}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="af-links"><button className="link" onClick={() => go("forgot-password")}>Forgot your password?</button> · <button className="link" onClick={() => go("register")}>Create an account</button></p>
    </Shell>
  );
}

function Register() {
  const [f, setF] = useState({ name: "", email: "", password: "", passwordConfirm: "" });
  const [acceptTerms, setTerms] = useState(false);
  const [acknowledgePrivacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const errs = fieldErrors(error);
  const mismatch = f.passwordConfirm.length > 0 && f.password !== f.passwordConfirm;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDone((await auth.register({ ...f, acceptTerms, acknowledgePrivacy })).message);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "ERROR", "Registration failed."));
    } finally {
      setBusy(false);
    }
  };
  if (done)
    return (
      <Shell title="Check your inbox">
        <FeedbackMessage tone="success"><p>{done}</p></FeedbackMessage>
        <p className="sub">Running Blueprint locally without a mail server? The message is saved as a file in the <code>mail-outbox</code> folder of the backend.</p>
        <p className="af-links"><button className="link" onClick={() => go("login")}>Back to sign in</button></p>
      </Shell>
    );
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Shell title="Create your account" sub="Only what Blueprint needs: your name, e-mail and a password.">
      <form className="af-form" onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Name" error={errs.name}><input className="inp" autoComplete="name" maxLength={80} value={f.name} onChange={set("name")} aria-invalid={!!errs.name} /></Field>
        <Field label="E-mail" error={errs.email}><input className="inp" type="email" autoComplete="email" value={f.email} onChange={set("email")} aria-invalid={!!errs.email} /></Field>
        <Field label="Password" error={errs.password} hint="At least 10 characters. A short sentence works well.">
          <input className="inp" type="password" autoComplete="new-password" value={f.password} onChange={set("password")} aria-invalid={!!errs.password} />
        </Field>
        <Field label="Repeat the password" error={mismatch ? "The passwords do not match" : errs.passwordConfirm}>
          <input className="inp" type="password" autoComplete="new-password" value={f.passwordConfirm} onChange={set("passwordConfirm")} aria-invalid={mismatch || !!errs.passwordConfirm} />
        </Field>
        <label className="af-check"><input type="checkbox" checked={acceptTerms} onChange={(e) => setTerms(e.target.checked)} /> I accept the <a href="#/terms" target="_blank" rel="noreferrer">terms of use</a> (required)</label>
        <label className="af-check"><input type="checkbox" checked={acknowledgePrivacy} onChange={(e) => setPrivacy(e.target.checked)} /> I have read the <a href="#/privacy" target="_blank" rel="noreferrer">privacy notice</a> (required)</label>
        <p className="af-hint">Optional choices, such as using the AI check, are asked separately later and can be changed at any time.</p>
        {error && !Object.keys(errs).length && <FeedbackMessage tone={error.status === 429 ? "warning" : "danger"}><p>{error.message}</p></FeedbackMessage>}
        <button className="btn primary af-submit" aria-busy={busy} disabled={busy || !acceptTerms || !acknowledgePrivacy || !f.name || !f.email || f.password.length < 10 || mismatch}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="af-links">Already registered? <button className="link" onClick={() => go("login")}>Sign in</button></p>
    </Shell>
  );
}

function VerifyEmail() {
  const [state, setState] = useState<{ tone: "success" | "danger" | "neutral"; text: string }>({ tone: "neutral", text: "Confirming your e-mail address…" });
  useEffect(() => {
    auth.verifyEmail(tokenFromHash()).then(
      (r) => setState({ tone: "success", text: r.message }),
      (e) => setState({ tone: "danger", text: e instanceof ApiError ? e.message : "This link could not be used." }),
    );
  }, []);
  return (
    <Shell title="Confirm e-mail address">
      <FeedbackMessage tone={state.tone}><p>{state.text}</p></FeedbackMessage>
      <p className="af-links"><button className="link" onClick={() => go("login")}>Sign in</button></p>
    </Shell>
  );
}

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      setMsg({ tone: "success", text: (await auth.forgotPassword(email)).message });
    } catch (err) {
      setMsg({ tone: err instanceof ApiError && err.status === 429 ? "warning" : "danger", text: err instanceof ApiError ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Reset your password" sub="We send a link that works once and expires after an hour.">
      <form className="af-form" onSubmit={(e) => void submit(e)} noValidate>
        <Field label="E-mail"><input className="inp" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        {msg && <FeedbackMessage tone={msg.tone}><p>{msg.text}</p></FeedbackMessage>}
        <button className="btn primary af-submit" aria-busy={busy} disabled={busy || !email}>Send the link</button>
      </form>
      <p className="af-links"><button className="link" onClick={() => go("login")}>Back to sign in</button></p>
    </Shell>
  );
}

function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && password !== confirm;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      setMsg({ tone: "success", text: (await auth.resetPassword({ token: tokenFromHash(), password, passwordConfirm: confirm })).message });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "The password could not be changed." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Choose a new password" sub="Every device signed in with the old password will be signed out.">
      {msg?.tone === "success" ? (
        <>
          <FeedbackMessage tone="success"><p>{msg.text}</p></FeedbackMessage>
          <p className="af-links"><button className="link" onClick={() => go("login")}>Sign in</button></p>
        </>
      ) : (
        <form className="af-form" onSubmit={(e) => void submit(e)} noValidate>
          <Field label="New password" hint="At least 10 characters."><input className="inp" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="Repeat the new password" error={mismatch ? "The passwords do not match" : undefined}><input className="inp" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} /></Field>
          {msg && <FeedbackMessage tone="danger"><p>{msg.text}</p></FeedbackMessage>}
          <button className="btn primary af-submit" aria-busy={busy} disabled={busy || password.length < 10 || mismatch}>Change password</button>
        </form>
      )}
    </Shell>
  );
}

/** Draft legal pages: structure for review, clearly marked as not final (docs/Privacy.md). */
export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  return (
    <Shell title={kind === "privacy" ? "Privacy notice (draft)" : "Terms of use (draft)"}>
      <FeedbackMessage tone="warning"><p>Draft for legal review, not a final legal text. Version 2026-11-18, wording updated 19 Nov 2026 for city creation.</p></FeedbackMessage>
      {kind === "privacy" ? (
        <div className="legal">
          <h2>What Blueprint stores</h2>
          <p>Your account (name, e-mail, a password hash, time zone, language, preferences), your cities and learning records (including what you wrote about a new city's goal, the text of plan files you added and of revision material you added for a topic, and the revision questions built from it; never the files themselves, never recordings), sign-in sessions, and the choices you made below with their date and version. Nothing else, and no tracking.</p>
          <h2>Why</h2>
          <p>To provide the service you signed up for (your account and learning data), and, only with your separate consent for each, to send revision answers to an AI provider for checking and the text of a topic's revision material to build its revision questions, and to send a new city's goal (typed or spoken), the text of your plan files and your time settings to an AI provider to build the city.</p>
          <h2>Who else receives data</h2>
          <p>The hosting and e-mail providers that operate Blueprint, and, only if you enable the AI features, the AI provider named in their notices (currently GWDG Academic Cloud, Göttingen). See the processor list in the documentation.</p>
          <h2>How long</h2>
          <p>Until you delete a city or your account. Expired sessions and links are removed automatically. Backups are kept for a limited time and overwritten.</p>
          <h2>Your rights</h2>
          <p>Access and export your data, correct it, delete your account, and withdraw optional consent at any time, all from Account settings. You can also complain to a data-protection authority.</p>
          <h2>Contact</h2>
          <p>[Controller name and contact details: to be completed.]</p>
        </div>
      ) : (
        <div className="legal">
          <h2>The service</h2>
          <p>Blueprint helps you plan and track your own learning. It does not certify any skill.</p>
          <h2>Your account</h2>
          <p>Keep your password private. You are responsible for what you enter. You can delete your account at any time.</p>
          <h2>Availability</h2>
          <p>[Availability, liability and governing law: to be completed after legal review.]</p>
        </div>
      )}
      <p className="af-links"><button className="link" onClick={() => history.back()}>Back</button></p>
    </Shell>
  );
}

export function AuthScreens({ route }: { route: AuthRoute }) {
  switch (route) {
    case "register": return <Register />;
    case "verify-email": return <VerifyEmail />;
    case "forgot-password": return <ForgotPassword />;
    case "reset-password": return <ResetPassword />;
    case "privacy": return <LegalPage kind="privacy" />;
    case "terms": return <LegalPage kind="terms" />;
    default: return <Login />;
  }
}
