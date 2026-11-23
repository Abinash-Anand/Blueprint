/** A building's panel: read in order (not a live region), focused when it opens, ordered by what you do with a topic. */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Building } from "../map/geometry";

vi.mock("../api/client", () => ({ api: {}, ApiError: class extends Error {} }));
const patchTopic = vi.fn();
vi.mock("../state/AppData", () => ({
  useAppData: () => ({ patchTopic, toggleSubtopic: vi.fn(), topicById: new Map([["fe.js", { id: "fe.js", name: "JavaScript", status: "DEMONSTRATED" }]]) }),
}));

import { TopicPanel } from "../components/TopicPanel";

const topic = {
  id: "fe.ts", name: "TypeScript", description: "The type system.", priority: "CORE", status: "IN_PROGRESS", estimatedHours: 10,
  exercise: "Write a typed API client.", demonstratedAt: null, demonstrationNote: null, needsReview: false,
  presentation: { state: "topic.in_progress", tone: "info", variant: "soft", icon: "circle-half", label: "In progress" },
  subtopics: [
    { id: 1, name: "Generics", completedAt: "2026-11-19T10:00:00Z", recall: { nextDueDate: "2026-11-21", stage: 1, last: { date: "2026-11-20", score: 0.6, depth: "FOUNDATIONAL", outcome: "HOLD" } } },
    { id: 2, name: "Modules", completedAt: null, recall: null },
  ],
  resources: [{ label: "TypeScript Handbook", url: "https://example.test/handbook", kind: "DOCS" }],
  dependsOn: ["fe.js"], firstDate: "2026-11-17", lastDate: "2026-11-24", plannedMinutes: 600, loggedMinutes: 95,
};
const building = { topic, ri: 1, block: { district: { name: "Frontend Engineering", layer: 1, color: "#7f98a8", goal: "Ship a typed UI.", note: "Start here." } } } as unknown as Building;
const route = [building, building, building];

describe("TopicPanel", () => {
  it("is read in order, takes focus on its name, and has real section headings in the order you use them", () => {
    render(<TopicPanel building={building} route={route} today="2026-11-23" onOpenTopic={() => {}} onClose={() => {}} />);
    const panel = screen.getByRole("region", { name: "TypeScript" });
    expect(panel).not.toHaveAttribute("aria-live");
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: "TypeScript" }));
    const order = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(order).toEqual(["Sub-topics", "Resources", "Practical milestone", "Builds on", "Schedule", "District goal · Frontend Engineering"]);
  });

  it("says how the last recall went in words, and offers it again", () => {
    render(<TopicPanel building={building} route={route} today="2026-11-23" onOpenTopic={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/Recall due now · last: Partly remembered, 20 Nov/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByRole("button", { name: "Recall Generics now" })).toBeInTheDocument();
  });

  it("adds the topic to a day on the add-task page, and marks it for review from the tags", () => {
    render(<TopicPanel building={building} route={route} today="2026-11-23" onOpenTopic={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to a day" }));
    expect(location.hash).toBe("#/add-task/2026-11-23/fe.ts");
    history.replaceState(null, "", "#/city");
    fireEvent.click(screen.getByRole("button", { name: "Mark for review", pressed: false }));
    expect(patchTopic).toHaveBeenCalledWith("fe.ts", { needsReview: true });
  });
});
