/**
 * Motion tokens for script-driven animation (camera, car, counters). The CSS tokens in styles.css (--dur-*, --ease-*)
 * use the same values; keep both in step. Motion only ever follows a state change: nothing waits for an animation.
 */
import { useEffect, useRef, useState } from "react";

export const MOTION = {
  fast: 120, // hover, press, focus
  base: 180, // badges, dropdowns, tabs, reveals
  slow: 260, // dialogs, panels, progress bars
  travel: 650, // camera flights and the car within a road segment
  travelMax: 1600, // the car across several districts
} as const;

/** Standard ease-in-out (the camera's original curve). */
export const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

/** The account's choice wins over the system setting (Settings → Reduced motion); "system" follows the OS. */
export const prefersReducedMotion = () => {
  const forced = typeof document !== "undefined" ? document.documentElement.dataset.motion : undefined;
  if (forced === "reduce") return true;
  if (forced === "full") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
};

/** Applies the account's motion preference to the page (CSS reads :root[data-motion]). */
export function applyMotionPreference(p: "system" | "reduce" | "no-preference" | undefined) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (p === "reduce") el.dataset.motion = "reduce";
  else if (p === "no-preference") el.dataset.motion = "full";
  else delete el.dataset.motion;
}

/**
 * Animates a displayed number towards `value` (e.g. a percentage). The real value is always what screen readers get:
 * render the animated one with aria-hidden next to the real one, or use it only where the value is also given in text.
 */
export function useAnimatedNumber(value: number, duration: number = MOTION.slow * 2): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (prefersReducedMotion() || from.current === value || typeof requestAnimationFrame !== "function") {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const v = start + (value - start) * easeInOut(p);
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return shown;
}

/**
 * Exit transition for an overlay: `leaving` turns on the CSS exit animation and `close` calls onClose when it ends.
 * The action itself is never delayed: the overlay stops taking input at once (CSS pointer-events), and with reduced
 * motion onClose runs immediately.
 */
export function useExit(onClose: () => void, duration: number = MOTION.base): { leaving: boolean; close: () => void } {
  const [leaving, setLeaving] = useState(false);
  const latest = useRef(onClose);
  latest.current = onClose;
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  const close = () => {
    if (typeof matchMedia !== "function" || prefersReducedMotion() || duration <= 0) return latest.current();
    if (timer.current) return;
    setLeaving(true);
    timer.current = window.setTimeout(() => latest.current(), duration);
  };
  return { leaving, close };
}
