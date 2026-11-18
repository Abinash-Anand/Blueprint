import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptOption, TopicRevision } from "../api/types";

const option = (over: Partial<PromptOption>): PromptOption => ({
  promptId: null, templateKey: null, source: "TEMPLATE", title: "Explain", content: "Explain generics.", retrievalMethod: "CONCEPTUAL",
  expectedAnswer: "Type parameters flow from call site to result.", difficulty: null, isActive: true, uses: 0, lastUsedDate: null, ...over,
});

const rev: TopicRevision = {
  topicId: "fe.ts",
  today: "2026-11-19",
  policy: { subtopicMinutes: 10, topicMinutes: 20, dailyBudgetMinutes: 30 },
  units: [
    { unit: "t:fe.ts", scope: "TOPIC", subtopicId: null, label: "TypeScript (whole topic)", learned: false, eligible: false, schedule: null, options: [option({ source: "CURRICULUM", promptId: 9 })], suggested: 0 },
    {
      unit: "s:11", scope: "SUBTOPIC", subtopicId: 11, label: "Generics", learned: true, eligible: true,
      schedule: {
        id: 5, status: "DUE", nextDueDate: "2026-11-19", lastAttemptDate: null, lastScore: null, consecutiveSuccesses: 0, consecutiveFailures: 0,
        weak: false, correctionPending: false, pendingAttemptId: null, openTask: { id: 77, scheduledDate: "2026-11-19" }, attempts: 0,
      },
      options: [
        option({ promptId: 31, source: "LEARNER", title: "My question", content: "How do constraints narrow T?", expectedAnswer: "extends limits T" }),
        option({ templateKey: "explain", content: "Without notes, explain Generics (TypeScript) in your own words." }),
      ],
      suggested: 0,
    },
  ],
  attempts: [],
  checkpoints: [],
  prompts: [],
};

const submitAttempt = vi.fn(async (_b: unknown) => ({ attempt: {}, nextDueDate: "2026-11-20", nextTaskDate: "2026-11-20", correctionPending: true, intervalDays: 1, effectiveScore: 1 }));
const createCheckpoint = vi.fn(async (_b: unknown) => ({ id: 1 }));
vi.mock("../api/client", () => ({
  api: { topicRevision: vi.fn(async () => rev), submitAttempt: (b: unknown) => submitAttempt(b), createCheckpoint: (b: unknown) => createCheckpoint(b) },
  ApiError: class extends Error {},
}));
vi.mock("../state/AppData", () => ({
  useAppData: () => ({ mutate: async <T,>(fn: () => Promise<T>) => fn(), topicById: new Map([["fe.ts", { id: "fe.ts", name: "TypeScript" }]]) }),
}));

import { RecallDialog } from "../components/RecallDialog";

describe("RecallDialog", () => {
  beforeEach(() => {
    submitAttempt.mockClear();
    createCheckpoint.mockClear();
  });

  it("hides the expected answer until revealed and requires the gap for a low score", async () => {
    render(<RecallDialog items={[{ topicId: "fe.ts", scope: "SUBTOPIC", subtopicId: 11, mode: "revision" }]} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("How do constraints narrow T?")).toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Generics" })).toBeInTheDocument();
    expect(screen.queryByText("extends limits T")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Your answer, from memory/), { target: { value: "T extends something" } });
    fireEvent.click(screen.getByRole("button", { name: "Reveal the expected answer" }));
    expect(screen.getByText("extends limits T")).toBeInTheDocument();

    const save = screen.getByRole("button", { name: "Save attempt" });
    expect(save).toBeDisabled(); // no score yet
    fireEvent.click(screen.getByLabelText(/1 · Struggled/));
    expect(save).toBeDisabled(); // a failed retrieval must name the gap
    fireEvent.change(screen.getByLabelText(/What was missing or wrong/), { target: { value: "Forgot keyof constraints" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(submitAttempt).toHaveBeenCalledTimes(1));
    expect(submitAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId: "fe.ts", subtopicId: 11, promptId: 31, score: 1, retrievalMethod: "CONCEPTUAL",
        mistakes: "Forgot keyof constraints", correctionCompleted: false, response: "T extends something", usedHints: false, usedNotes: false,
      }),
    );
    await waitFor(() => expect(screen.getByText(/Next revision due/)).toBeInTheDocument());
  });

  it("records a learning checkpoint with the explain template by default", async () => {
    render(<RecallDialog items={[{ topicId: "fe.ts", scope: "SUBTOPIC", subtopicId: 11, mode: "checkpoint" }]} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Without notes, explain Generics/)).toBeInTheDocument());
    expect(screen.getByText(/Recall check/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reveal the expected answer" }));
    fireEvent.click(screen.getByLabelText("Partly"));
    fireEvent.click(screen.getByRole("button", { name: "Save checkpoint" }));
    await waitFor(() => expect(createCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ templateKey: "explain", result: "PARTIAL", subtopicId: 11 })));
    await waitFor(() => expect(screen.getByText(/Go back to the material/)).toBeInTheDocument());
  });

  it("explains why a unit that isn't learned yet can't be revised", async () => {
    render(<RecallDialog items={[{ topicId: "fe.ts", scope: "TOPIC", subtopicId: null, mode: "revision" }]} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/starts once two sub-topics are learned/)).toBeInTheDocument());
  });
});
