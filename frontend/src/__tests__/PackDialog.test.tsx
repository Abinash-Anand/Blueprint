import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackConcept, PackItem, PackOverview } from "../api/types";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const base = (over: Partial<PackOverview> = {}): PackOverview => ({
  topicId: "fe.rxjs",
  ai: { available: true, reason: null, consented: true, provider: "gwdg", model: "qwen3.5-397b-a17b" },
  limits: { maxFiles: 6, maxBytes: 5 * 1024 * 1024, maxChars: 100000, types: ["application/pdf", "text/plain", "text/markdown", "text/html", DOCX] },
  materials: [], pack: null, building: null, failed: null, ...over,
});
const concept = (over: Partial<PackConcept> = {}): PackConcept => ({
  id: 1, position: 0, title: "Cold vs hot", summary: "Cold observables start per subscriber.", subtopicId: 3, subtopicName: "Observables",
  keyPoints: ["k"], misconceptions: ["m"], source: "AI", status: "READY", removed: false,
  questions: { total: 12, open: 6, choice: 6, levels: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2 } }, ...over,
});
const ready = (concepts: PackConcept[]) => base({
  materials: [{ id: 4, name: "rxjs.md", mimeType: "text/markdown", size: 900, pages: null, chars: 880, hasText: true, preview: "", createdAt: "" }],
  pack: { id: 2, version: 1, status: "READY", basis: "MATERIAL", language: "en", provider: "gwdg", model: "qwen3.5-397b-a17b", promptVersion: "revision-pack-v1", createdAt: "", completedAt: "", progress: null, error: null, stale: false, concepts },
});
const item: PackItem = {
  id: 9, conceptId: 1, level: 2, kind: "TRICKY_CHOICE", format: "CHOICE", situation: "", code: null,
  question: "Two subscribers to one HTTP observable: how many requests?", answerSize: "pick one", expected: ["cold: one per subscriber"],
  modelAnswer: "Two.", hints: ["Hot or cold?", "What starts a request?", "One per …"], source: "AI", removed: false,
  options: [{ text: "One", correct: false, explanation: "That would be hot." }, { text: "Two", correct: true, explanation: "Cold." }, { text: "It depends", correct: false, explanation: "Not here." }],
};

let overview: PackOverview = base();
const pack = vi.fn(async (_t: string) => overview);
const addMaterial = vi.fn(async (_t: string, _d: Blob, _n: string, _type: string) => ({}));
const buildPack = vi.fn(async (_t: string, _b: string) => ({ version: 1, status: "BUILDING", basis: "MATERIAL" }));
const patchConcept = vi.fn(async (_id: number, _b: unknown) => ({}));
const conceptItems = vi.fn(async (_id: number) => [item]);
const patchItem = vi.fn(async (_id: number, _b: unknown) => ({}));
const aiConsent = vi.fn(async () => ({ consentedAt: "" }));
vi.mock("../api/client", () => ({
  api: {
    pack: (t: string) => pack(t), addMaterial: (t: string, d: Blob, n: string, ty: string) => addMaterial(t, d, n, ty),
    buildPack: (t: string, b: string) => buildPack(t, b), patchConcept: (id: number, b: unknown) => patchConcept(id, b),
    conceptItems: (id: number) => conceptItems(id), patchItem: (id: number, b: unknown) => patchItem(id, b), aiConsent: () => aiConsent(),
    removeMaterial: vi.fn(), deletePack: vi.fn(), addConcept: vi.fn(),
  },
  ApiError: class extends Error {},
}));

import { PackDialog, PackEntry, materialType } from "../components/revision/PackDialog";

