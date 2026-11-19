/** GWDG Academic Cloud adapter (AI design §10.2) against a mocked SAIA API: no network, no key needed. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAiConfig } from "../../src/modules/ai/config.js";
import { createProviders } from "../../src/modules/ai/providers/factory.js";
import { extractJson, gwdgProvider } from "../../src/modules/ai/providers/gwdg.js";
import { ProviderError, isProviderOutage } from "../../src/modules/ai/providers/types.js";

const opts = { apiKey: "test-key-123", chatBaseUrl: "https://chat.example/v1", audioBaseUrl: "https://audio.example/v1", disableThinking: true };
const schema = { type: "object", properties: { relevant: { type: "boolean" } }, required: ["relevant"] };
const evalInput = { system: "SYS", user: "USER", jsonSchema: schema, model: "qwen3.8-27b", signal: AbortSignal.timeout(5000) };
const reply = (content: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 30 }, ...extra }), { status: 200 });
const status = (code: number) => new Response(JSON.stringify({ error: "x" }), { status: code });

afterEach(() => vi.unstubAllGlobals());

describe("GWDG answer checking", () => {
  it("asks for schema-constrained JSON without thinking, with the key only in the header", async () => {
    const fetch = vi.fn(async () => reply('{"relevant":true}'));
    vi.stubGlobal("fetch", fetch);
    const r = await gwdgProvider(opts).evaluate(evalInput);
    expect(r).toEqual({ output: { relevant: true }, usage: { inputTokens: 120, outputTokens: 30 } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://chat.example/v1/chat/completions");
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-key-123");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "qwen3.8-27b", temperature: 0,
      messages: [{ role: "system", content: "SYS" }, { role: "user", content: "USER" }],
      response_format: { type: "json_schema", json_schema: { name: "evaluation", strict: true, schema } },
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it("steps down when the server rejects a parameter: without the thinking switch, then plain JSON with the schema in the prompt", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(status(400)).mockResolvedValueOnce(status(400)).mockResolvedValueOnce(reply('{"relevant":false}'));
    vi.stubGlobal("fetch", fetch);
    const r = await gwdgProvider(opts).evaluate(evalInput);
    expect(r.output).toEqual({ relevant: false });
    const bodies = fetch.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(bodies[1].chat_template_kwargs).toBeUndefined();
    expect(bodies[1].response_format.type).toBe("json_schema");
    expect(bodies[2].response_format).toEqual({ type: "json_object" });
    expect(bodies[2].messages[0].content).toContain(JSON.stringify(schema));
  });

  it("reads JSON out of thinking tags and code fences, and rejects anything else", async () => {
    expect(extractJson('<think>let me see</think>\n{"a":1}')).toBe('{"a":1}');
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('Sure! {"a":1} done')).toBe('{"a":1}');
    vi.stubGlobal("fetch", vi.fn(async () => reply("not json at all")));
    await expect(gwdgProvider(opts).evaluate(evalInput)).rejects.toMatchObject({ kind: "INVALID_OUTPUT" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"rel' }, finish_reason: "length" }] }), { status: 200 })));
    await expect(gwdgProvider(opts).evaluate(evalInput)).rejects.toMatchObject({ kind: "INVALID_OUTPUT" });
  });

  it("maps errors so the app reacts correctly: rate limit, outage (fallback model), setup error, no key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => status(429)));
    await expect(gwdgProvider(opts).evaluate(evalInput)).rejects.toMatchObject({ kind: "RATE_LIMITED" });
    vi.stubGlobal("fetch", vi.fn(async () => status(503)));
    const outage = await gwdgProvider(opts).evaluate(evalInput).catch((e: ProviderError) => e);
    expect(outage).toMatchObject({ kind: "PROVIDER_ERROR", status: 503 });
    expect(isProviderOutage(outage as ProviderError)).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => status(401)));
    const auth = await gwdgProvider(opts).evaluate(evalInput).catch((e: ProviderError) => e);
    expect(auth).toMatchObject({ kind: "PROVIDER_ERROR", status: 401 });
    expect(isProviderOutage(auth as ProviderError)).toBe(false);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(gwdgProvider({ ...opts, apiKey: undefined }).evaluate(evalInput)).rejects.toThrow(/SAIA_API_KEY is not set/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("GWDG transcription (Whisper)", () => {
  it("uploads the WAV with model, language and the curriculum terms as Whisper's prompt", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ text: "  Generics keep the type.  " }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const r = await gwdgProvider(opts).transcribe({
      audio: Buffer.from("RIFF....WAVE"), mimeType: "audio/wav", audioSeconds: 4, instruction: "ignored by Whisper",
      language: "en", vocabulary: ["TypeScript", "fetchJson<T>"], model: "whisper-large-v3", signal: AbortSignal.timeout(5000),
    });
    expect(r).toEqual({ text: "Generics keep the type.", usage: { audioSeconds: 4 } });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://audio.example/v1/audio/transcriptions");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3");
    expect(form.get("language")).toBe("en");
    expect(form.get("prompt")).toBe("TypeScript, fetchJson<T>");
    expect(form.get("response_format")).toBe("json");
    expect((form.get("file") as File).name).toBe("answer.wav");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-key-123");
  });
});

describe("GWDG configuration", () => {
  it("defaults to Qwen 3.8 27B and Whisper v3 with same-provider fallbacks", () => {
    const c = loadAiConfig({ AI_EVALUATION_PROVIDER: "gwdg", SAIA_API_KEY: " k " });
    expect(c).toMatchObject({
      evaluationProvider: "gwdg", transcriptionProvider: "gwdg",
      evaluationModel: "qwen3.8-27b", transcriptionModel: "whisper-large-v3",
      evaluationFallbackModel: "gemma-4-31b-it", transcriptionFallbackModel: "whisper-large-v2",
      gwdg: { apiKey: "k", chatBaseUrl: "https://chat-ai.academiccloud.de/v1", audioBaseUrl: "https://saia.gwdg.de/v1", disableThinking: true },
    });
    expect(createProviders(c).evaluation.name).toBe("gwdg");
    expect(createProviders(c).transcription.name).toBe("gwdg");
  });

  it("takes exact model ids, per-job fallbacks, other hosts and the thinking switch from the environment", () => {
    const c = loadAiConfig({
      AI_EVALUATION_PROVIDER: "gwdg", AI_EVALUATION_MODEL: "gemma-4-31b-it", AI_EVALUATION_FALLBACK_MODEL: "qwen3.8-27b",
      AI_TRANSCRIPTION_FALLBACK_MODEL: "none", SAIA_BASE_URL: "https://x.example/v1/", AI_DISABLE_THINKING: "false",
    });
    expect(c.evaluationModel).toBe("gemma-4-31b-it");
    expect(c.evaluationFallbackModel).toBe("qwen3.8-27b");
    expect(c.transcriptionFallbackModel).toBeNull();
    expect(c.gwdg.chatBaseUrl).toBe("https://x.example/v1");
    expect(c.gwdg.disableThinking).toBe(false);
  });

  it("keeps the Gemini setup unchanged", () => {
    expect(loadAiConfig({ AI_EVALUATION_PROVIDER: "gemini" })).toMatchObject({ evaluationModel: "gemini-3.8-flash", evaluationFallbackModel: "gemini-2.5-flash" });
  });
});
