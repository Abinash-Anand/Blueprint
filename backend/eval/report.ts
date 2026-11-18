/**
 * Re-report saved benchmark results without calling the provider again, merging every saved file per model.
 * Read-only: it never writes, deletes or overwrites anything in eval/results.
 *   npx tsx eval/report.ts                 (all models in eval/results)
 *   npx tsx eval/report.ts gemini-3.8-flash
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Case, type CaseResult, gates, printGates, runKind } from "./gates.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "results");
const wanted = process.argv[2];
const current = (JSON.parse(readFileSync(join(here, "cases.json"), "utf8")) as { cases: Case[] }).cases;
const byModel = new Map<string, Map<string, CaseResult>>();
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("speech-")).sort()) {
  const d = JSON.parse(readFileSync(join(dir, f), "utf8")) as { provider: string; model: string; results?: CaseResult[] };
  if (!d.results || d.provider === "fake" || (wanted && d.model !== wanted)) continue;
  const m = byModel.get(d.model) ?? new Map<string, CaseResult>();
  for (const r of d.results) {
    const prev = m.get(r.c.id);
    m.set(r.c.id, { c: r.c, runs: [...(prev?.runs ?? []), ...r.runs] });
  }
  byModel.set(d.model, m);
}
if (byModel.size === 0) console.log("No saved results" + (wanted ? ` for ${wanted}` : "") + ".");
for (const [model, m] of byModel) {
  const results = [...m.values()];
  console.log(`\n=== ${model}`);
  for (const r of results) {
    if (r.runs.every((x) => runKind(x) === "SKIPPED")) continue;
    const s = r.runs.map((x) => (x.score !== null ? String(x.score) : runKind(x) === "SKIPPED" ? "-" : runKind(x)!)).join(" ");
    console.log(`  ${r.c.id.padEnd(20)} expect ${r.c.expect.join("–").padEnd(4)} got ${s}`);
  }
  printGates(`Release gates for ${model} (merged from saved runs)`, gates(results));
  // Tested = the model judged it at least once (an answer or invalid output); outages and quota refusals do not count.
  const tested = new Set(results.filter((r) => r.runs.some((x) => x.score !== null || runKind(x) === "MODEL_INVALID")).map((r) => r.c.id));
  const untested = current.filter((c) => !tested.has(c.id));
  const byTopic = new Map<string, number>();
  for (const c of untested) byTopic.set(c.topic, (byTopic.get(c.topic) ?? 0) + 1);
  console.log(`\n  Untested: ${untested.length} of ${current.length} cases in the current set` + (untested.length ? ` (${[...byTopic].map(([t, n]) => `${t} ${n}`).join(", ")})` : ""));
  const stale = results.filter((r) => !current.some((c) => c.id === r.c.id && c.answer === r.c.answer && c.expect.join() === r.c.expect.join()));
  if (stale.length) console.log(`  Note: ${stale.length} saved case(s) differ from the current cases.json (edited or removed): ${stale.map((r) => r.c.id).join(", ")}`);
}
