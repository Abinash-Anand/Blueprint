/**
 * Session context (multi-user sprint): the signed-in account, their cities and the city the learning views work in.
 * The selected city is remembered per browser (localStorage, best effort) and sent as X-City-Id; switching city
 * remounts the city-scoped data (AppDataProvider is keyed by city), so nothing of one city is shown in another.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, SESSION_ENDED, auth, cities as citiesApi, setCurrentCity } from "../api/client";
import type { Account, CitySummary } from "../api/types";
import { applyMotionPreference } from "../lib/motion";
import { type CameraStore, cameraStore } from "../map/camera";

const KEY = "blueprint.city";
const remember = (id: string | null) => {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
};
const recalled = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

/** A city the learning views can open. */
export const isOpenable = (c: CitySummary) => c.status !== "DRAFT";

interface SessionValue {
  status: "loading" | "signedOut" | "signedIn";
  user: Account | null;
  cities: CitySummary[];
  city: CitySummary | null;
  error: string | null;
  selectCity: (id: string | null) => void;
  refreshCities: () => Promise<CitySummary[]>;
  setUser: (u: Account) => void;
  signedIn: (u: Account) => Promise<void>;
  signOut: () => Promise<void>;
  /** Map cameras per account and city; emptied whenever the signed-in account changes or signs out. */
  cameras: CameraStore;
}

const Ctx = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionValue["status"]>("loading");
  const [user, setUserState] = useState<Account | null>(null);
  const [list, setList] = useState<CitySummary[]>([]);
  const [cityId, setCityId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameras] = useState(cameraStore);

  const setUser = useCallback((u: Account) => {
    setUserState(u);
    applyMotionPreference(u.preferences.reducedMotion);
  }, []);

  const selectCity = useCallback((id: string | null) => {
    setCurrentCity(id);
    setCityId(id);
    remember(id);
  }, []);

  const refreshCities = useCallback(async () => {
    const xs = await citiesApi.list();
    setList(xs);
    return xs;
  }, []);

  const enter = useCallback(async (u: Account) => {
    cameras.clear(); // a new sign-in never sees another session's map position
    setUser(u);
    const xs = await refreshCities();
    const saved = recalled();
    const pick = xs.find((c) => c.id === saved && isOpenable(c)) ?? xs.find((c) => c.status === "ACTIVE") ?? xs.find(isOpenable) ?? null;
    selectCity(pick?.id ?? null);
    setStatus("signedIn");
  }, [refreshCities, selectCity, setUser, cameras]);

  useEffect(() => {
    auth.me().then(
      (r) => void enter(r.user).catch((e) => setError(e instanceof ApiError ? e.message : "Can't load your cities.")),
      (e) => {
        if (!(e instanceof ApiError) || e.status !== 401) setError(e instanceof ApiError ? e.message : "Can't reach the Blueprint server.");
        setStatus("signedOut");
      },
    );
  }, [enter]);

  useEffect(() => {
    const ended = () => {
      cameras.clear();
      setCurrentCity(null);
      setUserState(null);
      setStatus("signedOut");
    };
    addEventListener(SESSION_ENDED, ended);
    return () => removeEventListener(SESSION_ENDED, ended);
  }, [cameras]);

  const signOut = useCallback(async () => {
    await auth.logout().catch(() => undefined);
    cameras.clear();
    setCurrentCity(null);
    setUserState(null);
    setList([]);
    setCityId(null);
    setStatus("signedOut");
    location.hash = "#/login";
  }, [cameras]);

  const value = useMemo<SessionValue>(() => ({
    status, user, cities: list, city: list.find((c) => c.id === cityId) ?? null, error,
    selectCity, refreshCities, setUser, signedIn: enter, signOut, cameras,
  }), [status, user, list, cityId, error, selectCity, refreshCities, setUser, enter, signOut, cameras]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
