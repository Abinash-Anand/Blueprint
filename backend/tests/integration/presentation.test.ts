/**
 * Semantic presentation through the API (LLD §4.4): every endpoint carries the same backend mapping, semantic tokens
 * only, and adding it changed no learning, scheduling or progress values. Fresh schema per run, dropped after.
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { TestClock } from "../../src/lib/clock.js";
import { PRESENTATION_VERSION, STATES, TONES } from "../../src/domain/presentation.js";
import { seed } from "../../prisma/seed.js";
import { asUser, signIn } from "../helpers/auth.js";

/** Session cookie and city for every request (filled in beforeAll). */
const H: Record<string, string> = {};

const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const schema = `it_pres_${Date.now()}`;
const url = base ? `${base}${base.includes("?") ? "&" : "?"}schema=${schema}` : "";

type P = { state: string; tone: string; variant: string; icon: string; label: string; flags?: P[] };
const isPresentation = (p: P) => {
  expect(Object.keys(STATES)).toContain(p.state);
  const s = STATES[p.state as keyof typeof STATES];
  expect(p).toMatchObject({ tone: s.tone, variant: s.variant, icon: s.icon });
  expect(TONES).toContain(p.tone);
  expect(p.label.length).toBeGreaterThan(0);
  p.flags?.forEach(isPresentation);
};
/** Every `presentation` object anywhere in a response. */
function collect(x: unknown, out: P[] = []): P[] {
  if (Array.isArray(x)) x.forEach((v) => collect(v, out));
  else if (x && typeof x === "object") {
    for (const [k, v] of Object.entries(x)) {
      if ((k === "presentation" || k === "attention" || k === "suggestion") && v) out.push(v as P);
      else collect(v, out);
    }
  }
  return out;
}

suite("presentation metadata", () => {
  let prisma: PrismaClient;
  const clock = new TestClock("2026-11-18");
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    prisma = new PrismaClient({ datasourceUrl: url });
    await seed(prisma, () => {}, clock.date, { createEngineeringCity: true });
    Object.assign(H, (await signIn(prisma)).headers);
    app = createApp({ prisma, clock });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  it("publishes the versioned catalogue", async () => {
    const r = (await asUser(app, H).get("/api/presentation").expect(200)).body;
    expect(r.version).toBe(PRESENTATION_VERSION);
    expect(r.tones).toEqual([...TONES]);
    expect(Object.keys(r.states)).toEqual(Object.keys(STATES));
  });

  it("adds valid semantic presentation to every view, with no colour values", async () => {
    for (const path of ["/api/curriculum", "/api/today", "/api/week", "/api/progress", "/api/revision/overview"]) {
      const body = (await asUser(app, H).get(path).expect(200)).body;
      const all = collect(body);
      expect(all.length, path).toBeGreaterThan(0);
      all.forEach(isPresentation);
      expect(JSON.stringify(all), path).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    }
  });

  it("presents states consistently across endpoints, and changes nothing else", async () => {
    const progressBefore = (await asUser(app, H).get("/api/progress").expect(200)).body;
    const cur = (await asUser(app, H).get("/api/curriculum").expect(200)).body;
    const ts = cur.districts.flatMap((d: { topics: { id: string; status: string; presentation: P; subtopics: { presentation: P }[] }[] }) => d.topics);
    expect(ts.every((t: { status: string; presentation: P }) => t.presentation.state === `topic.${t.status.toLowerCase().replace("_", "-")}`)).toBe(true);
    expect(ts[0].subtopics[0].presentation.state).toBe("subtopic.not-learned");
    // The first district is current, the others not reached yet; stages carry their status.
    expect(progressBefore.districts[0].presentation.state).toBe("district.current");
    expect(progressBefore.districts[1].presentation.state).toBe("district.ahead");
    for (const s of progressBefore.stages) expect(s.presentation.state).toBe(`stage.${s.status.toLowerCase().replace("_", "-")}`);

    // Learn a sub-topic: its revision appears with the same presentation in the topic view, the overview and the task.
    const sub = await prisma.subtopic.findFirstOrThrow({ where: { topicId: "fe.ts", position: 0 } });
    await asUser(app, H).patch(`/api/subtopics/${sub.id}`).send({ completed: true }).expect(200);
    clock.date = "2026-11-19";
    const topicRev = (await asUser(app, H).get("/api/topics/fe.ts/revision").expect(200)).body;
    const unit = topicRev.units.find((u: { subtopicId: number | null }) => u.subtopicId === sub.id);
    expect(unit.schedule.presentation).toMatchObject({ state: "revision.due", tone: "info", label: "Due today" });
    const overview = (await asUser(app, H).get("/api/revision/overview").expect(200)).body;
    expect(overview.due[0].presentation).toEqual(unit.schedule.presentation);
    expect(overview.attention).toMatchObject({ state: "attention.due", label: "1 due" });
    const today = (await asUser(app, H).get("/api/today").expect(200)).body;
    const task = today.tasks.find((t: { revision: { scheduleId: number } | null }) => t.revision?.scheduleId === unit.schedule.id);
    expect(task.revision.presentation).toEqual(unit.schedule.presentation);
    expect(today.revision.attention).toMatchObject({ state: "attention.due", tone: "info" });

    // A day later it is overdue everywhere.
    clock.date = "2026-11-20";
    const late = (await asUser(app, H).get("/api/revision/overview").expect(200)).body;
    expect(late.overdue[0].presentation).toMatchObject({ state: "revision.overdue", tone: "danger", label: "1 day overdue" });
    expect(late.attention).toMatchObject({ state: "attention.overdue", tone: "danger" });

    // A recall outcome is presented by the score the learner chose.
    const a = (await asUser(app, H).post("/api/revision/attempts")
      .send({ topicId: "fe.ts", subtopicId: sub.id, templateKey: "explain", retrievalMethod: "CONCEPTUAL", score: 1, usedHints: false, usedNotes: false, mistakes: "forgot constraints" })
      .expect(201)).body;
    expect(a.attempt.presentation).toMatchObject({ state: "outcome.struggled", tone: "warning", label: "Struggled" });
    const after = (await asUser(app, H).get("/api/revision/overview").expect(200)).body;
    expect(after.awaitingCorrection[0].presentation).toMatchObject({ state: "revision.correction", tone: "warning" });

    // Presentation is derived only: progress numbers are what they were apart from the sub-topic just learned.
    const progressAfter = (await asUser(app, H).get("/api/progress").expect(200)).body;
    expect(progressAfter.road.currentDistrictIndex).toBe(progressBefore.road.currentDistrictIndex);
    expect(progressAfter.districts[0].passed).toBe(progressBefore.districts[0].passed);
  });
});
