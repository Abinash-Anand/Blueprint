import { describe, expect, it } from "vitest";
import { allTopics, districts, stages } from "../../src/curriculum/index.js";
import { curriculumPrompts } from "../../src/curriculum/prompts.js";

describe("curriculum integrity (FR-CUR)", () => {
  const topics = allTopics();

  it("has exactly the seven districts in road order", () => {
    expect(districts.map((d) => d.name)).toEqual([
      "Frontend Engineering", "Backend Engineering", "Database", "Architecture & System Design",
      "Cloud Engineering", "AI Engineering", "Engineering Consolidation",
    ]);
  });

  it("uses unique, well-formed topic slugs prefixed by their district", () => {
    const slugs = topics.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const d of districts) for (const t of d.topics) expect(t.slug.startsWith(`${d.slug}.`)).toBe(true);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9.-]{1,40}$/);
  });

  it("gives every topic sub-topics, hours, an exercise and at least one http(s) resource", () => {
    for (const t of topics) {
      expect(t.subtopics.length, t.slug).toBeGreaterThan(0);
      expect(t.hours, t.slug).toBeGreaterThan(0);
      expect(t.exercise.length, t.slug).toBeGreaterThan(10);
      expect(t.resources.length, t.slug).toBeGreaterThan(0);
      for (const r of t.resources) expect(r.url).toMatch(/^https:\/\//);
    }
  });

  it("only references dependencies that exist", () => {
    const slugs = new Set(topics.map((t) => t.slug));
    for (const t of topics) for (const dep of t.dependsOn ?? []) expect(slugs.has(dep), `${t.slug} → ${dep}`).toBe(true);
  });

  it("keeps Redis and message brokers at Important or below (FR-CUR-06)", () => {
    for (const slug of ["be.caching", "be.messaging"]) {
      expect(topics.find((t) => t.slug === slug)!.priority).not.toBe("CORE");
    }
  });

  it("uses muted lowercase hex colours", () => {
    for (const d of districts) expect(d.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("has exactly one topic-level revision prompt per topic, with criteria (Revision spec §4.1, §4.4)", () => {
    const counts = new Map<string, number>();
    for (const p of curriculumPrompts) counts.set(p.topic, (counts.get(p.topic) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual(topics.map((t) => t.slug).sort());
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
    for (const p of curriculumPrompts) {
      expect(p.content.length).toBeGreaterThan(20);
      expect(p.expected.length).toBeGreaterThan(20);
    }
  });

  it("defines stages that cover the journey", () => {
    expect(stages[0].start).toBe("2026-11-17");
    expect(stages.at(-1)!.end).toBe("2027-08-17");
  });
});
