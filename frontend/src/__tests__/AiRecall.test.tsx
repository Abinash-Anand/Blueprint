/** AI check in the recall dialog (AI design §4.2, §9.4): self-score first, suggestion only, stale answers unlinked. */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiEvaluation, AiStatus, PromptOption, TopicRevision } from "../api/types";

const option = (over: Partial<PromptOption>): PromptOption => ({
  promptId: null, templateKey: "explain", source: "TEMPLATE", title: "Explain", content: "Explain generics.", retrievalMethod: "CONCEPTUAL",
  expectedAnswer: "What it is · the problem it solves", difficulty: null, isActive: true, uses: 0, lastUsedDate: null, ...over,
});

const rev: TopicRevision = {
  topicId: "fe.ts",
  today: "2026-11-19",
  policy: { subtopicMinutes: 10, topicMinutes: 20, dailyBudgetMinutes: 30 },
  units: [
    {
      unit: "s:11", scope: "SUBTOPIC", subtopicId: 11, label: "Generics", learned: true, eligible: true,
      schedule: {
        id: 5, status: "DUE", nextDueDate: "2026-11-19", lastAttemptDate: null, lastScore: null, consecutiveSuccesses: 0, consecutiveFailures: 0,
        weak: false, correctionPending: false, pendingAttemptId: null, openTask: { id: 77, scheduledDate: "2026-11-19" }, attempts: 0,
      },
      options: [option({})],
      suggested: 0,
    },
  ],
  attempts: [],
  checkpoints: [],
  prompts: [],
};

let status: AiStatus;
const baseStatus: AiStatus = {
  enabled: true, consented: true, consentedAt: "2026-11-18T10:00:00Z", evaluationProvider: "gemini", transcriptionProvider: "gemini",
  evaluationModel: "gemini-2.5-flash", transcriptionModel: "gemini-2.5-flash", maxRecordingSeconds: 120, maxAudioBytes: 4_000_000, maxFollowUps: 1,
  dailyRequestLimit: 0, requestsLast24h: 0, monthlyBudgetEur: 5, spentThisMonthEur: 0,
};

const evaluation = (over: Partial<AiEvaluation> = {}): AiEvaluation => ({
  id: 40, parentId: null, rootId: 40, status: "SUCCEEDED", errorCode: null, transcript: "Generics keep the type.", suggestedScore: 1, suggestion: pres("ai.suggestion", "ai", "Suggests 1 · Struggled"), relevant: true,
  criteria: [
    { index: 0, text: "What it is", verdict: "COVERED", presentation: pres("verdict.covered", "success", "Covered"), evidence: "keep the type", recoveredInFollowUp: false },
    { index: 1, text: "the problem it solves", verdict: "MISSING", presentation: pres("verdict.missing", "neutral", "Missing"), evidence: null, recoveredInFollowUp: false },
  ],
  misconceptions: [], feedback: "You said what it is. Say which problem it solves.", followUpQuestion: "What goes wrong without generics?",
  suggestedMistakes: "Missing: the problem it solves.", assisted: false, createdAt: "2026-11-19T08:00:00Z", ...over,
});

const evaluate = vi.fn(async (b: { parentId?: number; transcript: string }) =>
  b.parentId
    ? evaluation({ id: 41, parentId: 40, rootId: 40, transcript: b.transcript, assisted: true, followUpQuestion: null, suggestedMistakes: "Missing: the problem it solves. Recalled only after the follow-up question: the problem it solves.",
        criteria: [
          { index: 0, text: "What it is", verdict: "COVERED", presentation: pres("verdict.covered", "success", "Covered"), evidence: "keep the type", recoveredInFollowUp: false },
          { index: 1, text: "the problem it solves", verdict: "COVERED", presentation: pres("verdict.covered", "success", "Covered"), evidence: "lose the type", recoveredInFollowUp: true },
        ] })
    : evaluation({ transcript: b.transcript }),
);
const submitAttempt = vi.fn(async (_b: Record<string, unknown>) => ({ attempt: {}, nextDueDate: "2026-11-22", nextTaskDate: "2026-11-22", correctionPending: false, intervalDays: 3, effectiveScore: 2 }));
const aiConsent = vi.fn(async () => ({ consentedAt: "now" }));

vi.mock("../api/client", () => ({
  api: {
    topicRevision: vi.fn(async () => rev),
    aiStatus: vi.fn(async () => status),
    aiConsent: () => aiConsent(),
    evaluate: (b: { parentId?: number; transcript: string }) => evaluate(b),
    submitAttempt: (b: Record<string, unknown>) => submitAttempt(b),
  },
  ApiError: class extends Error {},
}));
vi.mock("../state/AppData", () => ({
  useAppData: () => ({ mutate: async <T,>(fn: () => Promise<T>) => fn(), topicById: new Map([["fe.ts", { id: "fe.ts", name: "TypeScript" }]]) }),
}));

