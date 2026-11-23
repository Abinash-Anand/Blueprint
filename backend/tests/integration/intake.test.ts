/**
 * City creation intake end to end (AI design §10.4) with the deterministic fake provider, on a real database:
 * plan files, "Here's what I understood", dictation, consent, ownership, and generation that uses all of it.
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { loadAuthConfig } from "../../src/config.js";
import { TestClock } from "../../src/lib/clock.js";
import { loadAiConfig } from "../../src/modules/ai/config.js";
import { createProviders } from "../../src/modules/ai/providers/factory.js";
import { POLICY_VERSIONS } from "../../src/modules/auth/service.js";
import { memoryMailer } from "../../src/modules/auth/mailer.js";
import { asUser, signIn } from "../helpers/auth.js";
import { pdfWithText } from "../helpers/pdf.js";
import { wav } from "../helpers/wav.js";

const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const schema = `it_intake_${Date.now()}`;
const url = base ? `${base}${base.includes("?") ? "&" : "?"}schema=${schema}` : "";

suite("city creation intake", () => {
  let prisma: PrismaClient;
  const clock = new TestClock("2026-11-19");
  const config = loadAiConfig({ AI_ENABLED: "true", AI_EVALUATION_PROVIDER: "fake", AI_GENERATION_PROVIDER: "fake", AI_TRANSCRIPTION_PROVIDER: "fake", AI_GENERATION_RETRY_DELAYS_MS: "0,0" });
  let app: ReturnType<typeof createApp>;
  const H: Record<string, string> = {};
  const B: Record<string, string> = {};
  const authConfig = loadAuthConfig({ MAIL_TRANSPORT: "file" });

  const draft = async (headers = H) => (await asUser(app, headers).post("/api/cities").send({ name: "New city" }).expect(201)).body.id as string;
  const upload = (id: string, name: string, type: string, body: Buffer, headers = H) =>
    asUser(app, headers).post(`/api/cities/${id}/attachments?name=${encodeURIComponent(name)}`).set("Content-Type", type).send(body);
  const consent = (headers = H) => asUser(app, headers).post("/api/account/consents").send({ purpose: "AI_CURRICULUM", granted: true }).expect(200);

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.AI_FAKE_TRANSCRIPT;
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = new PrismaClient({ datasourceUrl: url });
    app = createApp({ prisma, clock, authConfig, mailer: memoryMailer(), ai: { config, providers: createProviders(config) } });
    Object.assign(H, (await signIn(prisma, { email: "intake@example.test", cityId: "none" })).headers);
    Object.assign(B, (await signIn(prisma, { email: "intruder@example.test", cityId: "none" })).headers);
  }, 120_000);
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  describe("plan files", () => {
    it("reads a PDF and a text file, keeps only their text, and lists them", async () => {
      const id = await draft();
      const pdf = await upload(id, "my plan.pdf", "application/pdf", pdfWithText(["Phase 1: Grammar foundations and cases", "Phase 2: Speaking with confidence"])).expect(201);
      expect(pdf.body).toMatchObject({ name: "my plan.pdf", mimeType: "application/pdf", pages: 2, hasText: true });
      expect(pdf.body.preview).toContain("Phase 1: Grammar");
      expect(pdf.body.text).toBeUndefined(); // the full text never goes back to the browser
      const txt = await upload(id, "notes.md", "text/markdown", Buffer.from("# Notes\nMonth 1: listening every day with podcasts")).expect(201);
      expect(txt.body).toMatchObject({ pages: null, hasText: true });
      const list = (await asUser(app, H).get(`/api/cities/${id}/attachments`).expect(200)).body;
      expect(list.map((x: { name: string }) => x.name)).toEqual(["my plan.pdf", "notes.md"]);
      const row = await prisma.cityAttachment.findFirstOrThrow({ where: { cityId: id, name: "my plan.pdf" } });
      expect(row.text).toContain("Phase 2: Speaking with confidence");
    });

    it("tells the learner when a PDF has no text (a scan)", async () => {
      const id = await draft();
      expect((await upload(id, "scan.pdf", "application/pdf", pdfWithText([""])).expect(201)).body.hasText).toBe(false);
    });

    it("refuses other file types, unreadable files, oversized files and a fourth file", async () => {
      const id = await draft();
      expect((await upload(id, "x.png", "image/png", Buffer.from("png")).expect(415)).body.error.code).toBe("FILE_UNSUPPORTED");
      expect((await upload(id, "x.pdf", "application/pdf", Buffer.from("not really a pdf")).expect(415)).body.error.code).toBe("FILE_UNREADABLE");
      await upload(id, "big.txt", "text/plain", Buffer.alloc(5 * 1024 * 1024 + 10, 97)).expect(413);
      for (const n of [1, 2, 3]) await upload(id, `p${n}.txt`, "text/plain", Buffer.from(`Plan number ${n}, with enough words to count as text.`)).expect(201);
      expect((await upload(id, "p4.txt", "text/plain", Buffer.from("one too many")).expect(409)).body.error.code).toBe("TOO_MANY_FILES");
    });

    it("removes a file, and only the owner of a new city can touch its files", async () => {
      const id = await draft();
      const a = (await upload(id, "plan.txt", "text/plain", Buffer.from("Phase 1: everything about grammar")).expect(201)).body;
      expect((await upload(id, "plan.txt", "text/plain", Buffer.from("hi"), B).expect(404)).body.error.code).toBe("CITY_NOT_FOUND");
      await asUser(app, B).delete(`/api/cities/${id}/attachments/${a.id}`).expect(404);
      await asUser(app, B).get(`/api/cities/${id}/attachments`).expect(404);
      await asUser(app, H).delete(`/api/cities/${id}/attachments/${a.id}`).expect(204);
      await asUser(app, H).delete(`/api/cities/${id}/attachments/${a.id}`).expect(404);
      // An active city's creation files can no longer change.
      await prisma.city.update({ where: { id }, data: { status: "ACTIVE" } });
      expect((await upload(id, "late.txt", "text/plain", Buffer.from("too late")).expect(409)).body.error.code).toBe("CITY_NOT_DRAFT");
    });

    it("are part of the data export and go when the city is deleted", async () => {
      const id = await draft();
      await upload(id, "plan.txt", "text/plain", Buffer.from("Phase 1: export me with the rest of my data")).expect(201);
      const ex = (await asUser(app, H).get("/api/account/export").expect(200)).body;
      const city = ex.cities.find((c: { id: string }) => c.id === id);
      expect(city.attachments[0]).toMatchObject({ name: "plan.txt", text: "Phase 1: export me with the rest of my data" });
      await asUser(app, H).delete(`/api/cities/${id}`).send({ confirmName: "New city" }).expect(204);
      expect(await prisma.cityAttachment.count({ where: { cityId: id } })).toBe(0);
    });
  });

  describe("Here's what I understood", () => {
    it("needs consent under the current notice, then reads the goal and the plan", async () => {
      const id = await draft();
      await asUser(app, H).patch(`/api/cities/${id}`).send({ requirements: { brief: "Reach German C1 for work. I'm A2 and like podcasts." } }).expect(200);
      expect((await asUser(app, H).post(`/api/cities/${id}/understand`).expect(403)).body.error.code).toBe("AI_CONSENT_REQUIRED");
      // Consent given under the previous notice does not count: plan files and voice are new.
      const user = await prisma.user.findUniqueOrThrow({ where: { email: "intake@example.test" } });
      await prisma.consentRecord.create({ data: { userId: user.id, purpose: "AI_CURRICULUM", policyVersion: "2026-11-19", granted: true } });
      expect(POLICY_VERSIONS.AI_CURRICULUM).not.toBe("2026-11-19");
      await asUser(app, H).post(`/api/cities/${id}/understand`).expect(403);
      await consent();
      await upload(id, "plan.txt", "text/plain", Buffer.from("Phase 1: Grammar\nPhase 2: Listening\nPhase 3: Speaking")).expect(201);
      const u = (await asUser(app, H).post(`/api/cities/${id}/understand`).expect(200)).body;
      expect(u).toMatchObject({ subjects: ["Grammar", "Listening", "Speaking"], currentLevel: "A2", targetLevel: "C1", plan: "3 phases", estimatedHours: 120 });
      expect(u.questions[0].options.length).toBeGreaterThanOrEqual(2);
      const city = (await asUser(app, H).get(`/api/cities/${id}`).expect(200)).body;
      expect(city.requirements.understood.subjects).toEqual(["Grammar", "Listening", "Speaking"]);
      expect(city.requirements.brief).toMatch(/German C1/); // the learner's own words stay
      expect(city.category).toBe("Learning");
      expect(await prisma.aiUsage.count({ where: { operation: "UNDERSTAND", outcome: "OK" } })).toBe(1);
    });

    it("asks for a goal first, and is only for the owner's new city", async () => {
      const id = await draft();
      expect((await asUser(app, H).post(`/api/cities/${id}/understand`).expect(400)).body.error.code).toBe("BRIEF_REQUIRED");
      await consent(B);
      expect((await asUser(app, B).post(`/api/cities/${id}/understand`).expect(404)).body.error.code).toBe("CITY_NOT_FOUND");
    });

    it("keeps the learner's corrections and refuses unknown fields", async () => {
      const id = await draft();
      const requirements = {
        brief: "German C1", focus: "Everyday speaking", answers: [{ question: "What matters most?", answer: "Speaking" }],
        understood: { name: "German C1", goal: "Speak German at work", currentLevel: "A2", targetLevel: "C1", subjects: ["Grammar", "Speaking"], estimatedHours: 300 },
      };
      await asUser(app, H).patch(`/api/cities/${id}`).send({ requirements, constraints: { hoursPerDay: 1.5, weekdays: [1, 3, 5], pace: "LIGHT" } }).expect(200);
      expect((await asUser(app, H).get(`/api/cities/${id}`).expect(200)).body).toMatchObject({ requirements, constraints: { weekdays: [1, 3, 5], pace: "LIGHT" } });
      await asUser(app, H).patch(`/api/cities/${id}`).send({ requirements: { understood: { subjects: ["x"], secret: 1 } } }).expect(400);
      await asUser(app, H).patch(`/api/cities/${id}`).send({ constraints: { weekdays: [0] } }).expect(400);
    });
  });

  describe("dictation", () => {
    it("transcribes the spoken goal without storing it, within the limits", async () => {
      const id = await draft();
      await consent();
      const r = await asUser(app, H).post(`/api/cities/${id}/dictation`).set("Content-Type", "audio/wav").send(wav(3)).expect(200);
      expect(r.body).toEqual({ text: "This is a fake transcript of a 3-second recording.", audioSeconds: 3 });
      expect((await asUser(app, H).post(`/api/cities/${id}/dictation`).set("Content-Type", "audio/wav").send(wav(0.2)).expect(400)).body.error.code).toBe("AUDIO_TOO_SHORT");
      expect((await asUser(app, H).post(`/api/cities/${id}/dictation`).set("Content-Type", "audio/wav").send(wav(65)).expect(413)).body.error.code).toBe("AUDIO_TOO_LARGE");
      expect((await asUser(app, H).post(`/api/cities/${id}/dictation`).set("Content-Type", "audio/webm").send(Buffer.alloc(50)).expect(415)).body.error.code).toBe("AUDIO_UNSUPPORTED");
      await asUser(app, B).post(`/api/cities/${id}/dictation`).set("Content-Type", "audio/wav").send(wav(2)).expect(404);
    });
  });

  describe("generation", () => {
    it("builds the city from the confirmed subjects, the plan and the chosen days", async () => {
      await consent();
      const id = await draft();
      await upload(id, "plan.txt", "text/plain", Buffer.from("Phase 1: Grammar\nPhase 2: Speaking")).expect(201);
      await asUser(app, H).patch(`/api/cities/${id}`).send({
        requirements: { brief: "German C1 for work", understood: { subjects: ["Grammar", "Speaking"], estimatedHours: 60 } },
        constraints: { hoursPerDay: 2, weekdays: [2, 4], pace: "INTENSIVE", startDate: "2026-11-24" },
      }).expect(200);
      const avail = (await asUser(app, H).get("/api/curriculum/generation").expect(200)).body;
      expect(avail).toMatchObject({ available: true, paces: { LIGHT: 0.6, STEADY: 0.75, INTENSIVE: 0.9 } });
      await asUser(app, H).post(`/api/cities/${id}/curriculum/generate`).send({}).expect(202);
      let v: { status: string; content: { districts: { name: string }[]; weeklyTargets: Record<string, number> }; note: string } | null = null;
      for (let i = 0; i < 100 && (!v || v.status === "GENERATING"); i++) {
        v = (await asUser(app, H).get(`/api/cities/${id}/curriculum/versions/1`).expect(200)).body;
        if (v!.status === "GENERATING") await new Promise((r) => setTimeout(r, 50));
      }
      expect(v!.status).toBe("PROPOSED");
      expect(v!.content.districts.map((d) => d.name).slice(0, 2)).toEqual(["Grammar", "Speaking"]);
      expect(v!.content.weeklyTargets).toEqual({ 1: 0, 2: 120, 3: 0, 4: 120, 5: 0, 6: 0, 7: 0 });
      expect(v!.note).toMatch(/curriculum-gen-v5/);
    });
  });
});
