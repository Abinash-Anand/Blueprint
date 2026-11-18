/** Speech-term test scoring and the evaluator test set's integrity (AI design §9.1, §9.2). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { curriculumPrompts } from "../../src/curriculum/prompts.js";
import { splitCriteria } from "../../src/modules/ai/evaluation/criteria.js";
import { termHits, wer } from "../../eval/speech-score.js";

describe("speech-term scoring", () => {
  it("counts a term only when it is written as one term, ignoring case and punctuation", () => {
    const t = "I use RxJS: debounce time, then switchmap and toSignal.";
    expect(termHits(t, ["RxJS", "debounceTime", "switchMap", "toSignal"])).toEqual({ found: ["RxJS", "switchMap", "toSignal"], missed: ["debounceTime"] });
    expect(termHits("Docker compose up", ["Docker Compose"]).found).toEqual(["Docker Compose"]);
    expect(termHits("indexes", ["index"]).missed).toEqual(["index"]);
  });

  it("computes word error rate", () => {
    expect(wer("a b c d", "a b c d")).toBe(0);
    expect(wer("a b c d", "a x c")).toBe(0.5);
    expect(wer("", "")).toBe(0);
  });

  it("has 12 sentences, 60 terms, each term actually in its sentence, and valid topics", () => {
    const s = JSON.parse(readFileSync(new URL("../../eval/speech-terms.json", import.meta.url), "utf8")).sentences as { topic: string; text: string; terms: string[] }[];
    const topics = new Set(curriculumPrompts.map((p) => p.topic));
    expect(s).toHaveLength(12);
    expect(s.flatMap((x) => x.terms)).toHaveLength(60);
    for (const x of s) {
      expect(topics.has(x.topic), x.topic).toBe(true);
      expect(termHits(x.text, x.terms).missed, x.text).toEqual([]);
    }
  });
});

describe("evaluator test set", () => {
  const cases = JSON.parse(readFileSync(new URL("../../eval/cases.json", import.meta.url), "utf8")).cases as {
    id: string; topic: string; variant: string; answer: string; expect: [number, number]; twin?: string;
  }[];
  const prompts = new Map(curriculumPrompts.map((p) => [p.topic, p]));

  it("uses unique ids, real curriculum prompts with criteria, valid ranges and existing twins", () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      const p = prompts.get(c.topic);
      expect(p, c.id).toBeDefined();
      expect(splitCriteria(p!.expected).length, c.id).toBeGreaterThanOrEqual(2);
      expect(c.expect[0] <= c.expect[1] && c.expect[0] >= 0 && c.expect[1] <= 3, c.id).toBe(true);
      expect(c.answer.trim().length, c.id).toBeGreaterThan(20);
      if (c.twin) expect(cases.some((t) => t.id === c.twin && t.topic === c.topic), c.id).toBe(true);
    }
  });

  it("covers every variant for each prompt in the set, across all districts", () => {
    const byTopic = new Map<string, Set<string>>();
    for (const c of cases) byTopic.set(c.topic, (byTopic.get(c.topic) ?? new Set()).add(c.variant));
    for (const [topic, variants] of byTopic) expect(variants.size, topic).toBe(8);
    expect(new Set([...byTopic.keys()].map((t) => t.split(".")[0]))).toEqual(new Set(["fe", "be", "db", "ar", "cl", "ai", "ec"]));
    expect(cases.length).toBeGreaterThanOrEqual(96);
  });
});
