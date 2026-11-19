/**
 * GWDG Academic Cloud access check (AI design §10.2). Lists the models this key can use, checks Blueprint's planned
 * ids against them, tests the Whisper endpoint with one second of silence, and shows the rate limits. One chat-free
 * request plus one short audio request; the key is never printed.
 *
 *   npx tsx --env-file=../.env eval/models.ts
 */
import { loadAiConfig } from "../src/modules/ai/config.js";

const PLANNED = {
  "answer checking": ["qwen3.8-27b", "gemma-4-31b-it"],
  "speech": ["whisper-large-v3", "whisper-large-v2"],
  "curriculum generation (later)": ["qwen3.5-397b-a17b"],
};

const c = loadAiConfig({ ...process.env, AI_EVALUATION_PROVIDER: "gwdg" }).gwdg;
if (!c.apiKey) {
  console.error("SAIA_API_KEY is not set in .env.");
  process.exit(2);
}
const auth = { authorization: `Bearer ${c.apiKey}` };
const limits = (h: Headers) =>
  [...h.entries()].filter(([k]) => /ratelimit/i.test(k)).map(([k, v]) => `${k.replace(/^x-ratelimit-/i, "")}=${v}`).join("  ") || "(no rate-limit headers)";

// 1. Models (OpenAI format: GET /models; the SAIA docs also show POST)
let ids: string[] = [];
for (const method of ["GET", "POST"]) {
  const r = await fetch(`${c.chatBaseUrl}/models`, { method, headers: auth });
  if (r.status === 401 || r.status === 403) {
    console.error(`The key was refused (HTTP ${r.status}). Check SAIA_API_KEY.`);
    process.exit(1);
  }
  if (!r.ok) continue;
  const j = (await r.json()) as { data?: { id: string }[] };
  ids = (j.data ?? []).map((m) => m.id).sort();
  console.log(`Rate limits (chat): ${limits(r.headers)}`);
  break;
}
if (!ids.length) {
  console.error("Could not read the model list.");
  process.exit(1);
}
console.log(`\n${ids.length} models available to this key:\n  ${ids.join("\n  ")}\n`);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
for (const [job, wanted] of Object.entries(PLANNED)) {
  for (const w of wanted) {
    const exact = ids.includes(w);
    const near = exact ? [] : ids.filter((id) => norm(id).includes(norm(w).slice(0, 8)));
    console.log(`${exact ? "OK  " : "MISS"} ${job.padEnd(30)} ${w}${near.length ? `   → similar: ${near.join(", ")}` : ""}`);
  }
}

// 2. Whisper: one second of 16 kHz silence (a valid 16-bit PCM WAV).
const samples = 16_000;
const wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(36 + samples * 2, 4); wav.write("WAVE", 8); wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16_000, 24);
wav.writeUInt32LE(32_000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
const form = new FormData();
form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "silence.wav");
form.append("model", "whisper-large-v3");
const a = await fetch(`${c.audioBaseUrl}/audio/transcriptions`, { method: "POST", headers: auth, body: form });
console.log(`\nWhisper (${c.audioBaseUrl}): HTTP ${a.status} ${a.ok ? "→ speech recognition is available to this key" : "→ NOT available (or a different model id)"}`);
console.log(`Rate limits (audio): ${limits(a.headers)}`);
