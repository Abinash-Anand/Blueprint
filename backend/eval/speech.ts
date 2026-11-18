/**
 * Speech-term test (AI design §9.2): how well the configured speech-to-text spells the curriculum's technical terms
 * in the learner's own voice, per microphone. It sends each recording with the same instruction and the same spelling
 * hints the app sends for a topic-level revision of that topic (topic name plus the topic's curriculum question and
 * criteria; sub-topic revisions send the same question plus their own prompts), then counts the terms written
 * correctly and the word error rate. Read-only apart from one new result file: no database, no app data.
 *
 *   npx tsx --env-file=../.env eval/speech.ts --dir recordings/laptop --device laptop
 *   options: --delay 7000 (free tier), --model ID, --hints none (no spelling hints: worst case)
 *
 * Gate (§9.3): curriculum term accuracy ≥ 95 % per device. Each recording is one request (12 per device).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { allTopics } from "../src/curriculum/index.js";
import { curriculumPrompts } from "../src/curriculum/prompts.js";
import { loadAiConfig } from "../src/modules/ai/config.js";
import { transcriptionInstruction, vocabulary } from "../src/modules/ai/evaluation/prompt.js";
import { createProviders } from "../src/modules/ai/providers/factory.js";
import { ProviderError } from "../src/modules/ai/providers/types.js";
import { parseWav } from "../src/modules/ai/voice/wav.js";
import { AUDIO_TYPES, termHits, wer } from "./speech-score.js";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string, d: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const dir = resolve(arg("dir", ""));
const device = arg("device", "microphone").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40); // used in the result filename
const delayMs = Number(arg("delay", "0"));
const hints = arg("hints", "unit");
const model = arg("model", "");
if (!arg("dir", "") || !existsSync(dir)) {
  console.error("Usage: eval/speech.ts --dir <folder with 01.wav … 12.wav> [--device name] [--delay ms] [--hints none]");
  process.exit(1);
}

const config = loadAiConfig({ ...process.env, AI_ENABLED: "true", ...(model ? { AI_TRANSCRIPTION_MODEL: model } : {}) });
const provider = createProviders(config).transcription;
const sentences = (JSON.parse(readFileSync(join(here, "speech-terms.json"), "utf8")) as { sentences: { id: string; topic: string; text: string; terms: string[] }[] }).sentences;
const promptOf = new Map(curriculumPrompts.map((p) => [p.topic, p]));
const topicName = new Map(allTopics().map((t) => [t.slug, t.name]));
const files = readdirSync(dir);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log(`Speech-term test: ${provider.name}:${config.transcriptionModel} · device "${device}" · hints ${hints}\n`);
const missing: string[] = [];
const rows: { id: string; transcript: string | null; found: string[]; missed: string[]; wer: number | null; error?: string; ms: number }[] = [];
for (const s of sentences) {
  // "01" must not match "012.wav".
  const file = files.find((f) => new RegExp(`^${s.id}(?!\\d)`).test(f) && AUDIO_TYPES[extname(f).toLowerCase()]);
  if (!file) {
    console.log(`${s.id}  no recording (expected ${s.id}.wav, .mp3 or .flac)`);
    missing.push(s.id);
    continue;
  }
  const audio = readFileSync(join(dir, file));
  const mimeType = AUDIO_TYPES[extname(file).toLowerCase()];
  let seconds = 0;
  if (mimeType === "audio/wav") {
    try {
      seconds = parseWav(audio).seconds;
    } catch {
      /* not 16-bit PCM: let the provider decide */
    }
  }
  const p = promptOf.get(s.topic);
  // Same as the app's unitTerms() for a topic-level unit: topic name, no sub-topic, the topic's curriculum prompt.
  const terms = hints === "none" ? [] : vocabulary([topicName.get(s.topic) ?? "", "", p?.content ?? "", p?.expected ?? ""]);
  if (delayMs) await sleep(delayMs);
  const t0 = performance.now();
  try {
    const r = await provider.transcribe({
      audio, mimeType, audioSeconds: Math.round(seconds), instruction: transcriptionInstruction(config.language, terms),
      model: config.transcriptionModel, signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
    const h = termHits(r.text, s.terms);
    const w = wer(s.text, r.text);
    rows.push({ id: s.id, transcript: r.text, ...h, wer: w, ms: performance.now() - t0 });
    console.log(`${s.id}  ${h.found.length}/${s.terms.length} terms · WER ${(w * 100).toFixed(0)} %${h.missed.length ? ` · missed: ${h.missed.join(", ")}` : ""}`);
    console.log(`    "${r.text}"`);
  } catch (e) {
    const msg = e instanceof ProviderError ? `${e.kind}: ${e.message}` : String(e);
    rows.push({ id: s.id, transcript: null, found: [], missed: [], wer: null, error: msg, ms: performance.now() - t0 });
    console.log(`${s.id}  ERROR ${msg}`);
    if (e instanceof ProviderError && e.kind === "RATE_LIMITED") {
      console.log("Stopping: the provider's quota is used up. Run again tomorrow for the remaining recordings.");
      break;
    }
  }
}

const done = rows.filter((r) => r.transcript !== null);
const total = done.reduce((n, r) => n + r.found.length + r.missed.length, 0);
const found = done.reduce((n, r) => n + r.found.length, 0);
const meanWer = done.length ? done.reduce((n, r) => n + r.wer!, 0) / done.length : 0;
const missed = done.flatMap((r) => r.missed);
const failed = rows.filter((r) => r.transcript === null);
console.log(
  `\nDevice "${device}": ${done.length} of ${sentences.length} recordings transcribed` +
    (missing.length ? ` · ${missing.length} missing (${missing.join(", ")})` : "") +
    (failed.length ? ` · ${failed.length} failed (${failed.map((r) => r.id).join(", ")}): not counted in accuracy` : ""),
);
console.log(`  ${total && found / total >= 0.95 ? "PASS" : total ? "FAIL" : "    "}  Curriculum term accuracy (gate ≥ 95 %)   ${total ? ((100 * found) / total).toFixed(1) : "n/a"} % (${found} of ${total})`);
console.log(`        Word error rate (mean)                 ${(meanWer * 100).toFixed(1)} %`);
if (missed.length) console.log(`        Missed terms                           ${missed.join(", ")}`);

const out = join(here, "results");
mkdirSync(out, { recursive: true });
const path = join(out, `speech-${device}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(path, JSON.stringify({ provider: provider.name, model: config.transcriptionModel, device, hints, rows }, null, 2));
console.log(`\nSaved ${path}`);
