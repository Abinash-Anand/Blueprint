/**
 * A glass sheet (DESIGN.md §10): centred on wide screens, rising from the bottom on phones. Escape, the close button
 * and a click outside close it; focus moves in on open and back on close.
 */
import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Close } from "./icons";

export function Sheet({ label, labelledBy, wide, onClose, children }: {
  label?: string; labelledBy?: string; wide?: boolean; onClose: () => void; children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, []);
  return createPortal(
    <div className="g-back gl" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`g-sheet${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={label} aria-labelledby={labelledBy} tabIndex={-1} ref={box}>
        <span className="g-grab" aria-hidden="true" />
        <button type="button" className="g-x" aria-label="Close" onClick={onClose}><Close /></button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
