/**
 * Re-report saved benchmark results without calling the provider again, merging every saved file per model.
 *   npx tsx eval/report.ts                 (all models in eval/results)
 *   npx tsx eval/report.ts gemini-3.8-flash
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CaseResult, gates, printGates } from "./gates.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "results");
const wanted = process.argv[2];
const byModel = new Map<string, Map<string, CaseResult>>();
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const d = JSON.parse(readFileSync(join(dir, f), "utf8")) as { provider: string; model: string; results: CaseResult[] };
  if (d.provider === "fake" || (wanted && d.model !== wanted)) continue;
  const m = byModel.get(d.model) ?? new Map<string, CaseResult>();
  for (const r of d.results) {
    const prev = m.get(r.c.id);
    m.set(r.c.id, { c: r.c, runs: [...(prev?.runs ?? []), ...r.runs] });
  }
  byModel.set(d.model, m);
}
for (const [model, m] of byModel) {
  const results = [...m.values()];
  console.log(`\n=== ${model}`);
  for (const r of results) {
    const s = r.runs.map((x) => (x.score === null ? (x.error?.startsWith("skipped") ? "-" : "ERR") : String(x.score))).join(" ");
    if (r.runs.some((x) => x.score !== null || !x.error?.startsWith("skipped"))) console.log(`  ${r.c.id.padEnd(20)} expect ${r.c.expect.join("–").padEnd(4)} got ${s}`);
  }
  printGates(`Release gates for ${model} (merged from saved runs)`, gates(results));
}
