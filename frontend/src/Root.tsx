/**
 * Top-level routing (multi-user sprint): sign-in and account screens, onboarding, city management, and the existing
 * learning app for the selected city. The learning app is keyed by city, so switching city starts from clean state.
 */
import { useEffect, useState } from "react";
import { App } from "./App";
import { AccountSettings, Onboarding } from "./components/account/Account";
import { type AuthRoute, AuthScreens } from "./components/account/AuthScreens";
import { CityManager } from "./components/cities/Cities";
import { CreateCity } from "./components/cities/create/CreateCity";
import { Loading } from "./components/ui";
import { AppDataProvider } from "./state/AppData";
import { useSession } from "./state/Session";
import { FeedbackMessage } from "./components/Status";

const AUTH: AuthRoute[] = ["login", "register", "verify-email", "forgot-password", "reset-password", "privacy", "terms"];
const useHash = () => {
  const [h, setH] = useState(location.hash);
  useEffect(() => {
    const on = () => setH(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return h;
};

/** Account and city screens share a slim header with the way back to the open city. */
export function TopBar() {
  const { city, cities, selectCity, user, signOut } = useSession();
  const openable = cities.filter((c) => c.status !== "DRAFT" && c.status !== "ARCHIVED");
  const [menu, setMenu] = useState(false);
  return (
    <div className="topctl">
      <label className="city-switch">
        <span className="sr">Current city</span>
        <select
          className="inp"
          value={city?.id ?? ""}
          onChange={(e) => {
            if (e.target.value === "__manage") location.hash = "#/cities";
            else if (e.target.value === "__new") location.hash = "#/cities/new";
            else {
              selectCity(e.target.value);
              location.hash = "#/today";
            }
          }}
        >
          {!city && <option value="">Choose a city…</option>}
          {openable.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status === "PAUSED" ? " (paused)" : c.status === "COMPLETED" ? " (completed)" : ""}</option>)}
          <option value="__new">+ New city…</option>
          <option value="__manage">Manage cities…</option>
        </select>
      </label>
      <div className="acct">
        <button className="btn acct-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((x) => !x)} title={user?.email}>
          <span className="acct-av" aria-hidden="true">{(user?.name ?? "?").slice(0, 1).toUpperCase()}</span>
          <span className="sr">Account menu</span>
        </button>
        {menu && (
          <div className="acct-menu" role="menu" onClick={() => setMenu(false)}>
            <a role="menuitem" href="#/account">Account settings</a>
            <a role="menuitem" href="#/cities">Manage cities</a>
            <button role="menuitem" onClick={() => void signOut()}>Sign out</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  const { city } = useSession();
  return (
    <div className="page">
      <header className="vbar">
        <a className="brand-link" href={city ? "#/today" : "#/cities"}>{city ? `← ${city.name}` : "Blueprint"}</a>
        <TopBar />
      </header>
      {children}
    </div>
  );
}

export function Root() {
  const s = useSession();
  const hash = useHash();
  const [, first, second] = hash.replace(/^#/, "").split("?")[0].split("/");

  if (s.status === "loading") return <Loading text="Loading Blueprint…" />;
  if (s.status === "signedOut") {
    const r = AUTH.includes(first as AuthRoute) ? (first as AuthRoute) : "login";
    return (
      <>
        {s.error && <div className="auth-banner"><FeedbackMessage tone="danger"><p>{s.error}</p></FeedbackMessage></div>}
        <AuthScreens route={r} />
      </>
    );
  }
  if (first === "privacy" || first === "terms") return <AuthScreens route={first} />;
  if (!s.user?.onboardedAt && first !== "cities") return <Onboarding />;
  if (first === "account") return <Page><AccountSettings /></Page>;
  if (first === "cities" && second === "new") {
    const draft = hash.split("?")[0].split("/")[3] ?? null;
    return <Page><CreateCity key={draft ?? "new"} draftId={draft} /></Page>;
  }
  if (first === "cities" || !s.city) return <Page><CityManager /></Page>;
  return (
    <AppDataProvider key={s.city.id}>
      <App />
    </AppDataProvider>
  );
}
