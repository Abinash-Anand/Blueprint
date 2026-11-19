/**
 * City creation trial (AI design §10.4): reads a sample goal (and plan) with the real understanding model, prints
 * "Here's what I understood", and with --generate builds the whole curriculum from it with the generation model.
 * Writes one new file to eval/results; never touches a database or a city.
 *
 *   npx tsx --env-file=../.env eval/intake.ts                       (German goal, no plan)
 *   npx tsx --env-file=../.env eval/intake.ts --sample plan         (German goal + a 4-phase plan as a PDF)
 *   npx tsx --env-file=../.env eval/intake.ts --sample plan --generate
 *   npx tsx --env-file=../.env eval/intake.ts --goal "Pass the AWS Solutions Architect exam…"
 *   npx tsx --env-file=../.env eval/intake.ts --audio goal.wav     (16-bit PCM WAV: transcribed first, as dictation)
 */
import { readFileSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAiConfig } from "../src/modules/ai/config.js";
import { type GenerationRequest, generateCurriculum } from "../src/modules/ai/curriculum/generator.js";
import { Understanding, extractAttachment, planText, understandPrompt, understandingJsonSchema } from "../src/modules/ai/curriculum/intake.js";
import { createProviders } from "../src/modules/ai/providers/factory.js";
import { validateCurriculum } from "../src/modules/cities/contract.js";
import { pdfWithText } from "../tests/helpers/pdf.js";

const DEFAULT_GOAL = "I want to reach German C1 so I can work as a software developer in Germany. I'm around A2 now: I can introduce myself and order food, but I freeze in real conversations. I like learning with podcasts and I can study about an hour on weekday evenings.";
const PLAN = [
  "My German plan (12 months)",
  "Phase 1: Months 1-3, grammar foundations: cases, verb position, perfect tense. Anki every day.",
  "Phase 2: Months 4-6, listening: Easy German podcast, slow news, dictations.",
  "Phase 3: Months 7-9, speaking: weekly tandem, describing my work, small talk.",
  "Phase 4: Months 10-12, work German and Goethe C1 exam practice: emails, meetings, mock exams.",
];

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const sample = arg("sample", "goal");
const generate = process.argv.includes("--generate");
const config = loadAiConfig({ ...process.env, AI_ENABLED: "true" });
const providers = createProviders(config);

