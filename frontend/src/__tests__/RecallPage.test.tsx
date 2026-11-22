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

  it("does not take pasted or dropped text: recall is from memory", async () => {
    render(<RecallPage subtopicId={1} onClose={() => {}} />);
    const box = await screen.findByRole("textbox", { name: "Type what you remember" });
    const pasted = fireEvent.paste(box, { clipboardData: { getData: () => "Observable and observer. Multicasting. Late subscribers." } });
    expect(pasted).toBe(false); // the paste was cancelled
    expect((box as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("status").textContent).toBe("Recall is from memory, so pasting is off here. Type it, or speak instead.");
    expect(fireEvent.drop(box, { dataTransfer: { getData: () => "dropped text" } })).toBe(false);
    // Typing still works.
    fireEvent.change(box, { target: { value: "A Subject is both" } });
    expect((box as HTMLTextAreaElement).value).toBe("A Subject is both");
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

  it("shows the summary on the left and the results as screens, worst first", async () => {
    current = checked();
    render(<RecallPage subtopicId={1} onClose={() => {}} />);
    expect(await screen.findByText("62 %")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Subjects" })).toBeTruthy();
    expect(screen.getByText("Partly remembered: the same gap again.")).toBeTruthy();
    expect(screen.getByText("Next review").closest("li")!.textContent).toMatch(/23 Nov/);
    expect(screen.getByText("Depth").closest("li")!.textContent).toMatch(/Intermediate/);
    expect(screen.getByRole("img", { name: "Of 3 points: 1 remembered · 1 partly · 1 missed" })).toBeTruthy();
    expect(screen.getByText("About this check").closest("details")!.textContent).toMatch(/Checked by qwen3.5-397b-a17b against 3 points/);
    // Every screen is named with what it holds, so nothing hides behind Next.
    const steps = within(screen.getByRole("navigation", { name: "Result screens" })).getAllByRole("button");
    expect(steps.map((b) => b.getAttribute("aria-label"))).toEqual(["To correct: 1 idea", "Partly: 1 point", "Missed: 1 point", "Remembered: 1 point"]);
    expect(steps[0].getAttribute("aria-current")).toBe("step");
    // 1 · what to correct
    expect(within(screen.getByRole("region", { name: "To correct" })).getByRole("list", { name: "Misconceptions" }).textContent)
      .toMatch(/You said“a Subject replays old values”CorrectOnly a ReplaySubject or BehaviorSubject does\./);
    // 2 · partly: your words, then the complete point
    fireEvent.click(screen.getByRole("button", { name: /Next: Partly/ }));
    const partly = within(screen.getByRole("region", { name: "Partly" })).getByRole("listitem", { name: "Multicasting: Partly" });
    expect(within(partly).getByText("“it shares”")).toBeTruthy();
    expect(within(partly).getByText("The complete point")).toBeTruthy();
    expect(within(partly).getByText("One execution for all subscribers.")).toBeTruthy();
    // 3 · missed, from the step bar
    fireEvent.click(screen.getByRole("button", { name: "Missed: 1 point" }));
    const missed = within(screen.getByRole("region", { name: "Missed" })).getByRole("listitem", { name: "Late subscribers: Missed" });
    expect(missed.textContent).toMatch(/Late subscribersEdge cases.*They miss earlier values\./);
    expect(screen.getByText(/they come back on 23 Nov/)).toBeTruthy();
    // 4 · remembered, with the arrow key; the last screen has no Next
    fireEvent.keyDown(screen.getByRole("region", { name: "Missed" }), { key: "ArrowRight" });
    expect(within(screen.getByRole("region", { name: "Remembered" })).getByText("“it is both an observable and an observer”")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Next/ })).toBeNull();
    expect(screen.getByText("4 of 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("region", { name: "Missed" })).toBeTruthy();
    // There is nothing to grade yourself with.
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("leaves out screens with nothing in them: an answer that matched nothing shows what was missed and the answer itself", async () => {
    const c = checked();
    c.result!.misconceptions = [];
    for (const p of c.result!.points) Object.assign(p, { status: "MISSED", evidence: null });
    c.result!.answer = { text: "dsyof wedufio wefhs", spans: [], uncovered: [{ start: 0, end: 19 }] };
    current = c;
    render(<RecallPage subtopicId={1} onClose={() => {}} />);
    const steps = within(await screen.findByRole("navigation", { name: "Result screens" })).getAllByRole("button");
    expect(steps.map((b) => b.getAttribute("aria-label"))).toEqual(["Missed: 3 points", "Your answer"]);
    expect(within(screen.getByRole("region", { name: "Missed" })).getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /Next: Your answer/ }));
    expect(screen.getByText("Nothing in your answer matched a point yet.")).toBeTruthy();
    // Open at once, with nothing to highlight.
    expect(screen.getByLabelText("Your whole answer").textContent).toBe("dsyof wedufio wefhs");
    expect(document.querySelector(".cmp-key")).toBeNull();
  });

  it("shows your own words from the graded text, mistakes underlined, and the whole answer highlighted", async () => {
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
    fireEvent.click(await screen.findByRole("button", { name: "Partly: 1 point" }));
    const multicasting = screen.getByRole("listitem", { name: "Multicasting: Partly" });
    // The stretch of the learner's text, not the grader's copy of it; the mistake inside it is marked.
    expect(within(multicasting).getByText(/it shares\. But/).closest("p")!.textContent).toBe("“it shares. But a Subject replays old values”");
    expect(multicasting.querySelector("mark.cmp-wrong")!.textContent).toBe("a Subject replays old values");
    fireEvent.click(screen.getByRole("button", { name: "Remembered: 1 point" }));
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
    c.result!.points[1].statement = "A Subject runs one execution and shares it with every subscriber.";
    current = c;
    render(<RecallPage subtopicId={1} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Partly: 1 point" }));
    const partly = screen.getByRole("listitem", { name: "Multicasting: Partly" });
    expect(within(partly).getByText("A Subject runs one execution and shares it with every subscriber.")).toBeTruthy();
    expect(within(partly).queryByText("One execution for all subscribers.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Missed: 1 point" }));
    expect(within(screen.getByRole("listitem", { name: "Late subscribers: Missed" })).getByText("They miss earlier values.")).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Missed: 1 point" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Missed: 1 point" }));
    fireEvent.click(screen.getByRole("button", { name: "Options for Late subscribers" }));
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
