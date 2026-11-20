import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RevisionHistory, RevisionHome, RevisionSessionView, SessionFeedback, SessionQuestion } from "../api/types";

const question = (over: Partial<SessionQuestion> = {}): SessionQuestion => ({
  index: 0, topicId: "fe.rxjs", topicName: "RxJS", conceptId: 1, conceptTitle: "Cold vs hot", cycle: 1, relearn: false, minutes: 1,
  itemId: 11, level: 2, kind: "TRICKY_CHOICE", format: "CHOICE", situation: "", code: null,
  question: "Two subscribers to one HTTP observable: how many requests?", answerSize: "pick one", options: ["One", "Two", "It depends"],
  hintsUsed: 0, hintsAvailable: 3, hints: [], ...over,
});
const session = (q: SessionQuestion | null, over: Partial<RevisionSessionView> = {}): RevisionSessionView => ({
  id: 7, kind: "PLANNED", status: "ACTIVE", date: "2026-11-20", budgetMinutes: 30, plannedMinutes: 9,
  topics: [{ topicId: "fe.rxjs", name: "RxJS", questions: 3, done: 0 }],
  entries: [0, 1, 2].map((index) => ({ index, topicId: "fe.rxjs", topicName: "RxJS", conceptTitle: "Cold vs hot", relearn: false, minutes: 3, state: "OPEN" as const, final: null })),
  current: q ? { question: q, feedback: null } : null, ...over,
});
const feedback = (over: Partial<SessionFeedback> = {}): SessionFeedback => ({
  responseId: 31, index: 0, format: "CHOICE", mode: "CHOICE", answer: "", correct: false,
  options: [
    { text: "One", correct: false, explanation: "That would be a hot, shared observable.", chosen: true },
    { text: "Two", correct: true, explanation: "Cold: each subscription starts its own request.", chosen: false },
    { text: "It depends", correct: false, explanation: "Not here.", chosen: false },
  ],
  expected: ["cold observables run per subscriber"], modelAnswer: { gist: "Two.", full: "Two. Each subscription starts its own run." }, code: null,
  hints: ["Hot or cold?", "What starts a request?", "One per …"], misconceptions: ["Thinking observables share their producer"],
  evaluation: null, confidence: null, hintsUsed: 0, suggested: 0, suggestedLabel: "Forgot", final: null, ...over,
});

let current: RevisionSessionView = session(question());
let fb: SessionFeedback = feedback();
const startSession = vi.fn(async (_k: string) => current);
const sessionAnswer = vi.fn(async (_id: number, _b: unknown) => fb);
const sessionResult = vi.fn(async (_id: number, _b: unknown) => session(question({ index: 1, itemId: 12, format: "OPEN", kind: "EXPLAIN", question: "Why two requests?", options: [] })));
const sessionHint = vi.fn(async () => ({ index: 0, hintsUsed: 1, hints: ["Hot or cold?"], hintsAvailable: 3 }));
const finishSession = vi.fn(async () => ({
  session: session(null, { status: "FINISHED" }),
  cards: [{ topicId: "fe.rxjs", name: "RxJS", cycle: 2, cycleDone: false, retained: false, nextDueDate: "2026-11-22", weakOnly: true, firstNext: "Cold vs hot",
    results: [{ conceptId: 1, title: "Cold vs hot", result: 2, label: "Recalled", relearned: true }, { conceptId: 2, title: "Subjects", result: 3, label: "Strong recall", relearned: false }] }],
}));
const home: RevisionHome = {
  today: "2026-11-20", budgetMinutes: 30,
  plan: { topics: [{ topicId: "fe.rxjs", name: "RxJS", cycle: 2, questions: 3, minutes: 9 }], questions: 3, minutes: 9, laterToday: 0 },
  activeSession: null,
  needsMaterial: [{ topicId: "fe.ts", name: "TypeScript", district: "Frontend" }],
  tracks: [{ topicId: "fe.rxjs", name: "RxJS", cycle: 1, inProgress: 2, state: "ACTIVE", nextDueDate: "2026-11-20", lastReviewDate: "2026-11-17", weakOnly: false, maintenance: false, due: true, overdue: false, line: "cold vs hot still shaky" }],
  keepGoing: { tomorrow: 1, practice: true },
};
const setMaintenance = vi.fn(async (t: string, on: boolean) => ({ topicId: t, maintenance: on, nextDueDate: on ? "2027-03-01" : null }));
const history: RevisionHistory = {
  topicId: "fe.rxjs", name: "RxJS", track: { cycle: 1, state: "ACTIVE", nextDueDate: "2026-11-20", weakOnly: false }, cycles: [1, 2],
  concepts: [{
    conceptId: 1, title: "Cold vs hot", removed: false, story: "Cold vs hot: struggled in cycle 1, recalled in 2.",
    cells: [
      { cycle: 1, result: 1, label: "Struggled", firstResult: 1, date: "2026-11-17", reviews: 1, answers: [{ id: 1, relearn: false, kind: "EXPLAIN", format: "OPEN", question: "Why two requests?", code: null, answer: "because it is cold", mode: "TYPED", correct: null, evaluation: null, expected: ["cold"], modelAnswer: "Cold: one run per subscriber.", hintsUsed: 1, confidence: 1, final: 1, label: "Struggled", date: "2026-11-17T10:00:00Z" }] },
      { cycle: 2, result: 2, label: "Recalled", firstResult: 2, date: "2026-11-20", reviews: 1, answers: [] },
    ],
  }],
};

