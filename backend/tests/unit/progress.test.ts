import { describe, expect, it } from "vitest";
import {
  type DistrictLearning, type TopicLearning, LEARN_CAP, currentTopicId, districtFraction,
  districtPassed, roadProgress, topicScore, topicStatus,
} from "../../src/domain/progress.js";

const t = (over: Partial<TopicLearning> = {}): TopicLearning => ({
  id: "x", priority: "CORE", estimatedHours: 10, subtopicsTotal: 4, subtopicsLearned: 0,
  demonstrated: false, doneTasks: 0, loggedMinutes: 0, ...over,
});

describe("topic status (BR-03)", () => {
  it("derives every state", () => {
    expect(topicStatus(t())).toBe("NOT_STARTED");
    expect(topicStatus(t({ loggedMinutes: 30 }))).toBe("IN_PROGRESS");
    expect(topicStatus(t({ doneTasks: 1 }))).toBe("IN_PROGRESS");
    expect(topicStatus(t({ subtopicsLearned: 2 }))).toBe("IN_PROGRESS");
    expect(topicStatus(t({ subtopicsLearned: 4 }))).toBe("LEARNED");
    expect(topicStatus(t({ demonstrated: true }))).toBe("DEMONSTRATED");
  });
});

describe("scores and road (BR-04 … BR-06)", () => {
  it("caps learning without demonstration at 80%", () => {
    expect(topicScore(t({ subtopicsLearned: 4 }))).toBeCloseTo(LEARN_CAP);
    expect(topicScore(t({ subtopicsLearned: 2 }))).toBeCloseTo(0.4);
    expect(topicScore(t({ demonstrated: true }))).toBe(1);
  });

  it("weights core topics by hours and ignores non-core topics", () => {
    const d: DistrictLearning = {
      id: "be",
      topics: [
        t({ id: "a", estimatedHours: 30, demonstrated: true }),
        t({ id: "b", estimatedHours: 10 }),
        t({ id: "c", priority: "OPTIONAL", estimatedHours: 100 }),
      ],
    };
    expect(districtFraction(d)).toBeCloseTo(0.75);
    expect(districtPassed(d)).toBe(false);
  });

  it("passes a checkpoint only when every core topic is demonstrated", () => {
    const learnedOnly: DistrictLearning = { id: "fe", topics: [t({ subtopicsLearned: 4 })] };
    expect(districtPassed(learnedOnly)).toBe(false);
    expect(roadProgress([learnedOnly, learnedOnly]).currentDistrictIndex).toBe(0);
    const done: DistrictLearning = { id: "fe", topics: [t({ demonstrated: true }), t({ priority: "IMPORTANT" })] };
    expect(districtPassed(done)).toBe(true);
  });

  it("travels the route in order: later progress does not move the car", () => {
    const empty: DistrictLearning = { id: "a", topics: [t()] };
    const ahead: DistrictLearning = { id: "b", topics: [t({ demonstrated: true })] };
    const r = roadProgress([empty, ahead]);
    expect(r.currentDistrictIndex).toBe(0);
    expect(r.overall).toBe(0);
  });

  it("reaches the goal when everything is passed", () => {
    const done: DistrictLearning = { id: "a", topics: [t({ demonstrated: true })] };
    expect(roadProgress([done, done])).toEqual({ currentDistrictIndex: 2, districtFraction: 1, overall: 1 });
  });

  it("computes overall progress across districts", () => {
    const done: DistrictLearning = { id: "a", topics: [t({ demonstrated: true })] };
    const half: DistrictLearning = { id: "b", topics: [t({ demonstrated: true }), t({ id: "q" })] };
    const r = roadProgress([done, half, half, half]);
    expect(r.currentDistrictIndex).toBe(1);
    expect(r.overall).toBeCloseTo((1 + 0.5) / 4);
  });
});

describe("current topic (BR-07)", () => {
  const d: DistrictLearning = { id: "fe", topics: [t({ id: "fe.a", demonstrated: true }), t({ id: "fe.b" })] };
  it("prefers today's first open task", () => {
    expect(currentTopicId([d], [null, "be.x"])).toBe("be.x");
  });
  it("falls back to the first non-demonstrated core topic", () => {
    expect(currentTopicId([d], [])).toBe("fe.b");
  });
});
