/**
 * Application data context (LLD §8): curriculum + progress from the server, a mutation
 * version counter that views watch to refetch, and optimistic curriculum updates.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import type { Curriculum, District, Progress, Topic } from "../api/types";
import { dayMonth } from "../lib/format";

interface AppDataValue {
  curriculum: Curriculum | null;
  progress: Progress | null;
  loadError: string | null;
  /** Increments after any mutation; views refetch when it changes. */
  version: number;
  topicById: Map<string, Topic>;
  districtById: Map<string, District>;
  reload: () => Promise<void>;
  /** Run a mutation, then refresh shared data. Errors are shown as a notice. */
  mutate: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  toggleSubtopic: (topicId: string, subtopicId: number, completed: boolean) => Promise<void>;
  patchTopic: (topicId: string, body: { demonstrated?: boolean; demonstrationNote?: string; needsReview?: boolean }) => Promise<void>;
  notice: string | null;
  setNotice: (m: string | null) => void;
}

const Ctx = createContext<AppDataValue | null>(null);

export function useAppData(): AppDataValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppData outside AppDataProvider");
  return v;
}

const message = (e: unknown) => (e instanceof ApiError ? e.message : "Couldn't save. Try again.");

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  const showNotice = useCallback((m: string | null) => {
    setNotice(m);
    window.clearTimeout(noticeTimer.current);
    if (m) noticeTimer.current = window.setTimeout(() => setNotice(null), 5000);
  }, []);

  const reload = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([api.curriculum(), api.progress()]);
      setCurriculum(c);
      setProgress(p);
      setLoadError(null);
    } catch (e) {
      setLoadError(message(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const mutate = useCallback(
    async <T,>(fn: () => Promise<T>) => {
      try {
        const r = await fn();
        await reload();
        setVersion((v) => v + 1);
        return r;
      } catch (e) {
        showNotice(message(e));
        await reload();
        setVersion((v) => v + 1);
        return undefined;
      }
    },
    [reload, showNotice],
  );

  const updateTopic = (topicId: string, f: (t: Topic) => Topic) =>
    setCurriculum((c) =>
      c && {
        ...c,
        districts: c.districts.map((d) => ({ ...d, topics: d.topics.map((t) => (t.id === topicId ? f(t) : t)) })),
      },
    );

  const toggleSubtopic = useCallback(
    async (topicId: string, subtopicId: number, completed: boolean) => {
      // Optimistic floor: the building grows immediately; reload() reconciles or rolls back.
      updateTopic(topicId, (t) => ({
        ...t,
        subtopics: t.subtopics.map((s) => (s.id === subtopicId ? { ...s, completedAt: completed ? new Date().toISOString() : null } : s)),
      }));
      const r = await mutate(() => api.setSubtopic(subtopicId, completed));
      // Recall (docs/Recall-Plan.md §3.1): say when it comes back, so the schedule is visible at once.
      if (completed && r?.recallDue) showNotice(`Learned. Recall due on ${dayMonth(r.recallDue)}: it will be in Revision and on Today.`);
    },
    [mutate, showNotice],
  );

  const patchTopic = useCallback(
    async (topicId: string, body: { demonstrated?: boolean; demonstrationNote?: string; needsReview?: boolean }) => {
      await mutate(() => api.patchTopic(topicId, body));
    },
    [mutate],
  );

  const value = useMemo<AppDataValue>(() => {
    const topicById = new Map<string, Topic>();
    const districtById = new Map<string, District>();
    for (const d of curriculum?.districts ?? []) {
      districtById.set(d.id, d);
      for (const t of d.topics) topicById.set(t.id, t);
    }
    return {
      curriculum, progress, loadError, version, topicById, districtById, reload, mutate,
      toggleSubtopic, patchTopic, notice, setNotice: showNotice,
    };
  }, [curriculum, progress, loadError, version, reload, mutate, toggleSubtopic, patchTopic, notice, showNotice]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
