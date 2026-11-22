/** One recall (docs/Recall-Plan.md §3.2–§3.3) in glass: the blank slate, checking, results that reveal the checklist, the follow-up and the verdict. */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecallReview } from "../api/types";

const draft = (over: Partial<RecallReview> = {}): RecallReview => ({
  id: 7, subtopicId: 1, subtopic: "Subjects", topicId: "fe.rxjs", topic: "RxJS", attempt: 1, status: "DRAFT", date: "2026-11-21",
  spokenParts: [], typed: "", sketches: [], waitReason: null, language: "en", submittedAt: null, result: null,
  followupQuestion: null, followupAnswer: null, seniorVerdict: null, ...over,
});
const checked = (): RecallReview => draft({
  status: "CHECKED",
  result: {
    score: 0.62, depth: "INTERMEDIATE", outcome: "HOLD", stageBefore: 2, stageAfter: 2, nextDueDate: "2026-11-23", tierShares: [1, 0.75, 0], gradingModel: "qwen3.5-397b-a17b",
    misconceptions: [{ claim: "a Subject replays old values", correction: "Only a ReplaySubject or BehaviorSubject does." }],
    points: [
      { id: 1, code: "c1", label: "Observable and observer", description: "A Subject is both.", tier: 1, leftOut: false, status: "ACCURATE", evidence: "it is both an observable and an observer", recalledWhenAsked: false },
      { id: 2, code: "c2", label: "Multicasting", description: "One execution for all subscribers.", tier: 2, leftOut: false, status: "PARTIAL", evidence: "it shares", recalledWhenAsked: false },
      { id: 3, code: "c3", label: "Late subscribers", description: "They miss earlier values.", tier: 3, leftOut: false, status: "MISSED", evidence: null, recalledWhenAsked: false },
    ],
  },
});

let current = draft();
const submitRecall = vi.fn(async () => (current = draft({ status: "WAITING", typed: current.typed })));
const saveRecallTyped = vi.fn(async (_id: number, typed: string) => (current = draft({ typed })));
const verdict = { foundationsSummary: "You know what a Subject is.", architectureAndEdgeCasesSummary: "Late subscribers came only when asked.", focusNext: "Revise replay behaviour.", cuedReasoningRating: "Strong" as const, recalledWhenAsked: ["Late subscribers"], promptVersion: "recall-verdict-v1", model: "m" };
const completeRecall = vi.fn(async () => (current = { ...current, status: "COMPLETE" as const, seniorVerdict: verdict }));
const probeRecall = vi.fn(async () => (current = { ...current, followupQuestion: "A component subscribes after two values were emitted: what does it see, and how would you change that?" }));
const answerFollowup = vi.fn(async (_id: number, answer: string) => {
  const c = checked();
  c.result!.points[2].recalledWhenAsked = true;
  return (current = { ...current, followupAnswer: answer, result: c.result });
});
const addSketch = vi.fn(async () => (current = { ...current, sketches: ["Box: Subject", "Arrow: Subject → Sub A"] }));
const leaveOutPoint = vi.fn(async () => ({ review: null }));
const postponeRecall = vi.fn(async () => ({ subtopicId: 1, nextDueDate: "2026-11-22" }));
vi.mock("../api/client", () => ({
  api: {
    startRecall: vi.fn(async () => current), recallReview: vi.fn(async () => current), aiStatus: vi.fn(async () => ({ enabled: true, consented: true, maxRecordingSeconds: 120, maxAudioBytes: 4_000_000 })),
    saveRecallTyped: (id: number, t: string) => saveRecallTyped(id, t), submitRecall: () => submitRecall(), completeRecall: () => completeRecall(),
    leaveOutPoint: () => leaveOutPoint(), postponeRecall: () => postponeRecall(), retryRecall: vi.fn(), removeRecallPart: vi.fn(), addRecallPart: vi.fn(),
    probeRecall: () => probeRecall(), answerFollowup: (id: number, a: string) => answerFollowup(id, a), transcribeFollowup: vi.fn(), addSketch: () => addSketch(), removeSketch: vi.fn(),
  },
  ApiError: class extends Error {},
}));

