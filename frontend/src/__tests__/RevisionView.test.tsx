/** The Revision tab (docs/Recall-Plan.md §3.1) in glass: the next recall, due today within the limit, waiting, upcoming, recent recalls, the AI notice, the earlier history. */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RecallHome, RevisionArchive } from "../api/types";

const item = (subtopicId: number, subtopic: string, over: Record<string, unknown> = {}) => ({ subtopicId, subtopic, topicId: "fe.rxjs", topic: "RxJS", district: "Frontend", stage: 0, nextDueDate: "2026-11-21", lastReviewDate: null, taskId: subtopicId, scheduledDate: (over.nextDueDate as string) ?? "2026-11-21", overdueDays: 0, ...over });
let home: RecallHome = {
  today: "2026-11-21", limit: 3, doneToday: 1,
  due: [item(1, "Subjects"), item(2, "Operators", { lastReviewDate: "2026-11-19" })],
  later: [item(3, "Schedulers", { nextDueDate: "2026-11-20" })],
  upcoming: [item(4, "Testing", { nextDueDate: "2026-11-25" })],
  open: [{ reviewId: 9, subtopicId: 2, status: "WAITING" }],
  ai: { available: true, reason: null, consented: true, provider: "gwdg", model: "qwen3.5-397b-a17b" },
};
let archive: RevisionArchive = {
  attempts: [{ id: 1, date: "2026-11-19", label: "Generics", topicName: "TypeScript", score: 1, method: "WRITE", withHelp: true, gap: "constraints" }],
  checkpoints: [{ id: 2, date: "2026-11-18", label: "Utility types", topicName: "TypeScript", result: "PARTIAL", gaps: "Pick vs Omit" }],
};
const aiConsent = vi.fn(async () => ({ consentedAt: "x" }));
const postponeRecall = vi.fn(async () => ({ subtopicId: 1, nextDueDate: "2026-11-22" }));
vi.mock("../api/client", () => ({
  api: {
    recallHome: vi.fn(async () => home), revisionArchive: vi.fn(async () => archive), aiConsent: () => aiConsent(), postponeRecall: () => postponeRecall(),
    recallHistory: vi.fn(async () => [{ reviewId: 5, date: "2026-11-20", attempt: 1, score: 0.62, depth: "INTERMEDIATE", outcome: "HOLD", nextDueDate: "2026-11-24", subtopicId: 2, subtopic: "Operators", topic: "RxJS" }]),
    startRecall: vi.fn(() => new Promise(() => {})), aiStatus: vi.fn(() => new Promise(() => {})), recallMatrix: vi.fn(() => new Promise(() => {})),
  },
  ApiError: class extends Error {},
}));
const invalidate = vi.fn(async () => {});
vi.mock("../state/AppData", () => ({ useAppData: () => ({ version: 0, reload: async () => {}, invalidate }) }));

import { RevisionView } from "../components/RevisionView";

