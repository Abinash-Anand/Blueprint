/**
 * Curriculum generation trial (AI design §10.3): runs the real pipeline against the configured provider for a sample
 * learner and reports time per stage, whether the result passes the contract, and its shape. Writes one new file to
 * eval/results; never touches a database or a city.
 *
 *   npx tsx --env-file=../.env eval/generate.ts            (sample: German for everyday conversation)
 *   npx tsx --env-file=../.env eval/generate.ts --sample cloud
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAiConfig } from "../src/modules/ai/config.js";
import { type GenerationRequest, generateCurriculum } from "../src/modules/ai/curriculum/generator.js";
import { createProviders } from "../src/modules/ai/providers/factory.js";
import { validateCurriculum } from "../src/modules/cities/contract.js";

const SAMPLES: Record<string, Omit<GenerationRequest, "today">> = {
  german: {
    name: "German City", goal: "Hold everyday conversations in German (B1)", description: "Speaking and listening first, grammar as needed.", category: "Language",
    requirements: { outcome: "Talk with colleagues and neighbours without switching to English", currentLevel: "BEGINNER", targetLevel: "WORKING", subjects: ["Grammar", "Vocabulary", "Listening", "Speaking"], prerequisites: ["Basic greetings"] },
    constraints: { hoursPerDay: 1, daysPerWeek: 6, pace: "STEADY", startDate: "2026-11-23", targetDate: "2027-05-31", timezone: "Europe/Berlin" },
    language: "en",
  },
  cloud: {
    name: "Cloud City", goal: "Deploy and operate a web app on a cloud platform", description: "", category: "Software",
    requirements: { outcome: "Ship a containerised app with CI/CD, monitoring and infrastructure as code", currentLevel: "INTERMEDIATE", targetLevel: "PROFESSIONAL", subjects: ["Docker", "Kubernetes", "Terraform", "CI/CD", "Observability"], prerequisites: ["Linux basics", "Node.js"] },
    constraints: { hoursPerDay: 2, daysPerWeek: 5, pace: "INTENSIVE", startDate: "2026-11-23", targetDate: "2027-03-31", timezone: "Europe/Berlin" },
    language: "en",
  },
};

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const sample = arg("sample", "german");
const config = loadAiConfig({ ...process.env, AI_ENABLED: "true" });
const provider = createProviders(config).generation;
if (!provider || !SAMPLES[sample]) {
  console.error(provider ? `Unknown sample: ${sample}` : "No generation provider configured.");
  process.exit(2);
}
const req: GenerationRequest = { ...SAMPLES[sample], today: new Date().toISOString().slice(0, 10) };
console.log(`Generation trial: ${provider.name}:${config.generationModel} · sample "${sample}"\n`);

const calls: { stage: string; seconds: number; ok: boolean; tokens?: number }[] = [];
const t0 = performance.now();
let doc;
try {
  doc = await generateCurriculum(
    req,
    async (stage, prompt, jsonSchema, maxTokens) => {
      const s = performance.now();
      try {
        const r = await provider.generate({ ...prompt, jsonSchema, model: config.generationModel, name: stage.name, maxTokens, signal: AbortSignal.timeout(config.generationTimeoutMs) });
        calls.push({ stage: stage.label, seconds: (performance.now() - s) / 1000, ok: true, tokens: r.usage.outputTokens });
        return r.output;
      } catch (e) {
        calls.push({ stage: stage.label, seconds: (performance.now() - s) / 1000, ok: false });
        throw e;
      }
    },
    async (p) => console.log(`  … ${p.label}`),
  );
} catch (e) {
  console.error(`\nFAILED: ${(e as Error).message}`);
}
const total = (performance.now() - t0) / 1000;
console.log("\nCalls:");
for (const c of calls) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.stage.padEnd(14)} ${c.seconds.toFixed(1)} s${c.tokens ? ` · ${c.tokens} tokens` : ""}`);
console.log(`Total ${Math.round(total)} s`);

if (doc) {
  const v = validateCurriculum(doc);
  const all = doc.districts.flatMap((d) => d.topics);
  console.log(`\nContract: ${v.ok ? "PASS" : "FAIL"}`);
  console.log(`"${doc.title}": ${doc.districts.length} districts, ${all.length} topics (${all.filter((t) => t.priority === "CORE").length} core), ${all.reduce((a, t) => a + t.hours, 0)} h, ${doc.journey.start} → ${doc.journey.end}`);
  for (const d of doc.districts) console.log(`  ${d.name}: ${d.topics.map((t) => `${t.name} (${t.hours} h${t.priority === "OPTIONAL" ? ", optional" : ""})`).join(" · ")}`);
  const t = all[0];
  console.log(`\nExample topic "${t.name}":\n  ${t.description}\n  Floors: ${t.subtopics.join(" | ")}\n  Exercise: ${t.exercise}\n  Question: ${t.prompts[0]?.content}\n  Expected: ${t.prompts[0]?.expected}`);
}
const out = join(dirname(fileURLToPath(import.meta.url)), "results");
mkdirSync(out, { recursive: true });
const path = join(out, `gen-${sample}-${config.generationModel.replace(/[^A-Za-z0-9._-]/g, "_")}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(path, JSON.stringify({ provider: provider.name, model: config.generationModel, sample, calls, totalSeconds: total, document: doc ?? null }, null, 2));
console.log(`\nSaved ${path}`);
