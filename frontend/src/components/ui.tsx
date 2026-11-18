import type { ReactNode } from "react";

export function Bar({ value, color, className = "bar" }: { value: number; color?: string; className?: string }) {
  const w = `${Math.max(0, Math.min(1, value)) * 100}%`;
  return (
    <div className={className} role="presentation">
      <i style={{ width: w, background: color }} />
    </div>
  );
}

export function Stat({ label, value, unit, detail }: { label: string; value: ReactNode; unit?: string; detail?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="kick">{label}</div>
      <div className="v">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {detail && <div className="d">{detail}</div>}
    </div>
  );
}

export function Loading({ text = "Loading…" }: { text?: string }) {
  return <div className="loading">{text}</div>;
}
