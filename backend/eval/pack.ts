/**
 * Revision pack trial (Revision v2 plan §5, §12): builds a whole pack from sample material with the real generation
 * model, runs every check in code, and looks for questions that leave the material: each sample names related terms
 * that are deliberately NOT in its material, and any question, option or answer using one is reported.
 * Writes one new file to eval/results (never overwrites); never touches a database or a city.
 *
 *   npx tsx --env-file=../.env eval/pack.ts --sample rxjs      (Markdown notes on RxJS basics)
 *   npx tsx --env-file=../.env eval/pack.ts --sample german    (a German grammar sheet as a Word file)
 *   npx tsx --env-file=../.env eval/pack.ts --sample outline   (no material: from the topic outline)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAiConfig } from "../src/modules/ai/config.js";
import { jobCaller } from "../src/modules/ai/jobCaller.js";
import { createProviders } from "../src/modules/ai/providers/factory.js";
import type { UsageService } from "../src/modules/ai/usage.js";
import { extractMaterial, materialText } from "../src/modules/revision/material.js";
import { type PackRequest, buildPack, itemProblems, levelGroups, missingLevels } from "../src/modules/revision/pack.js";
import { docxWithParagraphs } from "../tests/helpers/docx.js";

const RXJS = `# RxJS basics (my notes, week 3)

## Observables
An Observable is a lazy stream of values. Nothing happens until you subscribe.
It can call next (a value), error (fails, stream ends) and complete (finished, stream ends). After error or complete, no more values.

## Subscribing and unsubscribing
subscribe() returns a Subscription. Call unsubscribe() to stop, e.g. in ngOnDestroy, or the component keeps listening after it is gone (memory leak).
The async pipe in a template subscribes and unsubscribes for you.

## Observables vs promises
A promise is eager, gives one value and cannot be cancelled. An Observable is lazy, can give many values and can be cancelled by unsubscribing.

## Cold vs hot
Cold: each subscriber gets its own run of the producer. Two subscribers to one HttpClient.get() observable make two HTTP requests.
Hot: subscribers share one producer, like mouse clicks; late subscribers miss earlier values.

## Subject and BehaviorSubject
A Subject is an Observable you can push values into with next(); it multicasts to all current subscribers.
A BehaviorSubject needs an initial value and gives the latest value to every new subscriber at once. Good for "current user" state.

## Operators I used
map transforms each value. filter lets through only values that pass a test. Operators go inside pipe().`;
const RXJS_OUTSIDE = ["switchMap", "mergeMap", "concatMap", "exhaustMap", "ReplaySubject", "AsyncSubject", "shareReplay", "debounceTime", "combineLatest", "forkJoin", "takeUntil"];

const GERMAN = [
  "Deutsche Grammatik: Akkusativ und Dativ (my sheet, A2)",
  "Articles in the accusative: der becomes den (masculine only). die, das and die (plural) stay the same. Ich sehe den Hund.",
  "Articles in the dative: der → dem, die → der, das → dem, plural die → den, and plural nouns add -n: mit den Kindern.",
  "Verbs with the dative: helfen, danken, gefallen, gehören. Ich helfe dem Mann. Das Buch gehört der Frau.",
  "Prepositions always with the accusative: durch, für, gegen, ohne, um. Prepositions always with the dative: aus, bei, mit, nach, seit, von, zu.",
  "Two-way prepositions (in, an, auf, über, unter, vor, hinter, neben, zwischen): accusative for a movement to a place (Wohin? Ich lege das Buch auf den Tisch), dative for a position (Wo? Das Buch liegt auf dem Tisch).",
  "Personal pronouns: ich – mich – mir, du – dich – dir, er – ihn – ihm, sie – sie – ihr, wir – uns – uns.",
];
const GERMAN_OUTSIDE = ["Genitiv", "genitive", "Konjunktiv", "subjunctive", "Passiv", "passive voice", "Relativsatz", "relative clause", "Plusquamperfekt", "wegen", "trotz", "während"];

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const sample = arg("sample", "rxjs");
const config = loadAiConfig({ ...process.env, AI_ENABLED: "true" });
const providers = createProviders(config);
if (!providers.generation) throw new Error("No generation provider configured");

const SAMPLES = {
  rxjs: {
    topic: { name: "RxJS", description: "Reactive programming with observables in Angular", district: "Frontend" },
    subtopics: [{ name: "Observables and subscriptions", learned: true }, { name: "Subjects", learned: true }, { name: "Higher-order operators", learned: false }],
    files: async () => [{ name: "rxjs-notes.md", ...(await extractMaterial(Buffer.from(RXJS), "text/markdown")) }],
    outside: RXJS_OUTSIDE,
  },
  german: {
    topic: { name: "Akkusativ und Dativ", description: "Cases after verbs and prepositions", district: "Grammar" },
    subtopics: [{ name: "Articles in the accusative and dative", learned: true }, { name: "Prepositions", learned: true }, { name: "Genitive", learned: false }],
    files: async () => [{ name: "grammatik.docx", ...(await extractMaterial(docxWithParagraphs(GERMAN), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")) }],
    outside: GERMAN_OUTSIDE,
  },
  outline: {
    topic: { name: "Docker basics", description: "Images, containers, volumes and Compose for local development", district: "DevOps" },
    subtopics: [{ name: "Images and containers", learned: true }, { name: "Volumes", learned: true }, { name: "Docker Compose", learned: false }],
    files: async () => [],
    outside: ["Kubernetes", "Swarm", "Helm"],
  },
} as const;
const s = SAMPLES[sample as keyof typeof SAMPLES];
if (!s) throw new Error(`Unknown sample ${sample}`);

const files = await s.files();
const req: PackRequest = { topic: { ...s.topic }, subtopics: s.subtopics.map((x) => ({ ...x })), material: materialText(files), language: "en" };
const usage = { record: async () => {}, check: async () => {}, summary: async () => ({}) } as unknown as UsageService;
const calls: { stage: string; seconds: number }[] = [];
const caller = jobCaller({ config, provider: providers.generation, usage, op: "REVISION_PACK", notice: async (_s, label) => console.log(`  … ${label}`) });
const timed = async (stage: { name: string; label: string }, prompt: { system: string; user: string }, schema: Record<string, unknown>, maxTokens: number) => {
  const t0 = performance.now();
  try {
    return await caller.call(stage, prompt, schema, maxTokens);
  } finally {
    calls.push({ stage: stage.label, seconds: Math.round((performance.now() - t0) / 100) / 10 });
  }
};

console.log(`Sample "${sample}": ${files.map((f) => `${f.name} (${f.text.length} characters)`).join(", ") || "no material, topic outline only"}`);
console.log(`Model: ${providers.generation.name}:${config.generationModel} (fallback ${config.generationFallbackModel ?? "none"})\n`);
const t0 = performance.now();
const rejected: { concept: string; levels: number[]; problems: string[] }[] = [];
const built = await buildPack(req, timed, async (p) => console.log(`  ${p.label}`), config.generationConcurrency, (concept, lv, problems) => rejected.push({ concept, levels: lv, problems }));
const seconds = Math.round((performance.now() - t0) / 1000);

const levels = levelGroups(req.material ? "MATERIAL" : "OUTLINE").flat();
const outside: { concept: string; level: number; kind: string; term: string; where: string }[] = [];
const recheck: string[] = [];
for (const c of built) {
  for (const it of c.items) {
    recheck.push(...itemProblems(it, req.language, levels));
    const text = [it.situation, it.code ?? "", it.question, it.modelAnswer, ...(it.options ?? []).map((o) => `${o.text} ${o.explanation}`)].join("\n").toLowerCase();
    for (const term of s.outside) if (text.includes(term.toLowerCase())) outside.push({ concept: c.title, level: it.level, kind: it.kind, term, where: it.question.slice(0, 90) });
  }
}

console.log(`\nBuilt in ${seconds} s with ${calls.length} calls (${caller.used().join(" + ")})\n`);
for (const c of built) {
  const lv = [...new Set(c.items.map((i) => i.level))].sort();
  console.log(`• ${c.title}${c.subtopic ? `  [${c.subtopic}]` : ""} · ${c.items.length} questions · levels ${lv.join(",")}${c.complete ? "" : ` · INCOMPLETE: ${missingLevels(c.items, levels).join("; ")}`}`);
  console.log(`  ${c.summary}`);
  for (const it of c.items.slice(0, 4)) console.log(`    L${it.level} ${it.kind}: ${it.question}`);
}
const items = built.reduce((a, c) => a + c.items.length, 0);
console.log(`\n${built.length} concepts, ${items} questions, ${built.filter((c) => !c.complete).length} incomplete concepts`);
console.log(`Checks in code on the stored questions: ${recheck.length ? recheck.length + " problems" : "all pass"}`);
const reasons = new Map<string, number>();
for (const r of rejected) for (const x of r.problems) {
  const key = x.replace(/^[A-Z_]+ at level \d+ \("[^"]*"\): /, "").replace(/^[A-Z_]+ at level \d+: /, "").replace(/"[^"]+"/g, "…").replace(/\d+/g, "n");
  reasons.set(key, (reasons.get(key) ?? 0) + 1);
}
console.log(`Rejected in the replies (then repaired or dropped): ${reasons.size ? "" : "none"}`);
for (const [k, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${n}× ${k}`);
console.log(`Terms outside the material: ${outside.length ? outside.map((o) => `${o.term} (L${o.level} ${o.kind}: "${o.where}")`).join("\n  ") : "none"}`);

const out = join(dirname(fileURLToPath(import.meta.url)), "results", `pack-${sample}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({
  sample, at: new Date().toISOString(), provider: providers.generation.name, models: caller.used(), seconds, calls,
  material: files.map((f) => ({ name: f.name, chars: f.text.length })), concepts: built, checks: { problems: recheck, outside, rejected },
}, null, 2), { flag: "wx" });
console.log(`\nSaved ${out}`);
