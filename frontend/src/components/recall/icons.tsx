/** Small stroke icons for the glass screens (no icon library: DESIGN.md §8). Decorative; the text beside them carries the meaning. */
import type { ReactNode } from "react";

const Svg = ({ size = 16, width = 2, children }: { size?: number; width?: number; children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export const Chevron = () => <span className="g-chev"><Svg><path d="M9 6l6 6-6 6" /></Svg></span>;
export const ChevronDown = () => <span className="g-chev"><Svg><path d="M6 9l6 6 6-6" /></Svg></span>;
export const Back = () => <Svg size={16}><path d="M15 6l-6 6 6 6" /></Svg>;
export const Close = () => <Svg size={14} width={2.4}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
export const Plus = () => <Svg size={15}><path d="M12 5v14M5 12h14" /></Svg>;
export const More = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
);

/** A status glyph in a tinted circle: remembered, partly, missed, recalled when asked. */
export function Glyph({ kind }: { kind: "ok" | "part" | "miss" | "up" | "info" | "dot" | "warn" }) {
  const tone = kind === "up" ? "info" : kind === "dot" ? "neutral" : kind === "warn" ? "miss" : kind;
  return (
    <span className={`g-gly ${tone}`}>
      <Svg size={14} width={2.6}>
        {kind === "ok" && <path d="M5 12l5 5L19 7" />}
        {kind === "part" && <path d="M6 12h12" />}
        {kind === "miss" && <path d="M7 7l10 10M17 7L7 17" />}
        {kind === "up" && <path d="M12 19V5M6 11l6-6 6 6" />}
        {kind === "info" && <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />}
        {kind === "dot" && <circle cx="12" cy="12" r="3" />}
        {kind === "warn" && <path d="M12 7v6M12 17h.01" />}
      </Svg>
    </span>
  );
}

export const Person = () => (
  <span className="g-gly info" style={{ width: 22, height: 22 }}><Svg size={12} width={2.2}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></Svg></span>
);
export const Target = () => <span className="g-gly info"><Svg size={14} width={2.4}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></Svg></span>;
export const Spark = () => (
  <span className="g-gly info" style={{ width: 44, height: 44 }}>
    <Svg size={22} width={1.8}><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></Svg>
  </span>
);
export const Picture = () => (
  <span className="g-gly info" style={{ width: 40, height: 40, borderRadius: 10 }}><Svg size={18} width={1.8}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 15l5-4 4 3 3-2 6 4" /></Svg></span>
);