describe("Revision tab", () => {
  it("puts the next recall first, then what is due today, what waits for a free day, and the next two weeks", async () => {
    render(<RevisionView />);
    expect(await screen.findByRole("heading", { name: "2 sub-topics to recall today" })).toBeTruthy();
    expect(screen.getByText(/Up to 3 reviews planned a day · 1 done today\./)).toBeTruthy();
    const next = screen.getByRole("region", { name: "Up next" });
    expect(next.textContent).toMatch(/Subjects.*RxJS · Frontend · first recall/);
    expect(within(next).getByRole("button", { name: "Start recall" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revise Subjects" }).textContent).toMatch(/first recall/);
    expect(screen.getByRole("button", { name: "Revise Operators" }).textContent).toMatch(/last recalled 19 Nov.*Being checked/);
    expect(screen.getByRole("button", { name: "Revise Schedulers now" }).textContent).toMatch(/since 20 Nov/);
    // Upcoming ones can be revised early; checked recalls are listed with their result and open their history.
    expect(screen.getByRole("button", { name: "Revise Testing early" }).textContent).toMatch(/25 Nov/);
    expect(screen.getByRole("button", { name: "Recall over time: Operators" }).textContent).toMatch(/20 Nov · Intermediate · partly remembered · next 24 Nov.*62 %/);
  });

  it("with nothing due, shows the next recall and puts the next two weeks first, so no half of the page is empty", async () => {
    const saved = home;
    home = { ...home, due: [], later: [], open: [], upcoming: [item(4, "Testing", { nextDueDate: "2026-11-25" }), item(5, "Guards", { nextDueDate: "2026-11-27" })] };
    try {
      const { container } = render(<RevisionView />);
      expect(await screen.findByRole("heading", { name: "Nothing to recall today" })).toBeTruthy();
      expect(screen.queryByRole("region", { name: "Up next" })).toBeNull();
      const soon = screen.getByRole("region", { name: "Next recall" });
      expect(soon.textContent).toMatch(/Next recall · 25 Nov.*Testing/);
      expect(within(soon).getByRole("button", { name: "Recall Testing early" })).toBeTruthy();
      const [first] = container.querySelectorAll(".g-cols > div");
      expect(first.textContent).toMatch(/Next two weeks.*Testing.*Guards/);
    } finally {
      home = saved;
    }
  });

  it("says when recalls done today go beyond the daily plan", async () => {
    const saved = home;
    home = { ...home, doneToday: 4 };
    try {
      render(<RevisionView />);
      expect(await screen.findByText(/Up to 3 reviews planned a day · 4 done today, 1 extra\./)).toBeTruthy();
    } finally {
      home = saved;
    }
  });

  it("opens the recall page for a sub-topic", async () => {
    render(<RevisionView />);
    // The recall flow is a page with its own address (Back and reload work).
    fireEvent.click(await screen.findByRole("button", { name: "Revise Subjects" }));
    expect(location.hash).toBe("#/recall/1");
    expect(history.state).toMatchObject({ from: expect.any(String) });
  });

  it("starts the next recall from the hero, or puts it off to a free day", async () => {
    render(<RevisionView />);
    const next = await screen.findByRole("region", { name: "Up next" });
    fireEvent.click(within(next).getByRole("button", { name: "Not today: Subjects" }));
    await waitFor(() => expect(postponeRecall).toHaveBeenCalled());
    // Every view refetches (the sidebar's Today card and the tab badge too), not only this list.
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    location.hash = "#/revision";
    fireEvent.click(within(next).getByRole("button", { name: "Start recall" }));
    expect(location.hash).toBe("#/recall/1");
  });

  it("opens recall over time from a recent recall", async () => {
    render(<RevisionView />);
    fireEvent.click(await screen.findByRole("button", { name: "Recall over time: Operators" }));
    expect(location.hash).toBe("#/revision/history/2");
  });

  it("keeps the earlier revision history read-only, folded into one row", async () => {
    render(<RevisionView />);
    const row = await screen.findByRole("button", { name: /Earlier revision/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(row);
    const items = within(screen.getByRole("list", { name: "Earlier revision" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toMatch(/19 Nov · Generics \(TypeScript\) · 1 Struggled · .*with help/);
    expect(items[1]).toMatch(/18 Nov · Utility types \(TypeScript\) · check: .*Gap: Pick vs Omit/);
  });

  it("asks for the AI notice first in a sheet; nothing can start until it is accepted", async () => {
    home = { ...home, ai: { ...home.ai, available: false, reason: "CONSENT_REQUIRED", consented: false } };
    render(<RevisionView />);
    const notice = await screen.findByRole("dialog", { name: "Recall uses AI" });
    expect(within(notice).getByRole("list", { name: "What is sent" }).textContent).toMatch(/Your recording.*never stored.*What you said or typed/);
    expect((screen.getByRole("button", { name: "Revise Subjects", hidden: true }) as HTMLButtonElement).disabled).toBe(true);
    // "Not now" leaves a reminder that reopens it.
    fireEvent.click(within(notice).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog", { name: "Recall uses AI" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Recall uses AI" })).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(aiConsent).toHaveBeenCalled());
  });

  it("explains how revision starts when nothing is in recall yet", async () => {
    home = { ...home, due: [], later: [], upcoming: [], open: [], ai: { ...home.ai, available: true, reason: null } };
    archive = { attempts: [], checkpoints: [] };
    render(<RevisionView />);
    expect(await screen.findByRole("heading", { name: "Nothing to recall today" })).toBeTruthy();
    expect(screen.getByText(/When you tick a sub-topic as learned/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Up next" })).toBeNull();
    expect(screen.queryByText(/Earlier revision/)).toBeNull();
  });
});
