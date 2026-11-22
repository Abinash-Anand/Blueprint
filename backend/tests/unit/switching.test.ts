/** A slow or overloaded main model gives way to the fallback (ai/switching.ts); other failures don't switch. */
import { describe, expect, it, vi } from "vitest";
import { loadAiConfig } from "../../src/modules/ai/config.js";
import { type GenerateInput, type GenerationProvider, ProviderError } from "../../src/modules/ai/providers/types.js";
import { generateSwitching } from "../../src/modules/ai/switching.js";

/** "slow" models wait until their time is up; "down" answers 503; "bad" answers 400; anything else answers at once. */
function provider(): GenerationProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: "fake",
    calls,
    async generate(i: GenerateInput) {
      calls.push(i.model);
      if (i.model.startsWith("slow")) {
        await new Promise((_, no) => i.signal.addEventListener("abort", () => no(new ProviderError("TIMEOUT", "timed out"))));
      }
      if (i.model.startsWith("down")) throw Object.assign(new ProviderError("PROVIDER_ERROR", "overloaded"), { status: 503 });
      if (i.model.startsWith("bad")) throw Object.assign(new ProviderError("PROVIDER_ERROR", "bad request"), { status: 400 });
      return { output: { from: i.model }, usage: {} };
    },
  };
}

const run = (model: string, fallback: string | null, switchAfterMs = 50, timeoutMs = 5_000) => {
  const p = provider();
  const usage = { record: vi.fn(async () => {}) };
  const before = vi.fn(async () => {});
  const call = generateSwitching({ provider: p, usage, op: "RECALL", model, fallback, switchAfterMs, timeoutMs, before,
    input: { system: "s", user: "u", jsonSchema: {}, name: "recall_grade", maxTokens: 10, temperature: 0 } });
  return { p, usage, before, call };
};

describe("switching to the fallback model", () => {
  it("switches when the main model is still busy after the switch time, and says which model answered", async () => {
    const t0 = Date.now();
    const { p, usage, before, call } = run("slow-main", "quick-fallback", 50);
    expect(await call).toEqual({ output: { from: "quick-fallback" }, model: "quick-fallback" });
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(p.calls).toEqual(["slow-main", "quick-fallback"]);
    expect(usage.record.mock.calls.map((c) => [(c as unknown[])[2], (c as unknown[])[5]])).toEqual([["slow-main", "TIMEOUT"], ["quick-fallback", "OK"]]);
    // Each try passes the limits.
    expect(before).toHaveBeenCalledTimes(2);
  });

  it("switches when the main model is overloaded (5xx)", async () => {
    expect((await run("down-main", "quick-fallback").call).model).toBe("quick-fallback");
  });

  it("doesn't switch for a bad request, and keeps the main model when it answers", async () => {
    const bad = run("bad-main", "quick-fallback");
    await expect(bad.call).rejects.toMatchObject({ kind: "PROVIDER_ERROR", status: 400 });
    expect(bad.p.calls).toEqual(["bad-main"]);
    const ok = run("quick-main", "quick-fallback");
    expect((await ok.call).model).toBe("quick-main");
    expect(ok.p.calls).toEqual(["quick-main"]);
  });

  it("without a fallback, gives the main model the full time", async () => {
    const t0 = Date.now();
    const { call } = run("slow-main", null, 50, 300);
    await expect(call).rejects.toMatchObject({ kind: "TIMEOUT" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
  });

  it("fails when the fallback times out too", async () => {
    const { p, call } = run("slow-main", "slow-fallback", 50, 120);
    await expect(call).rejects.toMatchObject({ kind: "TIMEOUT" });
    expect(p.calls).toEqual(["slow-main", "slow-fallback"]);
  });

  it("defaults: GWDG recall switches to Mistral Large 4 after a minute; a fallback equal to the main model is off", () => {
    const c = loadAiConfig({ SAIA_API_KEY: "k" });
    expect(c.recallModel).toBe("qwen3.5-397b-a17b");
    expect(c.recallFallbackModel).toBe("mistral-large-4-1t-a52b");
    expect(c.recallSwitchAfterMs).toBe(60_000);
    expect(loadAiConfig({ SAIA_API_KEY: "k", AI_RECALL_FALLBACK_MODEL: "none" }).recallFallbackModel).toBeNull();
    expect(loadAiConfig({ SAIA_API_KEY: "k", AI_RECALL_FALLBACK_MODEL: "qwen3.5-397b-a17b" }).recallFallbackModel).toBeNull();
    expect(loadAiConfig({ SAIA_API_KEY: "k", AI_RECALL_SWITCH_AFTER_MS: "30000" }).recallSwitchAfterMs).toBe(30_000);
  });
});
