/**
 * Claude adapter for answer checking (AI design §10.1: the paid alternative, Claude Haiku 5.5 by default).
 * Claude has no speech-to-text, so this adapter only evaluates. Structured outputs constrain the reply to the §6.3
 * JSON schema; current Claude models reject sampling parameters, so variance is kept low with `effort: "low"`.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { EvaluateInput, EvaluationProvider } from "./types.js";
import { ProviderError, asProviderError } from "./types.js";

export function anthropicProvider(apiKey: string | undefined): EvaluationProvider {
  const client = apiKey ? new Anthropic({ apiKey, maxRetries: 0 }) : null;
  return {
    name: "anthropic",
    async evaluate(i: EvaluateInput) {
      if (!client) throw new ProviderError("PROVIDER_ERROR", "ANTHROPIC_API_KEY is not set");
      let res: Anthropic.Message;
      try {
        res = await client.messages.create(
          {
            model: i.model,
            max_tokens: 16000,
            system: i.system,
            messages: [{ role: "user", content: i.user }],
            output_config: { effort: "low", format: { type: "json_schema", schema: i.jsonSchema } },
          },
          { signal: i.signal },
        );
      } catch (e) {
        if (e instanceof Anthropic.RateLimitError) throw new ProviderError("RATE_LIMITED", "Claude rate limit reached");
        if (e instanceof Anthropic.APIConnectionTimeoutError || e instanceof Anthropic.APIUserAbortError) throw new ProviderError("TIMEOUT", "Claude did not answer in time");
        throw asProviderError(e);
      }
      if (res.stop_reason === "refusal") throw new ProviderError("INVALID_OUTPUT", "Claude declined the request");
      if (res.stop_reason === "max_tokens") throw new ProviderError("INVALID_OUTPUT", "Claude's answer was cut off");
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      try {
        return { output: JSON.parse(text) as unknown, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
      } catch {
        throw new ProviderError("INVALID_OUTPUT", "Claude did not return JSON");
      }
    },
  };
}
