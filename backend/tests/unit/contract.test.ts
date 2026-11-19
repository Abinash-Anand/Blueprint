/** Curriculum contract (docs/Sprint-Multi-User.md §6): the template is valid, broken documents are reported precisely. */
import { describe, expect, it } from "vitest";
import { engineeringTemplate } from "../../src/modules/cities/apply.js";
import { MAX_DISTRICTS, curriculumJsonSchema, diffCurriculum, shiftDocument, validateCurriculum } from "../../src/modules/cities/contract.js";

const doc = () => structuredClone(engineeringTemplate());
const issues = (d: unknown) => {
  const v = validateCurriculum(d);
  return v.ok ? [] : v.issues.map((i) => i.message);
};

describe("curriculum contract", () => {
  it("accepts the built-in Engineering template and summarises it", () => {
    const v = validateCurriculum(doc());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.summary).toMatchObject({ districts: 7, topics: 83, stages: 7, start: "2026-11-17", end: "2027-08-17" });
  });

  it("reports unknown and circular dependencies, duplicates and broken references", () => {
    const d = doc();
    d.districts[0].topics[0].dependsOn = ["nope"];
    d.districts[0].topics[1].key = d.districts[0].topics[2].key;
    d.stages[0].districts = ["zz"];
    d.queues.fe = [...d.queues.fe, "missing.topic"];
    const m = issues(d);
    expect(m).toEqual(expect.arrayContaining(['unknown topic "nope"', expect.stringMatching(/^duplicate topic key/), 'unknown district "zz"', 'unknown topic "missing.topic"']));
    const c = doc();
    const [a, b] = c.districts[0].topics;
    a.dependsOn = [b.key];
    b.dependsOn = [a.key];
    expect(issues(c).some((x) => x.startsWith("dependency cycle"))).toBe(true);
  });

  it("checks the calendar and the planner queues", () => {
    const d = doc();
    d.stages[0].end = "2030-01-01";
    expect(issues(d)).toContain("the stage lies outside the journey");
    const q = doc();
    const optional = q.districts.flatMap((x) => x.topics).find((t) => t.priority === "OPTIONAL")!;
    q.queues.fe = [...q.queues.fe, optional.key];
    expect(issues(q)).toContain(`optional topic "${optional.key}" is not planned`);
    const z = doc();
    z.weeklyTargets = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
    expect(issues(z)).toContain("at least one day needs study time");
  });

  it("rejects structure it does not know: extra fields, unsafe URLs, too many districts, HTML in place of data", () => {
    expect(issues({ ...doc(), html: "<div/>" }).length).toBeGreaterThan(0);
    const u = doc();
    u.districts[0].topics[0].resources = [{ label: "x", url: "javascript:alert(1)", kind: "DOCS" }];
    expect(issues(u).length).toBeGreaterThan(0);
    const many = doc();
    many.districts = Array.from({ length: MAX_DISTRICTS + 1 }, (_, i) => ({ ...many.districts[0], key: `d${i}` }));
    expect(issues(many).length).toBeGreaterThan(0);
    expect(issues("<html>not a curriculum</html>").length).toBeGreaterThan(0);
  });

  it("shifts every date for a later start, and diffs versions by key", () => {
    const s = shiftDocument(doc(), "2027-01-04");
    expect(s.journey.start).toBe("2027-01-04");
    expect(s.stages[0].start).toBe("2027-01-04");
    expect(validateCurriculum(s).ok).toBe(true);
    const next = doc();
    next.districts[0].topics[0].name = "Renamed";
    next.districts[0].topics.push({ ...next.districts[0].topics[0], key: "fe.new", name: "New" });
    const removed = next.districts[1].topics.pop()!;
    const c = diffCurriculum(doc(), next);
    expect(c.added.topics).toEqual(["fe.new"]);
    expect(c.modified.topics).toEqual(expect.arrayContaining([next.districts[0].topics[0].key]));
    expect(c.removed.topics).toEqual([removed.key]);
    expect(diffCurriculum(null, doc()).added.topics).toHaveLength(83);
  });

  it("publishes the contract as JSON Schema for a future generator", () => {
    const s = curriculumJsonSchema() as { type: string; required: string[] };
    expect(s.type).toBe("object");
    expect(s.required).toEqual(expect.arrayContaining(["contractVersion", "districts", "stages", "queues"]));
  });
});