vi.mock("../api/client", () => ({
  api: {
    startSession: (k: string) => startSession(k), session: vi.fn(async () => current), sessionAnswer: (id: number, b: unknown) => sessionAnswer(id, b),
    sessionResult: (id: number, b: unknown) => sessionResult(id, b), sessionHint: () => sessionHint(), finishSession: () => finishSession(),
    sessionSkip: vi.fn(), sessionTranscribe: vi.fn(), aiStatus: vi.fn(async () => ({ enabled: false, consented: false })),
    revisionHome: vi.fn(async () => home), revisionHistory: vi.fn(async () => history), report: vi.fn(),
    setMaintenance: (t: string, on: boolean) => setMaintenance(t, on),
    pack: vi.fn(() => new Promise(() => {})),
  },
  ApiError: class extends Error {},
}));
vi.mock("../state/AppData", () => ({ useAppData: () => ({ version: 0, reload: async () => {} }) }));

import { RevisionHome as Home } from "../components/revision/RevisionHome";
import { RevisionToday } from "../components/revision/RevisionToday";
import { Highlighted, Workspace } from "../components/revision/Workspace";

describe("revision workspace", () => {
  beforeEach(() => {
    for (const f of [startSession, sessionAnswer, sessionResult, sessionHint, finishSession]) f.mockClear();
    current = session(question());
    fb = feedback();
  });

  it("asks a multiple-choice question without its answers, checks it, explains, and records the chosen result", async () => {
    render(<Workspace start="PLANNED" onClose={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Two subscribers to one HTTP observable: how many requests?" })).toBeTruthy();
    expect(screen.getByText("Tricky choice · about 1 min")).toBeTruthy();
    expect(screen.queryByText(/Cold: each subscription/)).toBeNull();
    const check = screen.getByRole("button", { name: "Check" }) as HTMLButtonElement;
    expect(check.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /One/ }));
    fireEvent.click(check);
    await waitFor(() => expect(sessionAnswer).toHaveBeenCalledWith(7, expect.objectContaining({ index: 0, mode: "CHOICE", choice: [0] })));
    expect(await screen.findByText("Not quite.")).toBeTruthy();
    expect(screen.getByText("That would be a hot, shared observable.")).toBeTruthy();
    expect(screen.getByText("Cold: each subscription starts its own request.")).toBeTruthy();
    expect(screen.getByText(/Common mix-up:/)).toBeTruthy();
    // The suggestion is preselected; multiple choice offers no Strong recall.
    const group = screen.getByRole("radiogroup", { name: "How did it go?" });
    expect(within(group).getByRole("radio", { name: "Forgot" }).getAttribute("aria-checked")).toBe("true");
    expect(within(group).queryByRole("radio", { name: "Strong recall" })).toBeNull();
    fireEvent.click(within(group).getByRole("radio", { name: "Struggled" }));
    expect(screen.getByText(/one more, easier question on this at the end/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(sessionResult).toHaveBeenCalledWith(7, { responseId: 31, final: 1, modelShown: false }));
    expect(await screen.findByRole("heading", { name: "Why two requests?" })).toBeTruthy();
  });

  it("gives stored hints before answering", async () => {
    render(<Workspace start="PLANNED" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Hint (1 of 3)" }));
    expect(await screen.findByText("Hot or cold?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hint (2 of 3)" })).toBeTruthy();
  });

  it("asks how sure you are before checking an open answer, then shows the points with your words highlighted", async () => {
    current = session(question({ format: "OPEN", kind: "EXPLAIN", question: "Why two requests?", options: [] }));
    fb = feedback({
      format: "OPEN", mode: "TYPED", answer: "Because the observable is cold, each subscriber runs it.", correct: null, options: [], suggested: 2, suggestedLabel: "Recalled",
      evaluation: {
        relevant: true, feedback: "You named coldness; say what starts a request.", suggestedScore: 2, provider: "fake", model: "fake-1", misconceptions: [],
        criteria: [{ index: 0, text: "cold observable", verdict: "COVERED", evidence: "the observable is cold" }, { index: 1, text: "subscribe starts the request", verdict: "MISSING", evidence: null }],
      },
    });
    render(<Workspace start="PLANNED" onClose={() => {}} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Your answer" }), { target: { value: "Because the observable is cold, each subscriber runs it." } });
    const check = screen.getByRole("button", { name: "Check my answer" }) as HTMLButtonElement;
    expect(check.disabled).toBe(true);
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "How sure are you?" })).getByRole("radio", { name: "Fairly" }));
    fireEvent.click(check);
    await waitFor(() => expect(sessionAnswer).toHaveBeenCalledWith(7, expect.objectContaining({ mode: "TYPED", confidence: 2 })));
    expect(await screen.findByText("You named coldness; say what starts a request.")).toBeTruthy();
    expect(document.querySelector("mark")!.textContent).toBe("the observable is cold");
    expect(screen.getByText("Missing")).toBeTruthy();
    // The model answer in layers.
    expect(screen.getByText("Two.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show the full answer" }));
    expect(screen.getByText("Two. Each subscription starts its own run.")).toBeTruthy();
  });

  it("compares code side by side", async () => {
    current = session(question({ format: "OPEN", kind: "DEBUG", code: "obs$.subscribe();\nobs$.subscribe();", question: "Fix the double request.", options: [] }));
    fb = feedback({ format: "OPEN", mode: "CODE", answer: "const shared$ = obs$.pipe(share());", correct: null, options: [], suggested: null, suggestedLabel: null, evaluation: null, aiError: "AI is switched off." });
    render(<Workspace start="PLANNED" onClose={() => {}} />);
    expect((await screen.findByRole("radio", { name: "Code" })).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), { target: { value: "const shared$ = obs$.pipe(share());" } });
    fireEvent.click(screen.getByRole("radio", { name: "Sure" }));
    fireEvent.click(screen.getByRole("button", { name: "Check my answer" }));
    expect(await screen.findByText("Your answer")).toBeTruthy();
    expect(screen.getByText(/Compare with the expected points yourself/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true); // no suggestion: you choose
  });

  it("ends with the completion card and offers to keep going", async () => {
    current = session(null);
    render(<Workspace start="PLANNED" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "See how it went" }));
    expect(await screen.findByRole("heading", { name: "RxJS reviewed · cycle 2 of 6" })).toBeTruthy();
    expect(screen.getByText(/Relearned before you left: Cold vs hot/)).toBeTruthy();
    expect(screen.getByText(/only the shaky concepts/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revise topics due tomorrow (1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Practise your weakest concepts" })).toBeTruthy();
  });

  it("highlights every quote it finds and nothing else", () => {
    const { container } = render(<Highlighted text="A cold observable runs per subscriber." quotes={["cold observable", "not there", ""]} />);
    expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["cold observable"]);
  });
});

