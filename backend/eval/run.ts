/**
 * Evaluator benchmark (AI design §9.1, §9.3). Runs the constructed test set against the configured provider and
 * reports the release gates. It calls the real provider, so it is manual and never part of `npm test`.
 *
 *   AI_EVALUATION_PROVIDER=gemini GEMINI_API_KEY=… npm run eval:ai -- --runs 5
 *   AI_EVALUATION_PROVIDER=fake npm run eval:ai            (dry run of the harness itself, no network)
 *   --delay 7000     pause between calls (free tiers allow only a few requests a minute)
 *   --model ID       override AI_EVALUATION_MODEL for this run; --only PREFIX runs matching case ids
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
import { ProviderError } from "../src/modules/ai/providers/types.js";
import { type Case, type Run, gates, printGates } from "./gates.js";


const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string, d: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const runs = Number(arg("runs", "1"));
const file = arg("cases", join(here, "cases.json"));
const only = arg("only", "");
const delayMs = Number(arg("delay", "0"));
const model = arg("model", "");

const config = loadAiConfig({ ...process.env, AI_ENABLED: "true", ...(model ? { AI_EVALUATION_MODEL: model } : {}) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let quotaExhausted = false;
const provider = createProviders(config).evaluation;
const cases = (JSON.parse(readFileSync(file, "utf8")) as { cases: Case[] }).cases.filter((c) => !only || c.id.startsWith(only));
const promptOf = new Map(curriculumPrompts.map((p) => [p.topic, p]));

async function once(c: Case): Promise<Run> {
  const p = promptOf.get(c.topic);
  if (!p) throw new Error(`No curriculum prompt for ${c.topic}`);
  const criteria = splitCriteria(p.expected);
  if (quotaExhausted) return { score: null, error: "skipped: quota exhausted", ms: 0, downgraded: 0 };
  if (delayMs) await sleep(delayMs);
  let t0 = performance.now();
  try {
    let r!: Awaited<ReturnType<typeof provider.evaluate>>;
    // Rate limits are not the evaluator's fault: back off and retry, and stop the run if the quota is gone.
    for (let attempt = 0; ; attempt++) {
      try {
        t0 = performance.now();
        r = await provider.evaluate({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({ promptText: p.content, retrievalMethod: p.method, criteria, answer: c.answer }),
      jsonSchema: evaluationJsonSchema(),
      model: config.evaluationModel,
      signal: AbortSignal.timeout(config.requestTimeoutMs),
        });
        break;
      } catch (e) {
        if (!(e instanceof ProviderError && e.kind === "RATE_LIMITED")) throw e;
        if (attempt >= 3) {
          quotaExhausted = true;
          throw e;
        }
        console.log(`  rate limited, waiting ${30 * (attempt + 1)} s…`);
        await sleep(30_000 * (attempt + 1));
      }
    }
    const parsed = EvaluationResult.parse(r.output);
    const v = verifyResult(parsed, criteria, c.answer);
    const score = suggestScore({ relevant: v.relevant, verdicts: v.criteria.map((x) => x.verdict), misconceptions: v.misconceptions.length });
    return { score, ms: performance.now() - t0, downgraded: v.downgraded };
  } catch (e) {
    return { score: null, error: e instanceof Error ? e.message.slice(0, 120) : String(e), ms: performance.now() - t0, downgraded: 0 };
  }
}


console.log(`Evaluator benchmark: ${provider.name}:${config.evaluationModel} · prompt ${config.promptVersion} · ${cases.length} cases × ${runs} runs\n`);
const results: { c: Case; runs: Run[] }[] = [];
for (const c of cases) {
  const rs: Run[] = [];
  for (let i = 0; i < runs; i++) rs.push(await once(c));
  results.push({ c, runs: rs });
  const scores = rs.map((r) => (r.score === null ? "ERR" : String(r.score))).join(" ");
  console.log(`${c.id.padEnd(20)} ${c.variant.padEnd(20)} expect ${c.expect[0] === c.expect[1] ? c.expect[0] : c.expect.join("–")}   got ${scores}${rs.some((r) => r.error) ? `   (${rs.find((r) => r.error)!.error})` : ""}`);
}

if (quotaExhausted) console.log("\nStopped early: the provider's quota ran out. Results below cover only the calls that were made.");
const gateRows = gates(results);
printGates("Release gates (AI design §9.3)", gateRows);

const out = join(here, "results");
mkdirSync(out, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const path = join(out, `${stamp}-${provider.name}-${config.evaluationModel}.json`);
writeFileSync(path, JSON.stringify({ provider: provider.name, model: config.evaluationModel, promptVersion: config.promptVersion, runs, gates: gateRows, results }, null, 2));
console.log(`\nSaved ${path}`);