import { RecallPage } from "../components/recall/RecallPage";

describe("recall page", () => {
  beforeEach(() => {
    current = draft();
    for (const f of [submitRecall, saveRecallTyped, completeRecall, leaveOutPoint, postponeRecall, probeRecall, answerFollowup, addSketch]) f.mockClear();
  });

  it("starts as a blank slate: the sub-topic, how it works and neutral prompts on request, never the checklist", async () => {
    render(<RecallPage subtopicId={1} onClose={() => {}} />);
    expect(await screen.findByRole("heading", { name: "What do you remember about Subjects?" })).toBeTruthy();
    expect(screen.getByText("1 of 3 · Recall")).toBeTruthy();
    expect(screen.queryByText("Where does it get tricky?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Stuck\? Show prompts/ }));
    expect(screen.getByText("Where does it get tricky?")).toBeTruthy();
    expect(screen.queryByText(/Multicasting|Late subscribers/)).toBeNull();
    // A few words are needed before it can be checked.
    expect((screen.getByRole("button", { name: "Check my recall" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends what was typed and follows the check until the results", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<RecallPage subtopicId={1} onClose={() => {}} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Type what you remember" }), { target: { value: "A Subject is both an observable and an observer, it shares one execution" } });
    fireEvent.click(screen.getByRole("button", { name: "Check my recall" }));
    await waitFor(() => expect(saveRecallTyped).toHaveBeenCalledWith(7, expect.stringContaining("observable and an observer")));
    expect(await screen.findByRole("heading", { name: "Checking your recall" })).toBeTruthy();
    expect(screen.getByText("2 of 3 · Check")).toBeTruthy();
    current = checked();
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(await screen.findByText("62 %")).toBeTruthy();
    vi.useRealTimers();
  });

  it("shows the results: score, depth, next date, misconceptions, and the checklist with the learner's own words", async () => {
    current = checked();
    render(<RecallPage subtopicId={1} onClose={() => {}} />);
    expect(await screen.findByText("62 %")).toBeTruthy();
    expect(screen.getByText("Intermediate")).toBeTruthy();
    expect(screen.getByText(/partly remembered: the same gap again/)).toBeTruthy();
    expect(screen.getByText("Next review").closest("li")!.textContent).toMatch(/23 Nov/);
    expect(screen.getByRole("group", { name: "Misconceptions" }).textContent).toMatch(/You said “a Subject replays old values”. Only a ReplaySubject/);
    // One row per point, by tier: your words next to the complete point; a missed point leaves an empty slot.
    const row = (label: string) => screen.getByRole("listitem", { name: new RegExp(`^${label}:`) });
    expect(within(screen.getByRole("region", { name: "Definition" })).getByRole("listitem", { name: "Observable and observer: Remembered" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "How it works" })).getByRole("listitem", { name: "Multicasting: Partly" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Edge cases" })).getByRole("listitem", { name: "Late subscribers: Missed" })).toBeTruthy();
    // A review from before the answer came along still shows the grader's quote.
    expect(within(row("Observable and observer")).getByText("“it is both an observable and an observer”")).toBeTruthy();
    expect(within(row("Late subscribers")).getByText("Missed: not in your answer")).toBeTruthy();
    expect(within(row("Late subscribers")).getByText("They miss earlier values.")).toBeTruthy();
    expect(within(row("Multicasting")).getByText("The full point")).toBeTruthy();
    expect(screen.getAllByText("To learn")).toHaveLength(2);
    expect(screen.getByRole("list", { name: "Summary" }).textContent).toBe("1 remembered1 partly1 missed");
    expect(screen.queryByRole("region", { name: "Also in your answer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show your whole answer" })).toBeNull();
    // There is nothing to grade yourself with.
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("shows your own words from the graded text, mistakes underlined, and what matched no point", async () => {
    const text = "A Subject: it is both an observable and an observer. And it shares. But a Subject replays old values to new subscribers.\n\nWe used them in the chat service for typing indicators and presence.";
    const at = (q: string) => ({ start: text.indexOf(q), end: text.indexOf(q) + q.length });
    const c = checked();
    c.result!.answer = {
      text,
      spans: [
        { kind: "point", pointId: 1, ...at("it is both an observable and an observer") },
        { kind: "point", pointId: 2, ...at("it shares. But a Subject replays old values") },
        { kind: "claim", index: 0, ...at("a Subject replays old values") },
      ],
      uncovered: [at("We used them in the chat service for typing indicators and presence.")],
    };
    current = c;
    render(<RecallPage subtopicId={1} onClose={() => {}} />);
    const multicasting = await screen.findByRole("listitem", { name: "Multicasting: Partly" });
    // The stretch of the learner's text, not the grader's copy of it; the mistake inside it is marked.
    expect(within(multicasting).getByText(/it shares\. But/).closest("p")!.textContent).toBe("“it shares. But a Subject replays old values”");
    expect(multicasting.querySelector("mark.cmp-wrong")!.textContent).toBe("a Subject replays old values");
    // Whole sentences with none of the matched words in them.
    expect(within(screen.getByRole("region", { name: "Also in your answer" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "We used them in the chat service for typing indicators and presence.",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Show your whole answer" }));
    const whole = screen.getByLabelText("Your whole answer");
    expect(whole.textContent).toBe(text);
    expect([...whole.querySelectorAll("mark")].map((m) => [m.className, m.textContent])).toEqual([
      ["cmp-hit ok", "it is both an observable and an observer"],
      ["cmp-hit part", "it shares. But "],
      ["cmp-hit part cmp-wrong", "a Subject replays old values"],
    ]);
  });

  it("shows a point's statement once written, else its description", async () => {
    const c = checked();
    c.result!.points[0].statement = "A Subject is both an observable and an observer.";
    current = c;
    render(<RecallPage subtopicId={1} onClose={() => {}} />);
    const first = await screen.findByRole("listitem", { name: "Observable and observer: Remembered" });
    expect(within(first).getByText("A Subject is both an observable and an observer.")).toBeTruthy();
    expect(within(first).queryByText("A Subject is both.")).toBeNull();
    expect(within(screen.getByRole("listitem", { name: "Multicasting: Partly" })).getByText("One execution for all subscribers.")).toBeTruthy();
  });

  it("cuts a long unmatched sentence at a word; the whole answer keeps all of it", async () => {
    const text = `${"lorem ipsum dolor ".repeat(30)}end`;
    const c = checked();
    c.result!.answer = { text, spans: [], uncovered: [{ start: 0, end: text.length }] };
    current = c;
    render(<RecallPage subtopicId={1} onClose={() => {}} />);
    const passage = within(await screen.findByRole("region", { name: "Also in your answer" })).getByRole("listitem").textContent!;
    expect(passage.length).toBeLessThanOrEqual(241);
    expect(passage).toMatch(/^lorem ipsum .* (lorem|ipsum|dolor)…$/);
    fireEvent.click(screen.getByRole("button", { name: "Show your whole answer" }));
    expect(screen.getByLabelText("Your whole answer").textContent).toBe(text);
  });

  it("focuses on the gaps when asked, remembers it, and jumps to a gap from the summary", async () => {
    localStorage.removeItem("bp.recall.focusGaps");
    current = checked();
    const first = render(<RecallPage subtopicId={1} onClose={() => {}} />);
    const toggle = await screen.findByRole("button", { name: "Focus on gaps" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show all" }).getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".cmp")!.classList.contains("focus")).toBe(true);
    first.unmount();
    render(<RecallPage subtopicId={1} onClose={() => {}} />);
    expect(await screen.findByRole("button", { name: "Show all" })).toBeTruthy();
    // The gap links: each goes to its row.
    const gaps = screen.getByText("Gaps:").parentElement!;
    fireEvent.click(within(gaps).getByRole("button", { name: "Late subscribers" }));
    const target = screen.getByRole("listitem", { name: "Late subscribers: Missed" });
    expect(document.activeElement).toBe(target);
    expect(target.classList.contains("pulse")).toBe(true);
    expect(within(gaps).queryByRole("button", { name: "Observable and observer" })).toBeNull();
    localStorage.removeItem("bp.recall.focusGaps");
  });

  it("then the senior engineer asks about the gaps; an answer marks points recalled when asked; the verdict closes it", async () => {
    current = checked();
    const onClose = vi.fn();
    render(<RecallPage subtopicId={1} onClose={onClose} />);
    // The question is written while the results show, then the follow-up is its own step.
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to the follow-up" }) as HTMLButtonElement).disabled).toBe(false));
    expect(probeRecall).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Continue to the follow-up" }));
    expect(screen.getByRole("heading", { name: /A component subscribes after two values were emitted/ })).toBeTruthy();
    expect(screen.getByText("3 of 3 · Follow-up")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Your answer to the follow-up" }), { target: { value: "It misses them; a ReplaySubject or BehaviorSubject would replay." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    await waitFor(() => expect(answerFollowup).toHaveBeenCalledWith(7, expect.stringContaining("ReplaySubject")));
    expect(await screen.findByText(/Recalled when asked:/)).toBeTruthy();
    expect(screen.getByText("Recalled when asked")).toBeTruthy();
    // The score is what was recalled alone.
    expect(screen.getByText("62 %")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "See the verdict" }));
    const v = await screen.findByRole("group", { name: "Senior engineer's verdict" });
    expect(v.textContent).toMatch(/Foundations.*You know what a Subject is/);
    expect(v.textContent).toMatch(/Focus next.*Revise replay behaviour/);
    expect(screen.getByRole("img", { name: "Reasoning when asked: Strong" })).toBeTruthy();
    expect(screen.getByText("↑ Late subscribers")).toBeTruthy();
    // The results stay one tap away.
    fireEvent.click(screen.getByRole("button", { name: "See the results" }));
    expect(screen.getByText("↑ recalled when asked")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "See the verdict" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("lets the follow-up be skipped: the verdict is written from the unprompted recall", async () => {
    current = checked();
    render(<RecallPage subtopicId={1} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Finish without it" }));
    await waitFor(() => expect(completeRecall).toHaveBeenCalled());
    expect(answerFollowup).not.toHaveBeenCalled();
    expect(await screen.findByRole("group", { name: "Senior engineer's verdict" })).toBeTruthy();
  });

  it("can also skip from the follow-up itself", async () => {
    current = checked();
    render(<RecallPage subtopicId={1} onClose={() => {}} />);
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to the follow-up" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue to the follow-up" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip & finish" }));
    await waitFor(() => expect(completeRecall).toHaveBeenCalled());
    expect(await screen.findByRole("group", { name: "Senior engineer's verdict" })).toBeTruthy();
  });

  it("adds a sketch on the blank slate and shows what was read from it", async () => {
    render(<RecallPage subtopicId={1} onClose={() => {}} />);
    await screen.findByRole("heading", { name: "What do you remember about Subjects?" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([0x89, 0x50])], "board.png", { type: "image/png" })] } });
    await waitFor(() => expect(addSketch).toHaveBeenCalled());
    expect(await screen.findByText(/Box: Subject/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Your sketches, as read" })).toBeTruthy();
  });

  it("can leave a point out from its menu, and put a sub-topic off to tomorrow", async () => {
    current = checked();
    const first = render(<RecallPage subtopicId={1} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Options for Late subscribers" }));
    fireEvent.click(screen.getByRole("button", { name: /Not part of this sub-topic/ }));
    await waitFor(() => expect(leaveOutPoint).toHaveBeenCalled());
    first.unmount();
    current = draft();
    const onClose = vi.fn();
    render(<RecallPage subtopicId={1} onClose={onClose} />);
    fireEvent.click(await screen.findByRole("button", { name: "Not today" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(postponeRecall).toHaveBeenCalled();
  });

  it("goes back to Revision from the step bar", async () => {
    const onClose = vi.fn();
    render(<RecallPage subtopicId={1} onClose={onClose} />);
    const bar = (await screen.findByText("1 of 3 · Recall")).closest("header") as HTMLElement;
    fireEvent.click(within(bar).getByRole("button", { name: "Back to Revision" }));
    expect(onClose).toHaveBeenCalled();
  });
});
