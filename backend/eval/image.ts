/**
 * Real trial of images as revision material (Revision v2 phase 4): one image file goes to the configured generation
 * provider with the material-image prompt; prints what was read and how long it took.
 *
 *   npx tsx --env-file=../.env eval/image.ts --file <photo.png|jpg|webp> [--topic "RxJS"]
 *
 * Writes one new file to eval/results (never overwrites); never touches a database or a city.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAiConfig } from "../src/modules/ai/config.js";
import { jobCaller } from "../src/modules/ai/jobCaller.js";
import { createProviders } from "../src/modules/ai/providers/factory.js";
import type { UsageService } from "../src/modules/ai/usage.js";
import { IMAGE_PROMPT_VERSION, IMAGE_SCHEMA, imagePrompt, imageReply, imageType } from "../src/modules/revision/imageText.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const file = arg("file");
if (!file) throw new Error("--file is required");
const topic = arg("topic") ?? "Revision";

const data = readFileSync(file);
const mimeType = imageType(data);
if (!mimeType) throw new Error("Not a PNG, JPEG or WebP image");
const config = loadAiConfig({ ...process.env, AI_ENABLED: "true" });
const providers = createProviders(config);
if (!providers.generation?.images) throw new Error(`The generation provider (${providers.generation?.name ?? "none"}) does not read images`);
const usage = { record: async () => {}, check: async () => {}, summary: async () => ({}) } as unknown as UsageService;
const caller = jobCaller({ config, provider: providers.generation, usage, op: "REVISION_PACK", notice: async (_s, label) => console.log(`  ${label}`) });

console.log(`Image: ${basename(file)} (${mimeType}, ${data.length} bytes)\nModel: ${providers.generation.name}:${config.generationModel} (fallback ${config.generationFallbackModel ?? "none"})\n`);
const t0 = performance.now();
let output: unknown = null;
let error: string | null = null;
try {
  output = await caller.call({ name: "material_image", label: "read image" }, imagePrompt(topic, basename(file)), IMAGE_SCHEMA, 6000, [{ mimeType, data }]);
} catch (e) {
  error = (e as Error).message;
}
const seconds = Math.round((performance.now() - t0) / 100) / 10;
const text = output ? imageReply(output) : null;
console.log(error ? `Failed after ${seconds} s: ${error}` : `Read in ${seconds} s with ${caller.used().join(" + ")}:\n\n${text ?? "(nothing readable)"}\n`);

const out = join(dirname(fileURLToPath(import.meta.url)), "results", `image-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ file: basename(file), mimeType, bytes: data.length, promptVersion: IMAGE_PROMPT_VERSION, models: caller.used(), seconds, error, text, output }, null, 2), { flag: "wx" });
console.log(`Saved ${out}`);