describe("revision home and history", () => {
  it("shows today's set, the topics, and those needing material", async () => {
    render(<Home />);
    expect(await screen.findByRole("heading", { name: "1 topic · 3 questions · about 9 min" })).toBeTruthy();
    expect(screen.getByText(/RxJS · cycle 2 of 6/)).toBeTruthy();
    expect(screen.getByText(/cycle 2 of 6 · due today/)).toBeTruthy();
    expect(screen.getByText("cold vs hot still shaky")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prepare revision: TypeScript" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("shows concepts by cycle, the story, and the answers behind a cell", async () => {
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: "History: RxJS" }));
    expect(await screen.findByRole("columnheader", { name: "Cycle 2" })).toBeTruthy();
    expect(screen.getByText("Cold vs hot: struggled in cycle 1, recalled in 2.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cold vs hot, cycle 1: Struggled" }));
    expect(await screen.findByText("because it is cold")).toBeTruthy();
    expect(screen.getByText("Cold: one run per subscriber.")).toBeTruthy();
  });

  it("lets a retained topic be checked every four months", async () => {
    const was = home.tracks;
    home.tracks = [{ ...was[0], state: "RETAINED", cycle: 6, inProgress: 6, due: false, nextDueDate: null, maintenance: false }];
    try {
      render(<Home />);
      fireEvent.click(await screen.findByRole("button", { name: "Check every 4 months" }));
      await waitFor(() => expect(setMaintenance).toHaveBeenCalledWith("fe.rxjs", true));
      expect(screen.getByText(/retained · all six cycles done/)).toBeTruthy();
    } finally {
      home.tracks = was;
    }
  });

  it("shows today's revision on the Today view", async () => {
    const open = vi.fn();
    render(<RevisionToday onOpen={open} />);
    fireEvent.click(await screen.findByRole("button", { name: "Revise now" }));
    expect(open).toHaveBeenCalled();
    expect(screen.getByText("3 questions · about 9 min")).toBeTruthy();
  });
});
