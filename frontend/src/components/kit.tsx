/**
 * Building blocks for calm, one-question-per-screen flows (city creation; LLD §4.7): a number stepper, a segmented
 * control, weekday toggles, grouped lists with check, disclosure and switch rows, a bottom sheet, pills and a flow
 * header. Same paper, ink, accent and focus tokens as the rest of Blueprint (styles.css Part 5); every control works
 * with the keyboard and announces its state to assistive technology.
 */
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

/* ---------------- number stepper ---------------- */

export function NumberStepper({ label, value, min, max, step = 1, unit, format = String, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit: string;
  format?: (v: number) => string; onChange: (v: number) => void;
}) {
  // Round to the step so repeated presses never drift (0.1 + 0.2).
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)));
  const onKey = (e: KeyboardEvent) => {
    const map: Record<string, number> = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: step * 4, PageDown: -step * 4 };
    if (e.key in map) { e.preventDefault(); set(value + map[e.key]); }
    else if (e.key === "Home") { e.preventDefault(); set(min); }
    else if (e.key === "End") { e.preventDefault(); set(max); }
  };
  return (
    <div className="kit-stepper" role="group" aria-label={label}>
      <button type="button" className="kit-round" aria-label={`Less (${label.toLowerCase()})`} disabled={value <= min} onClick={() => set(value - step)}>−</button>
      <div
        className="kit-stepper-value" role="spinbutton" tabIndex={0} aria-label={label}
        aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} aria-valuetext={`${format(value)} ${unit}`} onKeyDown={onKey}
      >
        <span className="kit-big">{format(value)}</span>
        <span className="kit-unit">{unit}</span>
      </div>
      <button type="button" className="kit-round" aria-label={`More (${label.toLowerCase()})`} disabled={value >= max} onClick={() => set(value + step)}>+</button>
    </div>
  );
}

/* ---------------- segmented control ---------------- */

export interface SegmentOption<T extends string> { value: T; label: string; hint?: string }

/** One choice of a few, like iOS: a radio group with roving focus (arrow keys move and select, as native radios do). */
export function Segmented<T extends string>({ label, options, value, onChange }: {
  label: string; options: SegmentOption<T>[]; value: T | null; onChange: (v: T) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const hintId = useId();
  const current = options.findIndex((o) => o.value === value);
  const move = (i: number) => {
    const n = (i + options.length) % options.length;
    onChange(options[n].value);
    refs.current[n]?.focus();
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (d) { e.preventDefault(); move(i + d); }
    else if (e.key === "Home") { e.preventDefault(); move(0); }
    else if (e.key === "End") { e.preventDefault(); move(options.length - 1); }
  };
  const hint = options[current]?.hint;
  return (
    <div className="kit-seg-wrap">
      <div className="kit-seg" role="radiogroup" aria-label={label} aria-describedby={hint ? hintId : undefined} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o, i) => (
          <button
            key={o.value} type="button" role="radio" ref={(el) => { refs.current[i] = el; }}
            aria-checked={o.value === value} tabIndex={o.value === value || (current < 0 && i === 0) ? 0 : -1}
            className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)} onKeyDown={(e) => onKey(e, i)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <p className="kit-seg-hint" id={hintId}>{hint}</p>}
    </div>
  );
}

/* ---------------- weekday toggles ---------------- */

const DAYS = [["M", "Monday"], ["T", "Tuesday"], ["W", "Wednesday"], ["T", "Thursday"], ["F", "Friday"], ["S", "Saturday"], ["S", "Sunday"]] as const;

