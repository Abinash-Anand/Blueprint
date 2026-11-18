/** Benchmark error classification and gates (AI design §9.3): the model is only blamed for its own errors. */
import { describe, expect, it } from "vitest";
import { ZodError } from "zod/v4";
import { type Case, type CaseResult, type Run, errorKind, gates, runKind } from "../../eval/gates.js";
import { VerificationError } from "../../src/modules/ai/evaluation/verify.js";
import { ProviderError } from "../../src/modules/ai/providers/types.js";

const c = (id: string, expect: [number, number], twin?: string): Case => ({ id, topic: "fe.ts", variant: "v", answer: "a", expect, ...(twin ? { twin } : {}) });
const ok = (score: number): Run => ({ score, ms: 1000, downgraded: 0 });
const err = (error: string, kind?: Run["kind"]): Run => ({ score: null, error, ...(kind ? { kind } : {}), ms: 0, downgraded: 0 });
const row = (g: ReturnType<typeof gates>, name: string) => g.find(([n]) => n.startsWith(name))!;

describe("benchmark error kinds", () => {
  it("classifies thrown errors at the time of the call", () => {
    expect(errorKind(new ProviderError("TIMEOUT", "x"))).toBe("TIMEOUT");
    expect(errorKind(new ProviderError("RATE_LIMITED", "x"))).toBe("QUOTA");
    expect(errorKind(new ProviderError("INVALID_OUTPUT", "x"))).toBe("MODEL_INVALID");
    expect(errorKind(Object.assign(new ProviderError("PROVIDER_ERROR", "Gemini returned 503"), { status: 503 }))).toBe("PROVIDER_ERROR");
    expect(errorKind(Object.assign(new ProviderError("PROVIDER_ERROR", "Gemini returned 403"), { status: 403 }))).toBe("CONFIG");
    expect(errorKind(new ProviderError("PROVIDER_ERROR", "GEMINI_API_KEY is not set"))).toBe("CONFIG");
    expect(errorKind(new VerificationError("quotes"))).toBe("MODEL_INVALID");
    expect(errorKind(new ZodError([]))).toBe("MODEL_INVALID");
    expect(errorKind(new SyntaxError("json"))).toBe("MODEL_INVALID");
  });

  it("reads kinds from results saved before kinds were recorded", () => {
    expect(runKind(err("skipped: quota exhausted"))).toBe("SKIPPED");
    expect(runKind(err("The Gemini quota is used up for now"))).toBe("QUOTA");
    expect(runKind(err("The AI provider did not answer in time"))).toBe("TIMEOUT");
    expect(runKind(err("Gemini returned 503"))).toBe("PROVIDER_ERROR");
    expect(runKind(err("Gemini returned 400"))).toBe("CONFIG");
    expect(runKind(err("Most quoted evidence is not in the answer"))).toBe("MODEL_INVALID");
    expect(runKind(err("Gemini returned 503", "TIMEOUT"))).toBe("TIMEOUT"); // recorded kind wins
    expect(runKind(ok(2))).toBeNull();
  });
});

describe("gates", () => {
  it("excludes quota and skipped calls, separates outages and setup errors, and blames only model errors", () => {
    const results: CaseResult[] = [
      { c: c("a", [3, 3]), runs: [ok(3), ok(3)] },
      { c: c("b", [1, 1]), runs: [ok(1), err("x", "TIMEOUT")] },
      { c: c("c", [0, 1]), runs: [ok(2)] }, // a false pass
      { c: c("d", [1, 1]), runs: [err("x", "QUOTA"), err("x", "SKIPPED")] },
      { c: c("e", [2, 2]), runs: [err("x", "PROVIDER_ERROR"), err("x", "MODEL_INVALID"), ok(2)] },
      { c: c("f", [1, 1], "b"), runs: [ok(1)] },
    ];
    const g = gates(results);
    expect(row(g, "Answered calls")[1]).toBe("6 of 11 (5 cases)");
    expect(row(g, "False pass")[1]).toBe("33.3 % of 3"); // b, c, f should fail; c scored 2
    expect(row(g, "False pass")[2]).toBe(false);
    expect(row(g, "Valid model output")[1]).toBe("85.7 % (1 invalid)");
    expect(row(g, "Timeouts")[1]).toBe("1 of 9 attempted calls");
    expect(row(g, "Provider errors")[1]).toBe("1 of 9 attempted calls");
    expect(row(g, "Quota refusals")[1]).toBe("1");
    expect(row(g, "Skipped after quota")[1]).toBe("1");
    expect(row(g, "Repeatability")[1]).toBe("100.0 % of 1 cases"); // only "a" has two answers
    expect(row(g, "Injection")[1]).toBe("1 of 1");
    expect(row(g, "Setup errors")[2]).toBeNull();
  });

  it("does not count an unanswered injection case or its twin as affected", () => {
    const g = gates([
      { c: c("t", [1, 1]), runs: [err("x", "QUOTA")] },
      { c: c("i", [1, 1], "t"), runs: [ok(1)] },
    ]);
    expect(row(g, "Injection")[1]).toBe("not run");
  });

  it("fails the setup gate when the provider rejected the requests", () => {
    expect(row(gates([{ c: c("a", [3, 3]), runs: [err("x", "CONFIG")] }]), "Setup errors")[2]).toBe(false);
  });
});
