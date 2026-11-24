/** City creation end to end in the browser layer, against a mocked server: four screens, consent, saving, approval. */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  consented: false,
  city: null as null | Record<string, unknown>,
  calls: [] as [string, ...unknown[]][],
  versionStatus: "GENERATING" as string,
}));

vi.mock("../state/Session", () => ({
  useSession: () => ({
    user: { id: "u1", timezone: "Europe/Berlin", preferences: { defaultDailyMinutes: 60, defaultDaysPerWeek: 5 } },
    refreshCities: vi.fn(async () => []),
    selectCity: vi.fn(),
  }),
}));

vi.mock("../api/client", async (orig) => {
  const real = await orig<typeof import("../api/client")>();
  const log = (name: string, ...a: unknown[]) => void server.calls.push([name, ...a]);
  const proposal = {
    version: 1, status: "PROPOSED", progress: null, error: null, source: "GENERATED", contractVersion: 1, note: "", createdAt: "", appliedAt: null, changes: null,
    summary: { title: "German C1", districts: 2, topics: 4, hours: 120, start: "2026-11-23", end: "2027-06-01" },
    content: { districts: [{ key: "grammar", name: "Grammar", color: "#7f98a8", topics: [{ key: "g1", name: "Cases", hours: 6, priority: "CORE", subtopics: ["Nominative", "Accusative", "Dative"], exercise: "Write ten sentences.", dependsOn: [] }] }], stages: [] },
  };
  return {
    ...real,
    account: { setConsent: vi.fn(async (purpose: string, granted: boolean) => { log("consent", purpose, granted); server.consented = granted; return { current: [] }; }) },
    cities: {
      generation: vi.fn(async () => ({ available: server.consented, reason: server.consented ? null : "CONSENT_REQUIRED", consented: server.consented, provider: "gwdg", model: "qwen", paces: { LIGHT: 0.6, STEADY: 0.75, INTENSIVE: 0.9 } })),
      create: vi.fn(async (b: Record<string, unknown>) => { log("create", b); server.city = { id: "cnew", ...b }; return server.city; }),
      update: vi.fn(async (id: string, b: Record<string, unknown>) => { log("update", id, b); server.city = { ...server.city, ...b }; return server.city; }),
      attachments: vi.fn(async () => []),
      addAttachment: vi.fn(async (_id: string, _f: Blob, name: string, type: string) => { log("attach", name, type); return { id: 7, name, mimeType: type, size: 10, pages: 2, chars: 900, hasText: true, preview: "" }; }),
      removeAttachment: vi.fn(async () => undefined),
      understand: vi.fn(async (id: string) => {
        log("understand", id);
        return { name: "German C1", category: "Language", goal: "Work in German", currentLevel: "A2", targetLevel: "C1", subjects: ["Grammar", "Listening", "Speaking"], alreadyKnown: [], resources: ["Podcasts"], focusOptions: ["Everyday", "Exam"], questions: [{ question: "Which exam?", options: ["Goethe", "telc"] }], plan: "12 months in 4 phases", planDays: 365, estimatedHours: 300, promptVersion: "v1", model: "gemma", provider: "gwdg" };
      }),
      versions: vi.fn(async () => []),
      generate: vi.fn(async (id: string) => { log("generate", id); return { version: 1, status: "GENERATING" }; }),
      version: vi.fn(async () => (server.versionStatus === "PROPOSED" ? proposal : { ...proposal, status: "GENERATING", summary: null, progress: { step: "district", label: "Writing 2 districts at once: 1 of 2 done", done: 2, total: 4, districts: [{ name: "Grammar", done: true }, { name: "Listening", done: false }] } })),
      approve: vi.fn(async (id: string, v: number) => { log("approve", id, v); return server.city; }),
      get: vi.fn(),
    },
  };
});

import { CreateCity } from "../components/cities/create/CreateCity";

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const last = (name: string) => [...server.calls].reverse().find((c) => c[0] === name);

beforeEach(() => {
  Object.assign(server, { consented: false, city: null, calls: [], versionStatus: "GENERATING" });
  document.documentElement.dataset.motion = "reduce";
});
afterEach(() => {
  vi.useRealTimers();
  delete document.documentElement.dataset.motion;
});

