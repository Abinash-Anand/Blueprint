/**
 * Semantic status components (LLD §4.4). They render the presentation the backend chose; they never decide what a
 * domain state means. Colours come from the tone tokens in styles.css, so meaning is never carried by colour alone:
 * every badge has its label and an icon.
 */
import type { ReactNode } from "react";
import type { Presentation, Tone, Variant } from "../api/types";

const TONES: readonly Tone[] = ["success", "warning", "danger", "info", "neutral", "ai"];
const VARIANTS: readonly Variant[] = ["solid", "soft", "outline", "plain"];

/** Unknown or missing metadata renders as a neutral, soft badge rather than failing. */
export const toneOf = (t?: string | null): Tone => (TONES.includes(t as Tone) ? (t as Tone) : "neutral");
export const variantOf = (v?: string | null): Variant => (VARIANTS.includes(v as Variant) ? (v as Variant) : "soft");

const PATHS: Record<string, ReactNode> = {
  check: <path d="M3.5 8.5l3 3 6-7" />,
  "check-circle": <><circle cx="8" cy="8" r="6.25" /><path d="M5.25 8.25l2 2 3.75-4.5" /></>,
  circle: <circle cx="8" cy="8" r="5.5" />,
  half: <><circle cx="8" cy="8" r="5.75" /><path d="M8 2.25v11.5A5.75 5.75 0 0 1 8 2.25z" fill="currentColor" stroke="none" /></>,
  clock: <><circle cx="8" cy="8" r="6.25" /><path d="M8 4.75V8l2.25 1.5" /></>,
  calendar: <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></>,
  "alert-circle": <><circle cx="8" cy="8" r="6.25" /><path d="M8 4.75v3.75M8 11.1v.15" /></>,
  "alert-triangle": <><path d="M8 2.25l6 10.5H2z" /><path d="M8 6.5v3M8 11.1v.15" /></>,
  "x-circle": <><circle cx="8" cy="8" r="6.25" /><path d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" /></>,
  pause: <path d="M6 4v8M10 4v8" />,
  skip: <path d="M4 4l5 4-5 4zM11.5 4v8" />,
  flag: <path d="M4 14V2.5M4 3h7.5l-1.75 2.75L11.5 8.5H4" />,
  sparkle: <path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4zM12.5 11.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z" />,
  edit: <path d="M10.5 2.75l2.75 2.75L6 12.75H3.25V10z" />,
  target: <><circle cx="8" cy="8" r="6.25" /><circle cx="8" cy="8" r="2.5" /></>,
  minus: <path d="M4 8h8" />,
};

/** A 1em line icon in the current text colour, hidden from assistive technology (the label carries the meaning). */
export function SemanticIcon({ name, className }: { name?: string; className?: string }) {
  const d = name ? PATHS[name] : undefined;
  if (!d) return null;
  return (
    <svg className={`si${className ? ` ${className}` : ""}`} viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {d}
    </svg>
  );
}

/** One state as a badge: icon + label, tinted by tone, weighted by variant. */
export function StatusBadge({ p, fallback, className }: { p?: Presentation | null; fallback?: string; className?: string }) {
  if (!p && !fallback) return null;
  const tone = toneOf(p?.tone), variant = p ? variantOf(p.variant) : "plain";
  return (
    <span className={`sb t-${tone} v-${variant}${className ? ` ${className}` : ""}`} data-state={p?.state ?? "unknown"}>
      <SemanticIcon name={p?.icon} />
      <span className="sb-l">{p?.label ?? fallback}</span>
    </span>
  );
}

/** A primary state with its flags (e.g. "3 days overdue" + "Weak") and optional plain detail text. */
export function StatusIndicator({ p, detail, fallback }: { p?: Presentation | null; detail?: ReactNode; fallback?: string }) {
  if (!p && !fallback) return null;
  return (
    <span className="sind">
      <StatusBadge p={p} fallback={fallback} />
      {detail && <span className="sind-d">{detail}</span>}
      {p?.flags?.map((f) => <StatusBadge key={f.state} p={f} />)}
    </span>
  );
}

/** A message that confirms, warns or reports an error. Errors are announced at once; the rest politely. */
export function FeedbackMessage({ tone, icon, children, className, onDismiss }: { tone: Tone; icon?: string; children: ReactNode; className?: string; onDismiss?: () => void }) {
  const t = toneOf(tone);
  const fallbackIcon = { success: "check-circle", warning: "alert-triangle", danger: "alert-circle", info: "clock", neutral: "circle", ai: "sparkle" }[t];
  return (
    <div className={`fb t-${t}${className ? ` ${className}` : ""}`} role={t === "danger" ? "alert" : "status"}>
      <SemanticIcon name={icon ?? fallbackIcon} />
      <div className="fb-b">{children}</div>
      {onDismiss && <button type="button" className="x fb-x" aria-label="Dismiss message" onClick={onDismiss}>×</button>}
    </div>
  );
}

/** Work in progress (a request, a transcription): a quiet spinner and what is happening. No fake delay. */
export function LoadingState({ text, tone = "neutral", className }: { text: string; tone?: Tone; className?: string }) {
  return (
    <span className={`lds t-${toneOf(tone)}${className ? ` ${className}` : ""}`} role="status" aria-live="polite">
      <span className="spin" aria-hidden="true" />
      {text}
    </span>
  );
}
