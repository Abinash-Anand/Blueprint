/** A Run button for a code answer and what it printed (Revision v2 phase 4). The code runs only in this browser's sandbox. */
import { useState } from "react";
import { type RunResult, runCode } from "../../lib/sandbox";

export function CodeRun({ code, label = "Run", what = "your code" }: { code: string; label?: string; what?: string }) {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<RunResult | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      setR(await runCode(code));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ws-run">
      <button type="button" className="btn" disabled={busy || !code.trim()} aria-busy={busy} onClick={() => void run()} aria-label={`${label}: ${what}`}>
        {busy ? "Running…" : `▶ ${label}`}
      </button>
      {!r && !busy && <span className="m">JavaScript or TypeScript, in a sandbox in your browser: no network, nothing is sent.</span>}
      {r && (
        <div className="ws-out" role="status" aria-label={`Output of ${what}`}>
          {r.lines.length === 0 && !r.error && !r.timedOut && <p className="m">No output. Use console.log to print something.</p>}
          {r.lines.length > 0 && (
            <pre><code>{r.lines.map((l, i) => <span key={i} className={l.kind === "error" || l.kind === "warn" ? `ws-out-${l.kind}` : undefined}>{l.text}{"\n"}</span>)}</code></pre>
          )}
          {r.error && <p className="ws-out-error">{r.error}</p>}
          {r.truncated && <p className="m">Output cut off after 200 lines.</p>}
          {r.timedOut && <p className="m">Stopped after 5 seconds: something kept running (a loop or a timer that never ends).</p>}
        </div>
      )}
    </div>
  );
}
