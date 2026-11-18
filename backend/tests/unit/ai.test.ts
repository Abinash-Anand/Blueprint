/** Pure parts of the AI check (AI design §6, §8.2, §9.4): criteria, verification, score, prompt, WAV, config. */
import { describe, expect, it } from "vitest";
import { curriculumPrompts } from "../../src/curriculum/prompts.js";
import { loadAiConfig } from "../../src/modules/ai/config.js";
import { splitCriteria } from "../../src/modules/ai/evaluation/criteria.js";
import { buildUserPrompt, vocabulary } from "../../src/modules/ai/evaluation/prompt.js";
import { EvaluationResult, evaluationJsonSchema } from "../../src/modules/ai/evaluation/schema.js";
import { coverage, suggestScore, suggestedMistakes } from "../../src/modules/ai/evaluation/score.js";
import { VerificationError, normalise, quoteFound, verifyResult } from "../../src/modules/ai/evaluation/verify.js";
import { fakeProvider } from "../../src/modules/ai/providers/fake.js";
import { WavError, parseWav } from "../../src/modules/ai/voice/wav.js";
import { TEMPLATES } from "../../src/modules/revision/templates.js";
import { wav } from "../helpers/wav.js";

const result = (over: Partial<EvaluationResult> = {}): EvaluationResult => ({
  relevant: true,
  criteria: [],
  misconceptions: [],
  feedback: "ok",
  followUpQuestion: null,
  ...over,
});

describe("criteria from the existing rubric", () => {
  it("splits every curriculum prompt and template into at least two criteria", () => {
    for (const p of curriculumPrompts) {
      const c = splitCriteria(p.expected);
      expect(c.length, p.topic).toBeGreaterThanOrEqual(2);
      expect(c.every((x) => x.length > 0 && !x.endsWith(".")), p.topic).toBe(true);
    }
    for (const t of TEMPLATES) expect(splitCriteria(t.expected).length, t.key).toBeGreaterThanOrEqual(2);
  });

  it("accepts learner criteria one per line, with bullets or numbers", () => {
    expect(splitCriteria("- first point\n2) second point.\n\n• third")).toEqual(["first point", "second point", "third"]);
    expect(splitCriteria("   ")).toEqual([]);
  });
});

describe("verification of the model's output", () => {
  const criteria = ["generic parameter flows to the result", "literal discriminant", "no any"];
  const answer = "The type T is inferred at the call site. The union uses ok: true or ok: false. Never use any!";

  it("matches quotes regardless of case and punctuation, on word boundaries", () => {
    expect(quoteFound("OK TRUE or ok false", answer)).toBe(true);
    expect(quoteFound("never use any", answer)).toBe(true);
    expect(quoteFound("infer", answer)).toBe(false);
    expect(normalise("  Hello,   World! ")).toBe("hello world");
  });

  it("keeps verified verdicts and downgrades an unverifiable COVERED to MISSING", () => {
    const v = verifyResult(
      result({
        criteria: [
          { index: 0, verdict: "COVERED", evidence: "T is inferred at the call site" },
          { index: 1, verdict: "COVERED", evidence: "ok true or ok false" },
          { index: 2, verdict: "COVERED", evidence: "avoid unknown types" },
        ],
        followUpQuestion: "Why avoid any?",
      }),
      criteria,
      answer,
    );
    expect(v.criteria.map((c) => c.verdict)).toEqual(["COVERED", "COVERED", "MISSING"]);
    expect(v.criteria[2]).toMatchObject({ claimedVerdict: "COVERED", evidence: null });
    expect(v.downgraded).toBe(1);
    expect(v.followUpQuestion).toBe("Why avoid any?");
  });

  it("rejects output whose quotes are mostly invented, and structural mistakes", () => {
    const invented = result({
      criteria: [
        { index: 0, verdict: "COVERED", evidence: "uses generics everywhere" },
        { index: 1, verdict: "COVERED", evidence: "tagged unions" },
        { index: 2, verdict: "MISSING", evidence: null },
      ],
    });
    expect(() => verifyResult(invented, criteria, answer)).toThrow(VerificationError);
    const missing = result({ criteria: [{ index: 0, verdict: "MISSING", evidence: null }] });
    expect(() => verifyResult(missing, criteria, answer)).toThrow(/Not every criterion/);
    const twice = result({ criteria: [0, 0, 1].map((index) => ({ index, verdict: "MISSING" as const, evidence: null })) });
    expect(() => verifyResult(twice, criteria, answer)).toThrow(/twice/);
    const unknown = result({ criteria: [0, 1, 5].map((index) => ({ index, verdict: "MISSING" as const, evidence: null })) });
    expect(() => verifyResult(unknown, criteria, answer)).toThrow(/Unknown criterion/);
  });

  it("drops a follow-up when everything is covered or when it gives the answer away", () => {
    const all = verifyResult(
      result({
        criteria: [
          { index: 0, verdict: "COVERED", evidence: "inferred at the call site" },
          { index: 1, verdict: "COVERED", evidence: "ok true" },
          { index: 2, verdict: "COVERED", evidence: "never use any" },
        ],
        followUpQuestion: "Anything else?",
      }),
      criteria,
      answer,
    );
    expect(all.followUpQuestion).toBeNull();
    const leak = verifyResult(
      result({
        criteria: [0, 1, 2].map((index) => ({ index, verdict: "MISSING" as const, evidence: null })),
        followUpQuestion: "Did you mention that the generic parameter flows to the result?",
      }),
      criteria,
      answer,
    );
    expect(leak.followUpQuestion).toBeNull();
  });

  it("keeps an unverifiable misconception: it can only lower the suggestion", () => {
    const v = verifyResult(
      result({
        criteria: [
          { index: 0, verdict: "COVERED", evidence: "inferred at the call site" },
          { index: 1, verdict: "COVERED", evidence: "ok true" },
          { index: 2, verdict: "COVERED", evidence: "never use any" },
        ],
        misconceptions: [{ claim: "something not said", correction: "x" }],
      }),
      criteria,
      answer,
    );
    expect(v.misconceptions).toEqual([{ claim: "something not said", correction: "x", verified: false }]);
  });
});

