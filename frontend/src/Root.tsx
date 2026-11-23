/**
 * Top-level routing (multi-user sprint): sign-in and account screens, onboarding, city management, and the existing
 * learning app for the selected city. The learning app is keyed by city, so switching city starts from clean state.
 */
import { useEffect, useRef, useState } from "react";
import { App } from "./App";
import { AccountSettings, Onboarding } from "./components/account/Account";
import { CalendarDisconnect, CalendarPage } from "./components/account/CalendarPage";
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
/**
 * A button that shows a short list of links and buttons under it (a disclosure, not an ARIA menu: Tab moves through it).
 * Opening it moves focus to its first item; it closes on Escape (focus back on the button), on a click or tap outside
 * it, and when the page changes.
 */
function usePopover() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>(".acct-menu a, .acct-menu button")?.focus();
    const outside = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const nav = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    addEventListener("hashchange", nav);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      removeEventListener("hashchange", nav);
    };
  }, [open]);
  return { open, setOpen, box, button };
}

const statusNote = (s: string) => (s === "PAUSED" ? " (paused)" : s === "COMPLETED" ? " (completed)" : "");

export function TopBar() {
  const { city, cities, selectCity, user, signOut } = useSession();
  const openable = cities.filter((c) => c.status !== "DRAFT" && c.status !== "ARCHIVED");
  const cityPop = usePopover();
  const acctPop = usePopover();
  return (
    <div className="topctl">
      {/* Choosing a city is a deliberate press, never a side effect of moving through a list. */}
      <div className="acct city-pop" ref={cityPop.box}>
        <button ref={cityPop.button} type="button" className="btn city-btn" aria-expanded={cityPop.open} aria-controls="city-list" onClick={() => cityPop.setOpen((x) => !x)}>
          <span className="sr">City: </span>
          <span className="city-name">{city?.name ?? "Choose a city"}</span>
          <span className="city-chev" aria-hidden="true">▾</span>
        </button>
        {cityPop.open && (
          <div id="city-list" className="acct-menu">
            {openable.length > 0 && (
              <ul aria-label="Your cities">
                {openable.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-current={c.id === city?.id ? "true" : undefined}
                      onClick={() => {
                        cityPop.setOpen(false);
                        if (c.id !== city?.id) selectCity(c.id);
                        location.hash = "#/today";
                      }}
                    >
                      {c.name}{statusNote(c.status)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <hr />
            <a href="#/cities/new">New city</a>
            <a href="#/cities">Manage cities</a>
          </div>
        )}
      </div>
      <div className="acct" ref={acctPop.box}>
        <button ref={acctPop.button} type="button" className="btn acct-btn" aria-expanded={acctPop.open} aria-controls="acct-list" onClick={() => acctPop.setOpen((x) => !x)}>
          <span className="acct-av" aria-hidden="true">{(user?.name ?? "?").slice(0, 1).toUpperCase()}</span>
          <span className="sr">Account</span>
        </button>
        {acctPop.open && (
          <div id="acct-list" className="acct-menu">
            {user?.email && <p className="acct-who">{user.email}</p>}
            <a href="#/account">Account settings</a>
            <a href="#/calendar">Google Calendar</a>
            <a href="#/cities">Manage cities</a>
            <button type="button" onClick={() => void signOut()}>Sign out</button>
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
      <main className="page-main">{children}</main>
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
  if (first === "calendar") return <Page>{second === "disconnect" ? <CalendarDisconnect /> : <CalendarPage />}</Page>;
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