describe("creating a city", () => {
  it("asks for the goal before anything else", async () => {
    render(<CreateCity draftId={null} />);
    await screen.findByRole("heading", { name: "What would you like to learn?" });
    expect(screen.getByLabelText("Step 1 of 4")).toBeInTheDocument();
    click("Continue");
    expect(screen.getByText("Tell Blueprint what you'd like to learn first.")).toBeInTheDocument();
    expect(server.calls).toEqual([]); // nothing saved, nothing sent
  });

  it("goes from words to an approved city, asking consent once and saving every step", async () => {
    render(<CreateCity draftId={null} />);
    await screen.findByRole("heading", { name: "What would you like to learn?" });

    // 1 · goal, an example to adapt, and a plan file
    fireEvent.click(screen.getByRole("button", { name: "A language" }));
    expect((screen.getByRole("textbox", { name: "What would you like to learn?" }) as HTMLTextAreaElement).value).toMatch(/German B2/);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [new File(["Phase 1: Grammar"], "plan.md", { type: "" })] } }); });
    expect(await screen.findByText("plan.md")).toBeInTheDocument();
    expect(last("attach")).toEqual(["attach", "plan.md", "text/markdown"]);
    expect(last("create")).toBeTruthy(); // the draft was created for the file

    click("Continue");
    // Consent, asked once in a sheet before anything goes to the AI
    const sheet = await screen.findByRole("dialog", { name: /Allow Blueprint to use GWDG Academic Cloud/ });
    expect(sheet).toHaveTextContent("doesn't store");
    expect(last("understand")).toBeUndefined();
    click("Allow");

    // 2 · what was understood
    await screen.findByRole("heading", { name: "Here's what I understood" });
    expect(last("consent")).toEqual(["consent", "AI_CURRICULUM", true]);
    expect(screen.getByText("Following your plan: 12 months in 4 phases")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Listening" })); // leave one out
    fireEvent.click(screen.getByRole("radio", { name: "Exam" }));
    fireEvent.click(screen.getByRole("button", { name: "Goethe" }));
    // Rename through the edit sheet
    fireEvent.click(screen.getByRole("button", { name: /^Name/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My German" } });
    click("Save");
    click("Looks right");

    // 3 · time: the plan's 365 days became the finish-by date
    await screen.findByRole("heading", { name: "How much time do you have?" });
    const saved = last("update")![2] as { name: string; goal: string; requirements: Record<string, unknown> };
    expect(saved.name).toBe("My German");
    expect(saved.requirements).toMatchObject({ focus: "Exam", answers: [{ question: "Which exam?", answer: "Goethe" }], understood: { subjects: ["Grammar", "Speaking"] } });
    expect(screen.getByRole("button", { name: /Finish by/ })).toHaveTextContent(/2027/);
    expect(screen.getByText(/About \d+ hours by/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Saturday" }));
    fireEvent.click(screen.getByRole("radio", { name: "Intensive" }));
    click("Continue");

    // 4 · build
    await screen.findByRole("heading", { name: "Ready to build" });
    const constraints = (last("update")![2] as { constraints: Record<string, unknown> }).constraints;
    expect(constraints).toMatchObject({ weekdays: [1, 2, 3, 4, 5, 6], daysPerWeek: 6, pace: "INTENSIVE", timezone: "Europe/Berlin" });
    click("Build my city");
    await screen.findByRole("heading", { name: "Building your city" });
    expect(await screen.findByText(/1 of 2 done/)).toBeInTheDocument();
    // The preview reveals the written district and keeps the other one a ghost.
    expect(screen.getByText("1 of 2 districts written")).toBeInTheDocument();
    server.versionStatus = "PROPOSED";
    await screen.findByRole("heading", { name: "Your city is ready" }, { timeout: 4000 });
    // The preview now shows the real city; each district opens with its topics.
    expect(screen.getByText(/2 districts · 4 topics · finishes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Grammar/ }));
    const topics = screen.getByRole("dialog", { name: "Grammar" });
    expect(topics).toHaveTextContent("1. Cases");
    expect(topics).toHaveTextContent("Write ten sentences.");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    click("Approve and create the city");
    await waitFor(() => expect(last("approve")).toEqual(["approve", "cnew", 1]));
    await waitFor(() => expect(location.hash).toBe("#/city"));
  }, 15_000);

  it("lets the learner fill the summary in when the AI service is busy", async () => {
    const { cities } = await import("../api/client");
    const { ApiError } = await vi.importActual<typeof import("../api/client")>("../api/client");
    vi.mocked(cities.understand).mockRejectedValueOnce(new ApiError(503, "AI_PROVIDER_BUSY", "Your goal couldn't be read: the AI service is overloaded right now."));
    server.consented = true;
    render(<CreateCity draftId={null} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "What would you like to learn?" }), { target: { value: "Learn Rust for systems work" } });
    click("Continue");
    await screen.findByRole("heading", { name: "Here's what I understood" });
    expect(screen.getByText(/overloaded right now/)).toBeInTheDocument();
    expect(last("consent")).toBeUndefined(); // already given: not asked again
    // No districts yet: they can add one by hand
    click("Looks right");
    expect(screen.getByText("Add at least one district.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add a district/ }));
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Ownership and borrowing" } });
    click("Save");
    expect(screen.getByRole("checkbox", { name: "Ownership and borrowing" })).toHaveAttribute("aria-checked", "true");
    click("Try again");
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Grammar" })).toBeInTheDocument());
  });
});