describe("suggested score (code, not the model)", () => {
  it("follows the documented rules", () => {
    const s = (verdicts: ("COVERED" | "PARTIAL" | "MISSING" | "INCORRECT")[], misconceptions = 0, relevant = true) => suggestScore({ verdicts, misconceptions, relevant });
    expect(s(["COVERED", "COVERED", "COVERED"])).toBe(3);
    expect(s(["COVERED", "COVERED", "PARTIAL"])).toBe(2);
    expect(s(["COVERED", "MISSING"])).toBe(2);
    expect(s(["COVERED", "MISSING", "MISSING"])).toBe(1);
    expect(s(["COVERED", "COVERED", "COVERED"], 1)).toBe(1);
    expect(s(["COVERED", "INCORRECT", "COVERED"])).toBe(1);
    expect(s(["MISSING", "MISSING"])).toBe(0);
    expect(s(["COVERED"], 0, false)).toBe(0);
    expect(coverage(["COVERED", "PARTIAL"])).toBe(0.75);
  });

  it("writes the gaps for the Assess step", () => {
    expect(
      suggestedMistakes(
        [
          { text: "a", verdict: "COVERED" },
          { text: "b", verdict: "PARTIAL" },
          { text: "c", verdict: "MISSING" },
          { text: "d", verdict: "INCORRECT" },
        ],
        [{ claim: "x", correction: "y" }],
      ),
    ).toBe('Incorrect: d. Wrong: "x" (y). Partly: b. Missing: c.');
  });
});

describe("prompt, schema and fake provider", () => {
  it("builds a JSON schema without $schema from the one Zod definition", () => {
    const js = evaluationJsonSchema();
    expect(js.$schema).toBeUndefined();
    expect(js).toMatchObject({ type: "object", additionalProperties: false });
    expect(Object.keys(js.properties as object).sort()).toEqual(["criteria", "feedback", "followUpQuestion", "misconceptions", "relevant"]);
  });

  it("collects spelling hints from code spans and technical names", () => {
    const v = vocabulary(["Write a generic `fetchJson<T>` helper with RxJS switchMap and NestJS.", "The OAuth flow"]);
    expect(v).toEqual(expect.arrayContaining(["fetchJson<T>", "RxJS", "switchMap", "NestJS", "OAuth"]));
    expect(v).not.toContain("Write");
    expect(v).not.toContain("The");
  });

  it("the fake provider judges deterministically and quotes words from the answer", async () => {
    const user = buildUserPrompt({ promptText: "Q", retrievalMethod: "CONCEPTUAL", criteria: ["discriminated union narrowing", "async error handling"], answer: "A discriminated union lets narrowing work." });
    const r = await fakeProvider().evaluate({ system: "", user, jsonSchema: {}, model: "fake", signal: new AbortController().signal });
    const parsed = EvaluationResult.parse(r.output);
    const v = verifyResult(parsed, ["discriminated union narrowing", "async error handling"], "A discriminated union lets narrowing work.");
    expect(v.criteria.map((c) => c.verdict)).toEqual(["COVERED", "MISSING"]);
    expect(v.followUpQuestion).toBe("Can you say more about point 2?");
  });
});

describe("WAV checks", () => {
  it("reads the duration from the header", () => {
    expect(parseWav(wav(2.5)).seconds).toBeCloseTo(2.5, 3);
    expect(parseWav(wav(1, 48000)).sampleRate).toBe(48000);
  });
  it("rejects anything that is not 16-bit PCM WAV", () => {
    expect(() => parseWav(Buffer.from("OggS not a wav file at all, definitely not one"))).toThrow(WavError);
    const eight = wav(1);
    eight.writeUInt16LE(8, 34);
    expect(() => parseWav(eight)).toThrow(/16-bit/);
  });
});

describe("AI configuration", () => {
  it("is off by default and keeps Gemini for speech when Claude checks answers", () => {
    expect(loadAiConfig({}).enabled).toBe(false);
    const c = loadAiConfig({ AI_ENABLED: "true", AI_EVALUATION_PROVIDER: "anthropic" });
    expect(c).toMatchObject({ enabled: true, evaluationProvider: "anthropic", transcriptionProvider: "gemini", evaluationModel: "claude-haiku-5-5" });
    expect(() => loadAiConfig({ AI_TRANSCRIPTION_PROVIDER: "anthropic" })).toThrow(/speech-to-text/);
    expect(() => loadAiConfig({ AI_MAX_FOLLOW_UPS: "9" })).toThrow();
  });
});
