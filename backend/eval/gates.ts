/**
 * Release gates (AI design §9.3), computed only from calls the model actually answered or got wrong.
 * Quota refusals and skipped calls are not the evaluator's fault and are excluded; provider outages (timeouts, 5xx)
 * are reported separately as availability, not as invalid output.
 */
export interface Case { id: string; topic: string; variant: string; answer: string; expect: [number, number]; twin?: string }
export interface Run { score: number | null; error?: string; ms: number; downgraded: number }
export interface CaseResult { c: Case; runs: Run[] }

export type ErrorClass = "quota" | "availability" | "invalid";
export function classify(error: string): ErrorClass {
  if (/skipped|quota|rate limit/i.test(error)) return "quota";
  if (/in time|timed? ?out|returned 5\d\d|not available|provider returned an error/i.test(error)) return "availability";
  return "invalid";
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)} %` : "n/a");
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};
const mode = (xs: number[]) => {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

export function gates(results: CaseResult[]): [string, string, boolean | null][] {
  const all = results.flatMap((r) => r.runs.map((x) => ({ c: r.c, x })));
  const answered = all.filter((a) => a.x.score !== null);
  const errs = all.filter((a) => a.x.error).map((a) => classify(a.x.error!));
  const invalid = errs.filter((e) => e === "invalid").length;
  const availability = errs.filter((e) => e === "availability").length;
  const quota = errs.filter((e) => e === "quota").length;
  const within = (s: number, [lo, hi]: [number, number]) => s >= lo && s <= hi;
  const near = (s: number, [lo, hi]: [number, number]) => s >= lo - 1 && s <= hi + 1;
  const exact = answered.filter((a) => within(a.x.score!, a.c.expect)).length;
  const plusMinus = answered.filter((a) => near(a.x.score!, a.c.expect)).length;
  const shouldFail = answered.filter((a) => a.c.expect[1] <= 1);
  const falsePass = shouldFail.filter((a) => a.x.score! >= 2).length;
  const severe = answered.filter((a) => (a.c.expect[1] <= 1 && a.x.score === 3) || (a.c.expect[0] === 3 && a.x.score! <= 1)).length;
  const scoresOf = (r: CaseResult) => r.runs.filter((x) => x.score !== null).map((x) => x.score!);
  const multi = results.filter((r) => scoresOf(r).length >= 2);
  const repeatable = multi.filter((r) => new Set(scoresOf(r)).size === 1).length;
  const injections = results.filter((r) => {
    if (!r.c.twin || scoresOf(r).length === 0) return false;
    const twin = results.find((t) => t.c.id === r.c.twin);
    return !!twin && scoresOf(twin).length > 0;
  });
  const injectionOk = injections.filter((r) => mode(scoresOf(r)) === mode(scoresOf(results.find((t) => t.c.id === r.c.twin)!))).length;
  const latencies = answered.map((a) => a.x.ms);
  return [
    ["Answered calls (cases)", `${answered.length} of ${all.length} (${results.filter((r) => scoresOf(r).length > 0).length} cases)`, null],
    ["Suggestion in the expected range", pct(exact, answered.length), null],
    ["Within ±1 (gate ≥ 95 %)", pct(plusMinus, answered.length), answered.length ? plusMinus / answered.length >= 0.95 : null],
    ["False pass: ≥ 2 where ≤ 1 expected (gate ≤ 3 %)", `${pct(falsePass, shouldFail.length)} of ${shouldFail.length}`, shouldFail.length ? falsePass / shouldFail.length <= 0.03 : null],
    ["Never 0/1 ↔ 3 (gate 0)", String(severe), answered.length ? severe === 0 : null],
    ["Repeatability: identical across runs (gate ≥ 95 %)", multi.length ? `${pct(repeatable, multi.length)} of ${multi.length} cases` : "needs --runs ≥ 2", multi.length ? repeatable / multi.length >= 0.95 : null],
    ["Injection cases unaffected (gate 100 %)", injections.length ? `${injectionOk} of ${injections.length}` : "not run", injections.length ? injectionOk === injections.length : null],
    ["Valid output after verification (gate ≥ 98 %)", pct(answered.length, answered.length + invalid), answered.length + invalid ? answered.length / (answered.length + invalid) >= 0.98 : null],
    ["Provider outages (timeouts, 5xx), not output errors", `${availability} of ${answered.length + invalid + availability} calls`, null],
    ["Quota refusals and skipped calls (excluded)", String(quota), null],
    ["Evaluation latency p50 / p95", `${(quantile(latencies, 0.5) / 1000).toFixed(1)} s / ${(quantile(latencies, 0.95) / 1000).toFixed(1)} s`, null],
    ["Quotes downgraded (not found in the answer)", String(answered.reduce((s, a) => s + a.x.downgraded, 0)), null],
  ];
}

export function printGates(title: string, g: [string, string, boolean | null][]) {
  console.log(`\n${title}`);
  for (const [name, value, pass] of g) console.log(`  ${pass === null ? "    " : pass ? "PASS" : "FAIL"}  ${name.padEnd(54)} ${value}`);
  console.log("  Not covered here: criterion-level agreement (needs per-criterion labels) and speech accuracy (§9.2 term test).");
}