/** Which days of the week (ISO 1 = Monday … 7 = Sunday); at least one always stays on. */
export function DayToggles({ label = "Days you study", value, onChange }: { label?: string; value: number[]; onChange: (days: number[]) => void }) {
  const on = new Set(value);
  const toggle = (d: number) => {
    if (on.has(d)) { if (on.size > 1) onChange([...on].filter((x) => x !== d).sort()); }
    else onChange([...on, d].sort());
  };
  return (
    <div className="kit-days" role="group" aria-label={label}>
      {DAYS.map(([short, long], i) => {
        const d = i + 1, pressed = on.has(d);
        return (
          <button
            key={d} type="button" className={`kit-day${pressed ? " on" : ""}`} aria-pressed={pressed} aria-label={long}
            aria-disabled={pressed && on.size === 1 ? true : undefined} title={pressed && on.size === 1 ? "At least one day" : long}
            onClick={() => toggle(d)}
          >
            {short}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- grouped lists ---------------- */

/** An inset group of rows with a small caption above it. */
export function Group({ caption, children, footer }: { caption?: string; children: ReactNode; footer?: ReactNode }) {
  const id = useId();
  return (
    <section className="kit-group-wrap" aria-labelledby={caption ? id : undefined}>
      {caption && <h3 className="kit-caption" id={id}>{caption}</h3>}
      <div className="kit-group">{children}</div>
      {footer && <p className="kit-group-foot">{footer}</p>}
    </section>
  );
}

/** A row that opens something (an editor, a picker): label on the left, current value and a chevron on the right. */
export function DisclosureRow({ label, value, icon, onClick }: { label: ReactNode; value?: ReactNode; icon?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="kit-row" onClick={onClick}>
      {icon && <span className="kit-row-icon" aria-hidden="true">{icon}</span>}
      <span className="kit-row-label">{label}</span>
      {value !== undefined && <span className="kit-row-value">{value}</span>}
      <span className="kit-chev" aria-hidden="true">›</span>
    </button>
  );
}

/** A row that is on or off, shown with a checkmark (a list of choices that can each be kept or left out). */
export function CheckRow({ label, checked, disabled, onToggle }: { label: ReactNode; checked: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-disabled={disabled || undefined} className={`kit-row kit-check${checked ? " on" : ""}`} onClick={() => !disabled && onToggle()}>
      <span className="kit-row-label">{label}</span>
      <span className="kit-checkmark" aria-hidden="true">{checked ? "✓" : ""}</span>
    </button>
  );
}

/** A row with text and a switch on the right; the whole row toggles it. */
export function SwitchRow({ label, description, checked, onChange }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="kit-row kit-switch-row" onClick={() => onChange(!checked)}>
      <span className="kit-row-label" id={id}>
        {label}
        {description && <small>{description}</small>}
      </span>
      <Switch checked={checked} onChange={onChange} labelledBy={id} />
    </div>
  );
}

/** A plain row (text only), for read-only lines inside a group. */
export function TextRow({ children }: { children: ReactNode }) {
  return <div className="kit-row kit-text-row">{children}</div>;
}

/* ---------------- switch ---------------- */

export function Switch({ checked, onChange, label, labelledBy }: { checked: boolean; onChange: (v: boolean) => void; label?: string; labelledBy?: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy}
      className={`kit-switch${checked ? " on" : ""}`}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
    >
      <span className="kit-knob" aria-hidden="true" />
    </button>
  );
}

/* ---------------- pills ---------------- */

/** A small rounded suggestion ("A language", "An exam"); pressed when it is the current choice. */
export function Pill({ children, pressed, onClick }: { children: ReactNode; pressed?: boolean; onClick: () => void }) {
  return <button type="button" className={`kit-pill${pressed ? " on" : ""}`} aria-pressed={pressed} onClick={onClick}>{children}</button>;
}

/* ---------------- flow header ---------------- */

/** "‹ Back · 2 of 4 · Cancel" above a step; Back is hidden (not removed) on the first step so nothing shifts. */
export function FlowHeader({ step, total, onBack, onCancel, cancelLabel = "Cancel" }: { step: number; total: number; onBack?: () => void; onCancel?: () => void; cancelLabel?: string }) {
  return (
    <div className="kit-flowbar">
      <button type="button" className="kit-link" onClick={onBack} style={{ visibility: onBack ? "visible" : "hidden" }} aria-hidden={!onBack} tabIndex={onBack ? 0 : -1}>‹ Back</button>
      <span className="kit-count" aria-label={`Step ${step} of ${total}`}>{step} of {total}</span>
      {onCancel ? <button type="button" className="kit-link quiet" onClick={onCancel}>{cancelLabel}</button> : <span />}
    </div>
  );
}

/* ---------------- bottom sheet ---------------- */

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * A modal sheet that slides up from the bottom (centred on wide screens): focus moves into it, Tab stays inside, Escape
 * or the backdrop closes it, and focus returns to where it was.
 */
export function Sheet({ open, title, children, onClose, dismissible = true }: { open: boolean; title: string; children: ReactNode; onClose: () => void; dismissible?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box.current)?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== "Tab" || !box.current) return;
      const xs = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!xs.length) { e.preventDefault(); return; }
      const [a, z] = [xs[0], xs[xs.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [open, dismissible]);
  if (!open) return null;
  return createPortal(
    <div className="kit-sheet-back" role="presentation" onClick={(e) => { if (dismissible && e.target === e.currentTarget) closeRef.current(); }}>
      <div className="kit-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={box}>
        <span className="kit-grabber" aria-hidden="true" />
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
