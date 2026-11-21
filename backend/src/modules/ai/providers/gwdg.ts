/**
 * GWDG Academic Cloud adapter (SAIA API, OpenAI-compatible; AI design §10.2). One API key, two hosts:
 *  - chat:  POST {chatBase}/chat/completions        answer checking (and later curriculum generation)
 *  - audio: POST {audioBase}/audio/transcriptions   Whisper speech-to-text (multipart upload)
 *
 * GWDG states that prompts and messages to its self-hosted models are never stored. Like every adapter, this one
 * returns unknown output: the schema, quote check and score rules in Blueprint decide what is accepted.
 */
import type { EvaluateInput, EvaluationProvider, GenerateInput, GenerationProvider, ProviderUsage, TranscribeInput, TranscriptionProvider } from "./types.js";
import { ProviderError, asProviderError } from "./types.js";

export interface GwdgOptions {
  apiKey?: string;
  chatBaseUrl: string;
  audioBaseUrl: string;
  /** Ask reasoning models (Qwen 3.x) to answer without a thinking phase, for speed. Ignored where unsupported. */
  disableThinking: boolean;
}

interface ChatResponse {
  choices?: { message?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Reasoning models may wrap their thinking in <think>…</think> or fence the JSON; keep only the JSON text. */
export function extractJson(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = fence[1].trim();
  if (!t.startsWith("{")) {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
  }
  return t;
}

export function gwdgProvider(o: GwdgOptions): TranscriptionProvider & EvaluationProvider & GenerationProvider {
  async function send(url: string, init: RequestInit): Promise<Response> {
    if (!o.apiKey) throw new ProviderError("PROVIDER_ERROR", "SAIA_API_KEY is not set");
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${o.apiKey}` } });
    } catch (e) {
      throw asProviderError(e);
    }
    if (res.status === 429) throw Object.assign(new ProviderError("RATE_LIMITED", "The Academic Cloud rate limit is reached for now"), { status: 429 });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw Object.assign(new ProviderError("PROVIDER_ERROR", `Academic Cloud returned ${res.status}`), { status: res.status, detail: detail.slice(0, 500) });
    }
    return res;
  }

  async function chat(body: Record<string, unknown>, signal: AbortSignal): Promise<{ text: string; usage: ProviderUsage }> {
    const res = await send(`${o.chatBaseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    const json = (await res.json()) as ChatResponse;
    const c = json.choices?.[0];
    if (!c?.message) throw new ProviderError("INVALID_OUTPUT", "Academic Cloud returned no answer");
    if (c.finish_reason === "length") throw new ProviderError("INVALID_OUTPUT", "Academic Cloud stopped early (length)");
    return { text: c.message.content ?? "", usage: { inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens } };
  }

  const isRejected = (e: unknown) => e instanceof ProviderError && (e as { status?: number }).status === 400;

  /**
   * Schema-constrained JSON. Strongest form first; servers that reject a parameter (400) get the next, simpler form,
   * the last one putting the schema into the prompt. Every form is validated the same way afterwards.
   */
  async function structured(i: EvaluateInput & { images?: GenerateInput["images"] }, name: string, maxTokens: number, temperature: number) {
    // Images go with the user message as data URIs (OpenAI-compatible vision input); they are not stored by GWDG.
    const user = i.images?.length
      ? [{ type: "text", text: i.user }, ...i.images.map((x) => ({ type: "image_url", image_url: { url: `data:${x.mimeType};base64,${x.data.toString("base64")}` } }))]
      : i.user;
    const messages = [{ role: "system", content: i.system }, { role: "user", content: user }];
    const base: Record<string, unknown> = { model: i.model, messages, temperature, max_tokens: maxTokens };
    const noThink = o.disableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {};
    const format = { type: "json_schema", json_schema: { name, strict: true, schema: i.jsonSchema } };
    const attempts: Record<string, unknown>[] = [
      { ...base, ...noThink, response_format: format },
      { ...base, response_format: format },
      {
        ...base,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: `${i.system}\n\nAnswer with one JSON object that matches this JSON Schema exactly:\n${JSON.stringify(i.jsonSchema)}` }, messages[1]],
      },
    ];
    let r: { text: string; usage: ProviderUsage } | null = null;
    for (const [n, body] of attempts.entries()) {
      try {
        r = await chat(body, i.signal);
        break;
      } catch (e) {
        if (!isRejected(e) || n === attempts.length - 1) throw e;
      }
    }
    try {
      return { output: JSON.parse(extractJson(r!.text)) as unknown, usage: r!.usage };
    } catch {
      throw new ProviderError("INVALID_OUTPUT", "Academic Cloud did not return JSON");
    }
  }

  return {
    name: "gwdg",
    /** Qwen 3.5 397B and Mistral Large 4 (main and fallback) both read images. */
    images: true,

    evaluate: (i: EvaluateInput) => structured(i, "evaluation", 4096, 0),

    /** A little temperature: a curriculum is a design, not a judgement. */
    generate: (i: GenerateInput) => structured(i, i.name, i.maxTokens, i.temperature ?? 0.3),

    async transcribe(i: TranscribeInput) {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(i.audio)], { type: i.mimeType }), "answer.wav");
      form.append("model", i.model);
      form.append("response_format", "json");
      form.append("temperature", "0");
      if (i.language) form.append("language", i.language);
      // Whisper's prompt is context, not an instruction: a short list of the terms to spell (it reads ~224 tokens).
      if (i.vocabulary?.length) form.append("prompt", i.vocabulary.join(", ").slice(0, 600));
      const res = await send(`${o.audioBaseUrl}/audio/transcriptions`, { method: "POST", body: form, signal: i.signal });
      const json = (await res.json()) as { text?: string };
      if (typeof json.text !== "string") throw new ProviderError("INVALID_OUTPUT", "Academic Cloud returned no transcript");
      return { text: json.text.trim(), usage: { audioSeconds: i.audioSeconds } };
    },
  };
}
