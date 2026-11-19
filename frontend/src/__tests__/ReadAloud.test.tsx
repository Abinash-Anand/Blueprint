/** The read-aloud player: play, pause, resume, stop, speed, and one text at a time. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadAloud } from "../components/voice/ReadAloud";

const synth = { speak: vi.fn(), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn() };
let last: { text: string; rate: number; onend?: () => void } | null = null;

beforeEach(() => {
  Object.values(synth).forEach((f) => f.mockClear());
  (window as unknown as { speechSynthesis: typeof synth }).speechSynthesis = synth;
  (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
    rate = 1; lang = ""; onend?: () => void; onerror?: () => void;
    constructor(public text: string) { last = this as never; }
  };
  localStorage.clear();
});
afterEach(() => {
  delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  delete (globalThis as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
});

describe("ReadAloud", () => {
  it("reads, pauses, resumes and stops", () => {
    render(<ReadAloud text="Explain generics." what="the question" />);
    fireEvent.click(screen.getByRole("button", { name: "Read the question aloud" }));
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(last?.text).toBe("Explain generics.");
    expect(screen.getByText("Reading…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pause reading" }));
    expect(synth.pause).toHaveBeenCalled();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume reading" }));
    expect(synth.resume).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stop reading" }));
    expect(synth.cancel).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Read the question aloud" })).toBeInTheDocument();
  });

  it("returns to its start state when the text has been read", () => {
    render(<ReadAloud text="Short." />);
    fireEvent.click(screen.getByRole("button", { name: "Read this aloud" }));
    act(() => last?.onend?.());
    expect(screen.getByRole("button", { name: "Read this aloud" })).toBeInTheDocument();
  });

  it("remembers the speed and applies it", () => {
    render(<ReadAloud text="Explain generics." />);
    fireEvent.click(screen.getByRole("button", { name: "Read this aloud" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Reading speed" }), { target: { value: "1.25" } });
    expect(last?.rate).toBe(1.25); // restarted at the new speed
    expect(localStorage.getItem("blueprint.speechRate")).toBe("1.25");
  });

  it("reads one text at a time: starting another stops the first", () => {
    render(<><ReadAloud text="First." what="the question" /><ReadAloud text="Second." what="the feedback" /></>);
    fireEvent.click(screen.getByRole("button", { name: "Read the question aloud" }));
    fireEvent.click(screen.getByRole("button", { name: "Read the feedback aloud" }));
    expect(screen.getAllByText("Reading…")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Read the question aloud" })).toBeInTheDocument();
  });

  it("is hidden where the browser cannot speak", () => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    const { container } = render(<ReadAloud text="x" />);
    expect(container).toBeEmptyDOMElement();
  });
});