import { RecallDialog } from "../components/RecallDialog";
import { pres } from "./fixtures";

const open = async () => {
  render(<RecallDialog items={[{ topicId: "fe.ts", scope: "SUBTOPIC", subtopicId: 11, mode: "revision" }]} onClose={() => {}} />);
  await waitFor(() => expect(screen.getByText("Explain generics.")).toBeInTheDocument());
};
const answer = (text: string) => fireEvent.change(screen.getByLabelText(/Your answer/), { target: { value: text } });

describe("AI check in the recall dialog", () => {
  beforeEach(() => {
    status = { ...baseStatus };
    evaluate.mockClear();
    submitAttempt.mockClear();
    aiConsent.mockClear();
  });

  it("asks for a self-score before the AI check, then shows a suggestion the learner can overrule", async () => {
    await open();
    answer("Generics keep the type.");
    const check = await screen.findByRole("button", { name: "Check with AI" });
    expect(check).toBeDisabled();
    fireEvent.click(screen.getByLabelText("2 · Recalled"));
    expect(check).toBeEnabled();
    fireEvent.click(check);
    await waitFor(() => expect(evaluate).toHaveBeenCalledWith({ scheduleId: 5, templateKey: "explain", transcript: "Generics keep the type." }));

    const panel = await screen.findByRole("region", { name: "AI check" });
    expect(within(panel).getByText(/Suggests/)).toHaveTextContent("1 · Struggled");
    expect(within(panel).getByText("Missing")).toBeInTheDocument();
    expect(screen.getByLabelText(/What's missing/)).toHaveValue("Missing: the problem it solves.");

    fireEvent.click(screen.getByRole("button", { name: "Continue to assessment" }));
    expect(screen.getByText(/Your first guess/)).toHaveTextContent("Your first guess: 2 · Recalled · AI suggestion: 1 · Struggled");
    fireEvent.click(screen.getByLabelText(/3 · Mastered/));
    fireEvent.click(screen.getByRole("button", { name: "Save attempt" }));
    await waitFor(() => expect(submitAttempt).toHaveBeenCalled());
    expect(submitAttempt.mock.calls[0][0]).toMatchObject({ score: 3, selfScore: 2, evaluationId: 40, inputMode: "TYPED", response: "Generics keep the type." });
  });

  it("marks a point recovered in the follow-up as a hint", async () => {
    await open();
    answer("Generics keep the type.");
    fireEvent.click(await screen.findByLabelText("1 · Struggled"));
    fireEvent.click(screen.getByRole("button", { name: "Check with AI" }));
    await screen.findByText(/What goes wrong without generics/);
    fireEvent.change(screen.getByLabelText("Your follow-up answer"), { target: { value: "Without them you lose the type." } });
    fireEvent.click(screen.getByRole("button", { name: "Check follow-up answer" }));
    await waitFor(() => expect(evaluate).toHaveBeenLastCalledWith({ scheduleId: 5, transcript: "Without them you lose the type.", parentId: 40 }));
    expect(await screen.findByText(/after the follow-up/, { selector: "em" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue to assessment" }));
    expect(screen.getByLabelText("I used hints")).toBeChecked();
  });

  it("does not link a check to an answer edited afterwards", async () => {
    await open();
    answer("Generics keep the type.");
    fireEvent.click(await screen.findByLabelText("2 · Recalled"));
    fireEvent.click(screen.getByRole("button", { name: "Check with AI" }));
    await screen.findByRole("region", { name: "AI check" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    answer("Generics keep the type, and avoid any.");
    fireEvent.click(screen.getByRole("button", { name: "Continue without AI" }));
    expect(screen.getByText(/Your answer changed after the AI check/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "AI check" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue to assessment" }));
    fireEvent.click(screen.getByLabelText(/2 · Recalled/, { selector: "fieldset.rd-scale input" }));
    fireEvent.click(screen.getByRole("button", { name: "Save attempt" }));
    await waitFor(() => expect(submitAttempt).toHaveBeenCalled());
    expect(submitAttempt.mock.calls[0][0].evaluationId).toBeUndefined();
  });

  it("shows the notice and asks for consent before the first use; hides AI when it is off", async () => {
    status = { ...baseStatus, consented: false, consentedAt: null };
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Read the notice" }));
    expect(screen.getByText(/Google may keep what you send/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept and use the AI check" }));
    await waitFor(() => expect(aiConsent).toHaveBeenCalled());
  });

  it("keeps the manual flow when AI is off", async () => {
    status = { ...baseStatus, enabled: false };
    await open();
    answer("Generics keep the type.");
    expect(screen.queryByRole("button", { name: "Check with AI" })).not.toBeInTheDocument();
    expect(screen.queryByText(/AI check available/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to comparison" })).toBeInTheDocument();
  });
});
