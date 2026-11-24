/** Step 1: a syllabus or YouTube timestamps pasted as they are, saved through the same plan-file upload. */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GoalStep } from "../components/cities/create/Steps";

const timestamps = "00:00:00 | Introduction\n00:27:14 | let, const and var\n01:14:46 | Closures\n02:03:10 | Promises";
const props = (over = {}) => ({
  brief: "Revise JavaScript", onBrief: () => {}, files: [], onAddFiles: vi.fn(), onRemoveFile: () => {}, uploading: false,
  canSpeak: false, onSpeakWithoutConsent: () => {}, transcribe: async () => ({ text: "" }), aiOff: false, busy: false, error: null, onContinue: () => {}, ...over,
});

describe("pasting a plan", () => {
  it("adds the pasted text as a plain-text plan file", async () => {
    const p = props();
    render(<GoalStep {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Paste syllabus or timestamps/ }));
    const add = screen.getByRole("button", { name: "Add as plan" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true); // too short to be read as a plan
    fireEvent.change(screen.getByLabelText("Paste syllabus or timestamps"), { target: { value: timestamps } });
    fireEvent.click(add);
    const [[files]] = p.onAddFiles.mock.calls as unknown as [[File[]]];
    expect(files[0].name).toBe("Pasted plan.txt");
    expect(files[0].type).toBe("text/plain");
    const read = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(files[0]); });
    expect(read).toBe(timestamps);
  });

  it("names a second paste apart, and goes away at three plan files", () => {
    const file = (id: number, name: string) => ({ id, name, mimeType: "text/plain", size: 10, pages: null, chars: 100, hasText: true });
    const { unmount } = render(<GoalStep {...props({ files: [file(1, "Pasted plan.txt")] })} />);
    fireEvent.click(screen.getByRole("button", { name: /Paste syllabus or timestamps/ }));
    unmount();
    render(<GoalStep {...props({ files: [file(1, "a.pdf"), file(2, "b.txt"), file(3, "Pasted plan.txt")] })} />);
    expect(screen.queryByRole("button", { name: /Paste syllabus or timestamps/ })).toBeNull();
  });
});
