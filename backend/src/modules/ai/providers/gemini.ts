/**
 * Gemini adapter (AI design §10.1): Gemini API `generateContent` over HTTPS with the key in a header.
 * Transcription sends the WAV recording inline; evaluation asks for JSON constrained by the schema from §6.3.
 */
import type { EvaluateInput, EvaluationProvider, GenerateInput, GenerationProvider, TranscribeInput, TranscriptionProvider, ProviderUsage } from "./types.js";
import { ProviderError, asProviderError } from "./types.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

export function geminiProvider(apiKey: string | undefined): TranscriptionProvider & EvaluationProvider & GenerationProvider {
  async function call(model: string, body: unknown, signal: AbortSignal): Promise<{ text: string; usage: ProviderUsage }> {
    if (!apiKey) throw new ProviderError("PROVIDER_ERROR", "GEMINI_API_KEY is not set");
    let res: Response;
    try {
      res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      throw asProviderError(e);
    }
    if (res.status === 429) throw new ProviderError("RATE_LIMITED", "The Gemini quota is used up for now");
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw Object.assign(new ProviderError("PROVIDER_ERROR", `Gemini returned ${res.status}`), { status: res.status, detail: detail.slice(0, 500) });
    }
    const json = (await res.json()) as GeminiResponse;
    const cand = json.candidates?.[0];
    if (json.promptFeedback?.blockReason || !cand) throw new ProviderError("INVALID_OUTPUT", "Gemini declined the request");
    if (cand.finishReason && cand.finishReason !== "STOP") throw new ProviderError("INVALID_OUTPUT", `Gemini stopped early (${cand.finishReason})`);
    const text = (cand.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
    const u = json.usageMetadata ?? {};
    return { text, usage: { inputTokens: u.promptTokenCount, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } };
  }

  return {
    name: "gemini",
    async transcribe(i: TranscribeInput) {
      const r = await call(
        i.model,
        {
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: i.mimeType, data: i.audio.toString("base64") } }, { text: i.instruction }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 4096 },
        },
        i.signal,
      );
      return { text: r.text.trim(), usage: { ...r.usage, audioSeconds: i.audioSeconds } };
    },
    evaluate: (i: EvaluateInput) => structured(i, 8192, 0),
    generate: (i: GenerateInput) => structured(i, i.maxTokens, i.temperature ?? 0.3),
  };

  async function structured(i: EvaluateInput, maxOutputTokens: number, temperature: number) {
    {
      const base = {
        systemInstruction: { parts: [{ text: i.system }] },
        contents: [{ role: "user", parts: [{ text: i.user }] }],
      };
      const config = { temperature, maxOutputTokens, responseMimeType: "application/json" };
      let r: { text: string; usage: ProviderUsage };
      try {
        r = await call(i.model, { ...base, generationConfig: { ...config, responseJsonSchema: i.jsonSchema } }, i.signal);
      } catch (e) {
        // Older models reject responseJsonSchema: fall back to plain JSON mode; the output is validated either way.
        if (!(e instanceof ProviderError && (e as { status?: number }).status === 400)) throw e;
        r = await call(i.model, { ...base, generationConfig: config }, i.signal);
      }
      try {
        return { output: JSON.parse(r.text) as unknown, usage: r.usage };
      } catch {
        throw new ProviderError("INVALID_OUTPUT", "Gemini did not return JSON");
      }
    }
  }
}
