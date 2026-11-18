/**
 * Evaluator benchmark (AI design §9.1, §9.3). Runs the constructed test set against the configured provider and
 * reports the release gates. It calls the real provider, so it is manual and never part of `npm test`.
 *
 *   AI_EVALUATION_PROVIDER=gemini GEMINI_API_KEY=… npm run eval:ai -- --runs 5
 *   AI_EVALUATION_PROVIDER=fake npm run eval:ai            (dry run of the harness itself, no network)
 *
 * The same pure pipeline as the app: prompt builder → provider → Zod schema → quote verification → score rules.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { curriculumPrompts } from "../src/curriculum/prompts.js";
import { loadAiConfig } from "../src/modules/ai/config.js";
import { splitCriteria } from "../src/modules/ai/evaluation/criteria.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "../src/modules/ai/evaluation/prompt.js";
import { EvaluationResult, evaluationJsonSchema } from "../src/modules/ai/evaluation/schema.js";
import { suggestScore } from "../src/modules/ai/evaluation/score.js";
import { verifyResult } from "../src/modules/ai/evaluation/verify.js";
import { createProviders } from "../src/modules/ai/providers/factory.js";

interface Case { id: string; topic: string; variant: string; answer: string; expect: [number, number]; twin?: string }
interface Run { score: number | null; error?: string; ms: number; downgraded: number }

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string, d: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const runs = Number(arg("runs", "1"));
const file = arg("cases", join(here, "cases.json"));
const only = arg("only", "");

const config = loadAiConfig({ ...process.env, AI_ENABLED: "true" });
const provider = createProviders(config).evaluation;
const cases = (JSON.parse(readFileSync(file, "utf8")) as { cases: Case[] }).cases.filter((c) => !only || c.id.startsWith(only));
const promptOf = new Map(curriculumPrompts.map((p) => [p.topic, p]));

async function once(c: Case): Promise<Run> {
  const p = promptOf.get(c.topic);
  if (!p) throw new Error(`No curriculum prompt for ${c.topic}`);
  const criteria = splitCriteria(p.expected);
  const t0 = performance.now();
  try {
    const r = await provider.evaluate({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({ promptText: p.content, retrievalMethod: p.method, criteria, answer: c.answer }),
      jsonSchema: evaluationJsonSchema(),
      model: config.evaluationModel,
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
    const parsed = EvaluationResult.parse(r.output);
    const v = verifyResult(parsed, criteria, c.answer);
    const score = suggestScore({ relevant: v.relevant, verdicts: v.criteria.map((x) => x.verdict), misconceptions: v.misconceptions.length });
    return { score, ms: performance.now() - t0, downgraded: v.downgraded };
  } catch (e) {
    return { score: null, error: e instanceof Error ? e.message.slice(0, 120) : String(e), ms: performance.now() - t0, downgraded: 0 };
  }
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)} %` : "n/a");
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};
const mode = (xs: (number | null)[]) => {
  const counts = new Map<number | null, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

console.log(`Evaluator benchmark: ${provider.name}:${config.evaluationModel} · prompt ${config.promptVersion} · ${cases.length} cases × ${runs} runs\n`);
const results: { c: Case; runs: Run[] }[] = [];
for (const c of cases) {
  const rs: Run[] = [];
  for (let i = 0; i < runs; i++) rs.push(await once(c));
  results.push({ c, runs: rs });
  const scores = rs.map((r) => (r.score === null ? "ERR" : String(r.score))).join(" ");
  console.log(`${c.id.padEnd(20)} ${c.variant.padEnd(20)} expect ${c.expect[0] === c.expect[1] ? c.expect[0] : c.expect.join("–")}   got ${scores}${rs.some((r) => r.error) ? `   (${rs.find((r) => r.error)!.error})` : ""}`);
}

const all = results.flatMap((r) => r.runs.map((x) => ({ c: r.c, x })));
const ok = all.filter((a) => a.x.score !== null);
const within = (s: number, [lo, hi]: [number, number]) => s >= lo && s <= hi;
const near = (s: number, [lo, hi]: [number, number]) => s >= lo - 1 && s <= hi + 1;
const exact = ok.filter((a) => within(a.x.score!, a.c.expect)).length;
const plusMinus = ok.filter((a) => near(a.x.score!, a.c.expect)).length;
const shouldFail = ok.filter((a) => a.c.expect[1] <= 1);
const falsePass = shouldFail.filter((a) => a.x.score! >= 2).length;
const severe = ok.filter((a) => (a.c.expect[1] <= 1 && a.x.score === 3) || (a.c.expect[0] === 3 && a.x.score! <= 1)).length;
const repeatable = results.filter((r) => new Set(r.runs.map((x) => x.score)).size === 1).length;
const injections = results.filter((r) => r.c.twin);
const injectionOk = injections.filter((r) => mode(r.runs.map((x) => x.score)) === mode(results.find((t) => t.c.id === r.c.twin)?.runs.map((x) => x.score) ?? [])).length;
const latencies = ok.map((a) => a.x.ms);

const gates: [string, string, boolean | null][] = [
  ["Suggestion in the expected range", pct(exact, ok.length), null],
  ["Within ±1 (gate ≥ 95 %)", pct(plusMinus, ok.length), ok.length ? plusMinus / ok.length >= 0.95 : null],
  ["False pass: ≥ 2 where ≤ 1 expected (gate ≤ 3 %)", pct(falsePass, shouldFail.length), shouldFail.length ? falsePass / shouldFail.length <= 0.03 : null],
  ["Never 0/1 ↔ 3 (gate 0)", String(severe), severe === 0],
  ["Repeatability: identical across runs (gate ≥ 95 %)", runs > 1 ? pct(repeatable, results.length) : "use --runs 5", runs > 1 ? repeatable / results.length >= 0.95 : null],
  ["Injection cases unaffected (gate 100 %)", pct(injectionOk, injections.length), injections.length ? injectionOk === injections.length : null],
  ["Valid output after verification (gate ≥ 98 %)", pct(ok.length, all.length), all.length ? ok.length / all.length >= 0.98 : null],
  ["Evaluation latency p50 / p95", `${(quantile(latencies, 0.5) / 1000).toFixed(1)} s / ${(quantile(latencies, 0.95) / 1000).toFixed(1)} s`, null],
  ["Quotes downgraded (not found in the answer)", String(ok.reduce((s, a) => s + a.x.downgraded, 0)), null],
];
console.log("\nRelease gates (AI design §9.3)");
for (const [name, value, pass] of gates) console.log(`  ${pass === null ? "    " : pass ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${value}`);
console.log("  Not covered here: criterion-level agreement (needs per-criterion labels) and speech accuracy (§9.2 term test).");

const out = join(here, "results");
mkdirSync(out, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const path = join(out, `${stamp}-${provider.name}-${config.evaluationModel}.json`);
writeFileSync(path, JSON.stringify({ provider: provider.name, model: config.evaluationModel, promptVersion: config.promptVersion, runs, gates, results }, null, 2));
console.log(`\nSaved ${path}`);
