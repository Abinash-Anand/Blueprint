/** Semantic status rendering (LLD §4.4): every tone renders from backend metadata, with a label, never by colour alone. */
import { act, render, renderHook, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Presentation, Tone } from "../api/types";
import { FeedbackMessage, LoadingState, StatusBadge, StatusIndicator, toneOf, variantOf } from "../components/Status";
import { useAnimatedNumber, useExit } from "../lib/motion";
import { WEAK, pres } from "./fixtures";

const TONES: Tone[] = ["success", "warning", "danger", "info", "neutral", "ai"];

describe("StatusBadge", () => {
  it("renders every semantic tone with its label, icon and state", () => {
    for (const tone of TONES) {
      const { container, unmount } = render(<StatusBadge p={{ ...pres(`x.${tone}`, tone, `Label ${tone}`), icon: "check" }} />);
      const b = container.querySelector(".sb")!;
      expect(b).toHaveClass(`t-${tone}`, "v-soft");
      expect(b).toHaveAttribute("data-state", `x.${tone}`);
      expect(b).toHaveTextContent(`Label ${tone}`);
      expect(b.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      unmount();
    }
  });

  it("renders each variant", () => {
    for (const variant of ["solid", "soft", "outline", "plain"] as const) {
      const { container, unmount } = render(<StatusBadge p={{ ...pres("x", "success", "Done"), variant }} />);
      expect(container.querySelector(".sb")).toHaveClass(`v-${variant}`);
      unmount();
    }
  });

  it("falls back safely for unknown or missing metadata", () => {
    expect(toneOf("purple")).toBe("neutral");
    expect(toneOf(undefined)).toBe("neutral");
    expect(variantOf("glow")).toBe("soft");
    const { container } = render(<StatusBadge p={{ state: "new.state", tone: "chartreuse" as Tone, variant: "glow" as never, icon: "unknown-icon", label: "Something new" }} />);
    const b = container.querySelector(".sb")!;
    expect(b).toHaveClass("t-neutral", "v-soft");
    expect(b).toHaveTextContent("Something new");
    expect(b.querySelector("svg")).toBeNull(); // unknown icon: label only
    render(<StatusBadge fallback="2 days overdue" />);
    expect(screen.getByText("2 days overdue").closest(".sb")).toHaveClass("t-neutral", "v-plain");
    const empty = render(<StatusBadge />);
    expect(empty.container.innerHTML).toBe("");
  });

  it("shows flags next to the primary state, and detail text", () => {
    render(<StatusIndicator p={pres("revision.overdue", "danger", "2 days overdue", [WEAK])} detail="due 16 Nov" />);
    expect(screen.getByText("2 days overdue").closest(".sb")).toHaveClass("t-danger");
    expect(screen.getByText("Weak").closest(".sb")).toHaveClass("t-warning");
    expect(screen.getByText("due 16 Nov")).toBeInTheDocument();
  });
});

describe("feedback and loading", () => {
  it("announces errors at once and other feedback politely", () => {
    render(<FeedbackMessage tone="danger">The AI check failed.</FeedbackMessage>);
    expect(screen.getByRole("alert")).toHaveTextContent("The AI check failed.");
    render(<FeedbackMessage tone="success">Recorded.</FeedbackMessage>);
    expect(screen.getByRole("status")).toHaveTextContent("Recorded.");
  });

  it("shows a loading state as a live status", () => {
    render(<LoadingState tone="ai" text="Transcribing your answer…" />);
    const s = screen.getByRole("status");
    expect(s).toHaveTextContent("Transcribing your answer…");
    expect(s).toHaveClass("t-ai");
    expect(s).toHaveAttribute("aria-live", "polite");
  });
});

describe("motion", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const media = (reduce: boolean) => vi.fn((q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));

  it("closes at once with reduced motion, and after a short exit otherwise (never blocking input)", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", media(true));
    const onClose = vi.fn();
    const a = renderHook(() => useExit(onClose));
    act(() => a.result.current.close());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(a.result.current.leaving).toBe(false);

    vi.stubGlobal("matchMedia", media(false));
    const onClose2 = vi.fn();
    const b = renderHook(() => useExit(onClose2, 180));
    act(() => b.result.current.close());
    expect(b.result.current.leaving).toBe(true);
    expect(onClose2).not.toHaveBeenCalled();
    act(() => b.result.current.close()); // a second click does not schedule a second close
    act(() => vi.advanceTimersByTime(180));
    expect(onClose2).toHaveBeenCalledTimes(1);
  });

  it("does not animate numbers with reduced motion", () => {
    vi.stubGlobal("matchMedia", media(true));
    const h = renderHook(({ v }) => useAnimatedNumber(v), { initialProps: { v: 10 } });
    h.rerender({ v: 40 });
    expect(h.result.current).toBe(40);
  });

  it("defines central motion tokens and turns them off for reduced motion", () => {
    const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
    for (const t of ["--dur-fast", "--dur-base", "--dur-slow", "--ease-standard", "--lift-1", "--focus-ring"]) expect(css).toContain(`${t}:`);
    for (const t of TONES) expect(css).toContain(`.t-${t}{`);
    const reduced = css.match(/@media \(prefers-reduced-motion:reduce\)\{\s*:root:not\(\[data-motion="full"\]\)\{([^}]*)\}/);
    expect(css).toMatch(/:root\[data-motion="reduce"\]\{--dur-fast:0ms/); // the account setting forces it too
    expect(reduced?.[1]).toContain("--dur-fast:0ms");
    expect(reduced?.[1]).toContain("--lift-1:0px");
    // No status colours are hard-coded per component: badges read the tone variables only.
    expect(css).not.toMatch(/\.rv-v\.(ok|part|bad)/);
  });
});

it("renders a presentation exactly as given (the frontend does not reclassify)", () => {
  const p: Presentation = { state: "stage.delayed", tone: "danger", variant: "soft", icon: "alert-circle", label: "Delayed by 3 days" };
  render(<StatusBadge p={p} />);
  expect(screen.getByText("Delayed by 3 days").closest(".sb")).toHaveAttribute("data-state", "stage.delayed");
});

it("lets a stale error message be dismissed", () => {
  const onDismiss = vi.fn();
  render(<FeedbackMessage tone="danger" onDismiss={onDismiss}>Your recording couldn't be transcribed.</FeedbackMessage>);
  screen.getByRole("button", { name: "Dismiss message" }).click();
  expect(onDismiss).toHaveBeenCalledTimes(1);
});
