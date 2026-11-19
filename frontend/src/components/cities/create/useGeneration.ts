/**
 * Follows a city's background generation (AI design §10.3): starts it, polls the version, keeps following through a
 * brief server restart (502/503/504 or no network), resumes a job that is already running, and hands over the proposal.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, cities as api } from "../../../api/client";
import type { CurriculumVersion } from "../../../api/types";

export interface GenerationState {
  running: number | null;
  label: string;
  districts: { name: string; done: boolean }[];
  error: string | null;
  startedAt: number;
}

const brief = (e: unknown) => e instanceof ApiError && [0, 502, 503, 504].includes(e.status);
const message = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");

export function useGeneration(cityId: string | null, onProposal: (v: CurriculumVersion) => void, pollMs = 2500) {
  const done = useRef(onProposal);
  done.current = onProposal;
  const [s, set] = useState<GenerationState>({ running: null, label: "Starting", districts: [], error: null, startedAt: 0 });

  // Resume a generation that is still running (page reload, back and forth), or show a proposal that is waiting.
  useEffect(() => {
    if (!cityId) return;
    void api.versions(cityId).then((vs) => {
      const g = vs.find((v) => v.status === "GENERATING");
      if (g) set((x) => ({ ...x, running: g.version, startedAt: Date.now() }));
      else {
        const p = vs.find((v) => v.status === "PROPOSED");
        if (p) void api.version(cityId, p.version).then((v) => done.current(v), () => undefined);
      }
    }, () => undefined);
  }, [cityId]);

  useEffect(() => {
    if (!cityId || s.running === null) return;
    const version = s.running;
    let stop = false, misses = 0;
    const tick = async () => {
      try {
        const v = await api.version(cityId, version);
        if (stop) return;
        misses = 0;
        if (v.status === "GENERATING") {
          set((x) => ({ ...x, label: v.progress?.label ?? "Working", districts: v.progress?.districts ?? x.districts }));
          setTimeout(() => void tick(), pollMs);
        } else if (v.status === "PROPOSED") {
          set((x) => ({ ...x, running: null, districts: x.districts.map((d) => ({ ...d, done: true })) }));
          done.current(v);
        } else set((x) => ({ ...x, running: null, error: v.error ?? "The city couldn't be built. Try again." }));
      } catch (e) {
        if (stop) return;
        if (brief(e) && misses < 24) {
          misses++;
          set((x) => ({ ...x, label: "Reconnecting to the server…" }));
          setTimeout(() => void tick(), pollMs * 2);
        } else set((x) => ({ ...x, running: null, error: message(e) }));
      }
    };
    void tick();
    return () => { stop = true; };
  }, [cityId, s.running, pollMs]);

  const start = useCallback(async () => {
    if (!cityId) return;
    set((x) => ({ ...x, error: null, districts: [], label: "Starting" }));
    try {
      const r = await api.generate(cityId);
      set((x) => ({ ...x, running: r.version, startedAt: Date.now() }));
    } catch (e) {
      set((x) => ({ ...x, error: message(e) }));
    }
  }, [cityId]);

  return { ...s, start };
}