let GOAL = arg("goal", DEFAULT_GOAL);
const audioPath = arg("audio", "");
let dictation: { seconds: number; text: string } | null = null;
if (audioPath) {
  const audio = readFileSync(audioPath);
  const seconds = (audio.length - 44) / 32000;
  const t0 = performance.now();
  const r = await providers.transcription.transcribe({
    audio, mimeType: "audio/wav", audioSeconds: Math.round(seconds), language: "en", vocabulary: [], model: config.transcriptionModel,
    instruction: "Transcribe exactly what the speaker says about what they want to learn. Return only the transcript.", signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  dictation = { seconds: (performance.now() - t0) / 1000, text: r.text.trim() };
  GOAL = dictation.text;
  console.log(`Dictation: ${providers.transcription.name}:${config.transcriptionModel} · ${seconds.toFixed(1)} s of audio in ${dictation.seconds.toFixed(1)} s
  "${GOAL}"
`);
}

const files = sample === "plan" ? [{ name: "german-plan.pdf", ...(await extractAttachment(pdfWithText(PLAN), "application/pdf")) }] : [];
if (files.length) console.log(`Plan file read: ${files[0].pages} pages, ${files[0].text.length} characters\n`);
const plan = planText(files);

console.log(`Understanding: ${providers.evaluation.name}:${config.evaluationModel}`);
const t0 = performance.now();
let understood: Understanding | null = null, problem: string | null = null;
try {
  const r = await providers.evaluation.evaluate({ ...understandPrompt(GOAL, plan, "en"), jsonSchema: understandingJsonSchema(), model: config.evaluationModel, signal: AbortSignal.timeout(config.requestTimeoutMs) });
  const p = Understanding.safeParse(r.output);
  if (p.success) understood = p.data;
  else problem = p.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
} catch (e) {
  problem = (e as Error).message;
}
const understandSeconds = (performance.now() - t0) / 1000;
console.log(`  ${understandSeconds.toFixed(1)} s · ${understood ? "valid" : `INVALID: ${problem}`}`);
if (understood) {
  const u = understood;
  console.log(`\n  Name: ${u.name}   Category: ${u.category}\n  Goal: ${u.goal}\n  Level: ${u.currentLevel} → ${u.targetLevel}   Estimate: ${u.estimatedHours} h`);
  console.log(`  Districts: ${u.subjects.join(" · ")}\n  Already knows: ${u.alreadyKnown.join(", ") || "—"}\n  Resources: ${u.resources.join(", ") || "—"}`);
  console.log(`  Focus options: ${u.focusOptions.join(" / ")}\n  Plan: ${u.plan ?? "—"}${u.planMonths ? ` (${u.planMonths} months)` : ""}`);
  for (const q of u.questions) console.log(`  Question: ${q.question}  [${q.options.join(" | ")}]`);
}

let doc = null;
const calls: { stage: string; seconds: number; ok: boolean }[] = [];
if (generate && understood && providers.generation) {
  const g = providers.generation;
  const req: GenerationRequest = {
    name: understood.name, goal: understood.goal, description: "", category: understood.category,
    requirements: { brief: GOAL, understood, focus: understood.focusOptions[0], answers: understood.questions.map((q) => ({ question: q.question, answer: q.options[0] })) },
    // As the wizard does: the plan's own time span pre-fills "Finish by".
    constraints: {
      hoursPerDay: 1, weekdays: [1, 2, 3, 4, 5], pace: "STEADY", startDate: "2026-11-23", timezone: "Europe/Berlin",
      ...(understood.planMonths ? { targetDate: new Date(Date.UTC(2026, 10 + understood.planMonths, 23)).toISOString().slice(0, 10) } : {}),
    },
    plan: plan || undefined, language: "en", today: new Date().toISOString().slice(0, 10),
  };
  console.log(`\nGeneration: ${g.name}:${config.generationModel}`);
  try {
    doc = await generateCurriculum(req, async (stage, prompt, jsonSchema, maxTokens) => {
      const s = performance.now();
      try {
        const r = await g.generate({ ...prompt, jsonSchema, model: config.generationModel, name: stage.name, maxTokens, signal: AbortSignal.timeout(config.generationTimeoutMs) });
        calls.push({ stage: stage.label, seconds: (performance.now() - s) / 1000, ok: true });
        return r.output;
      } catch (e) {
        calls.push({ stage: stage.label, seconds: (performance.now() - s) / 1000, ok: false });
        throw e;
      }
    }, async (p) => console.log(`  … ${p.label}${p.districts ? `  [${p.districts.map((d) => (d.done ? "■" : "□")).join("")}]` : ""}`));
  } catch (e) {
    console.error(`  FAILED: ${(e as Error).message}`);
  }
  for (const c of calls) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.stage.padEnd(12)} ${c.seconds.toFixed(1)} s`);
  if (doc) {
    const all = doc.districts.flatMap((d) => d.topics);
    console.log(`  Contract: ${validateCurriculum(doc).ok ? "PASS" : "FAIL"} · ${doc.districts.length} districts, ${all.length} topics, ${all.reduce((a, t) => a + t.hours, 0)} h, ${doc.journey.start} → ${doc.journey.end}`);
    for (const d of doc.districts) console.log(`    ${d.name}: ${d.topics.slice(0, 4).map((t) => t.name).join(" · ")}${d.topics.length > 4 ? " …" : ""}`);
  }
}

const out = join(dirname(fileURLToPath(import.meta.url)), "results");
mkdirSync(out, { recursive: true });
const path = join(out, `intake-${audioPath ? "voice" : arg("goal", "") ? "custom" : sample}${generate ? "-gen" : ""}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(path, JSON.stringify({ goal: GOAL, dictation, understandModel: config.evaluationModel, generationModel: config.generationModel, sample, understandSeconds, understood, problem, calls, document: doc }, null, 2));
console.log(`\nSaved ${path}`);
