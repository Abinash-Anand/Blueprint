/**
 * Which GWDG chat models answer right now? One tiny request per model (a few tokens each); the key is never printed.
 *   npx tsx --env-file=../.env eval/probe.ts [model …]
 */
const key = process.env.SAIA_API_KEY;
const base = (process.env.SAIA_BASE_URL || "https://chat-ai.academiccloud.de/v1").replace(/\/+$/, "");
if (!key) {
  console.error("SAIA_API_KEY is not set in .env.");
  process.exit(2);
}
const models = process.argv.slice(2).length ? process.argv.slice(2) : ["qwen3.5-397b-a17b", "mistral-large-4-1t-a52b", "deepseek-v4.1-flash-1017", "gemma-4-31b-it"];
for (const m of models) {
  const t = Date.now();
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: m, messages: [{ role: "user", content: "Reply with: ok" }], max_tokens: 5, temperature: 0 }),
      signal: AbortSignal.timeout(60_000),
    });
    console.log(`${m.padEnd(26)} HTTP ${r.status}  ${Date.now() - t} ms${r.ok ? "" : "  (not available right now)"}`);
  } catch (e) {
    console.log(`${m.padEnd(26)} no answer: ${(e as Error).name}`);
  }
}