describe("revision pack", () => {
  beforeEach(() => {
    for (const f of [pack, addMaterial, buildPack, patchConcept, conceptItems, patchItem, aiConsent]) f.mockClear();
    overview = base();
  });

  it("asks what was studied, keeps pasted notes as text, and builds from them", async () => {
    render(<PackDialog topicId="fe.rxjs" topicName="RxJS" onClose={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Before you revise RxJS: what did you study?" })).toBeTruthy();
    const build = screen.getByRole("button", { name: "Build my revision" }) as HTMLButtonElement;
    expect(build.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Paste a list or your notes" }), { target: { value: "Observables, subscriptions, cold vs hot, Subject and BehaviorSubject." } });
    overview = base({ materials: [{ id: 1, name: "Pasted notes", mimeType: "text/plain", size: 70, pages: null, chars: 70, hasText: true, preview: "", createdAt: "" }] });
    fireEvent.click(screen.getByRole("button", { name: "Add these notes" }));
    await waitFor(() => expect(addMaterial).toHaveBeenCalledWith("fe.rxjs", expect.any(Blob), "Pasted notes", "text/plain; charset=utf-8"));
    await screen.findByText("Pasted notes");
    fireEvent.click(screen.getByRole("button", { name: "Build my revision" }));
    await waitFor(() => expect(buildPack).toHaveBeenCalledWith("fe.rxjs", "MATERIAL"));
  });

  it("asks for consent that names the material before building", async () => {
    overview = base({ ai: { available: false, reason: "CONSENT_REQUIRED", consented: false, provider: "gwdg", model: "x" } });
    render(<PackDialog topicId="fe.rxjs" topicName="RxJS" onClose={() => {}} />);
    const notice = await screen.findByRole("group", { name: "AI notice" });
    expect(notice.textContent).toMatch(/text of the material above and the topic's outline to GWDG Academic Cloud/);
    expect((screen.getByRole("button", { name: "Skip: use the topic outline" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(notice).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(aiConsent).toHaveBeenCalled());
  });

  it("shows the build's progress concept by concept", async () => {
    overview = base({
      building: { ...ready([]).pack!, status: "BUILDING", concepts: null, progress: { step: "items", label: "Writing questions for 2 concepts: 1 of 2 done", done: 2, total: 3, concepts: [{ title: "Observables", done: true }, { title: "Subjects", done: false }] } },
    });
    render(<PackDialog topicId="fe.rxjs" topicName="RxJS" onClose={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Building your revision" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/1 of 2 done/);
    expect(screen.getByText("✓ Observables")).toBeTruthy();
  });

  it("lists the concepts, lets one be left out, and shows questions with answers only when asked", async () => {
    overview = ready([concept(), concept({ id: 2, title: "Subjects", subtopicName: null, status: "NEEDS_QUESTIONS", questions: { total: 6, open: 3, choice: 3, levels: { 1: 2, 2: 2, 3: 2 } } })]);
    render(<PackDialog topicId="fe.rxjs" topicName="RxJS" onClose={() => {}} />);
    expect(await screen.findByRole("heading", { name: "From your material, 2 concepts" })).toBeTruthy();
    expect(screen.getByText(/18 questions stored across levels 1–6/)).toBeTruthy();
    expect(screen.getByText(/some levels have no question yet/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Leave out Subjects" }));
    await waitFor(() => expect(patchConcept).toHaveBeenCalledWith(2, { removed: true }));

    fireEvent.click(screen.getAllByRole("button", { name: "Show questions" })[0]);
    expect(await screen.findByText("Two subscribers to one HTTP observable: how many requests?")).toBeTruthy();
    expect(screen.getByText("Tricky choice · pick one")).toBeTruthy();
    expect(screen.queryByText("Two.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    expect(screen.getByText("Two.")).toBeTruthy();
    expect(screen.getByText(/correct: Cold\./)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Expected points, one per line" }), { target: { value: "cold observable\n one request per subscriber \n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patchItem).toHaveBeenCalledWith(9, { question: item.question, expected: ["cold observable", "one request per subscriber"] }));
  });

  it("offers a rebuild when the material changed, keeping the current pack meanwhile", async () => {
    overview = ready([concept()]);
    overview.pack!.stale = true;
    render(<PackDialog topicId="fe.rxjs" topicName="RxJS" onClose={() => {}} />);
    expect(await screen.findByText(/Your material changed since this pack was built/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rebuild" }));
    await waitFor(() => expect(buildPack).toHaveBeenCalledWith("fe.rxjs", "MATERIAL"));
  });

  it("shows the pack's state in the topic panel", async () => {
    overview = ready([concept(), concept({ id: 2, title: "Left out", removed: true })]);
    render(<PackEntry topicId="fe.rxjs" topicName="RxJS" />);
    expect(await screen.findByText("1 concept · 12 questions")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revision pack: RxJS" }).textContent).toBe("Open");
  });

  it("accepts Word, HTML and Markdown by extension when the browser gives no type", () => {
    const types = base().limits.types;
    expect(materialType({ name: "notes.docx", type: "" }, types)).toBe(DOCX);
    expect(materialType({ name: "page.HTM", type: "" }, types)).toBe("text/html");
    expect(materialType({ name: "a.md", type: "" }, types)).toBe("text/markdown");
    expect(materialType({ name: "photo.png", type: "image/png" }, types)).toBeNull(); // the server reads no images here
    // Where the server's AI reads images, photos are accepted, also by extension.
    const withImages = [...types, "image/png", "image/jpeg", "image/webp"];
    expect(materialType({ name: "photo.PNG", type: "" }, withImages)).toBe("image/png");
    expect(materialType({ name: "board.jpg", type: "" }, withImages)).toBe("image/jpeg");
    expect(materialType({ name: "anim.gif", type: "image/gif" }, withImages)).toBeNull();
  });

  it("offers photos when the server reads images, says the AI reads them, and shows what was read", async () => {
    overview = { ...base(), limits: { ...base().limits, types: [...base().limits.types, "image/png", "image/jpeg", "image/webp"] },
      materials: [{ id: 9, name: "board.jpg", mimeType: "image/jpeg", size: 2000, pages: null, chars: 300, hasText: true, preview: "# Subjects\n- next() pushes a value", createdAt: "2026-11-20T10:00:00Z" }] };
    render(<PackDialog topicId="fe.rxjs" topicName="RxJS" onClose={() => {}} />);
    expect(await screen.findByText(/or photos of your notes/)).toBeTruthy();
    expect(screen.getByText(/A photo or screenshot is read by the AI/)).toBeTruthy();
    expect(screen.getByText(/read from a photo by the AI/)).toBeTruthy();
    expect(screen.getByText("What was read")).toBeTruthy();
  });
});
