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
    for (const path of ["/api/curriculum", "/api/today", "/api/week", "/api/progress"]) {
      const body = (await asUser(app, H).get(path).expect(200)).body;
      const all = collect(body);
      expect(all.length, path).toBeGreaterThan(0);
      all.forEach(isPresentation);
      expect(JSON.stringify(all), path).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    }
  });

  it("presents states consistently, and changes nothing else", async () => {
    const progressBefore = (await asUser(app, H).get("/api/progress").expect(200)).body;
    const cur = (await asUser(app, H).get("/api/curriculum").expect(200)).body;
    const ts = cur.districts.flatMap((d: { topics: { id: string; status: string; presentation: P; subtopics: { presentation: P }[] }[] }) => d.topics);
    expect(ts.every((t: { status: string; presentation: P }) => t.presentation.state === `topic.${t.status.toLowerCase().replace("_", "-")}`)).toBe(true);
    expect(ts[0].subtopics[0].presentation.state).toBe("subtopic.not-learned");
    // The first district is current, the others not reached yet; stages carry their status.
    expect(progressBefore.districts[0].presentation.state).toBe("district.current");
    expect(progressBefore.districts[1].presentation.state).toBe("district.ahead");
    for (const s of progressBefore.stages) expect(s.presentation.state).toBe(`stage.${s.status.toLowerCase().replace("_", "-")}`);

    // Learning a sub-topic changes its own presentation and nothing about the road.
    const sub = await prisma.subtopic.findFirstOrThrow({ where: { topicId: "fe.ts", position: 0 } });
    await asUser(app, H).patch(`/api/subtopics/${sub.id}`).send({ completed: true }).expect(200);
    const learned = (await asUser(app, H).get("/api/curriculum").expect(200)).body;
    const t0 = learned.districts.flatMap((d: { topics: { id: string; subtopics: { id: number; presentation: P }[] }[] }) => d.topics).find((t: { id: string }) => t.id === "fe.ts");
    expect(t0.subtopics.find((x: { id: number }) => x.id === sub.id).presentation.state).toBe("subtopic.learned");

    // Presentation is derived only: progress numbers are what they were apart from the sub-topic just learned.
    const progressAfter = (await asUser(app, H).get("/api/progress").expect(200)).body;
    expect(progressAfter.road.currentDistrictIndex).toBe(progressBefore.road.currentDistrictIndex);
    expect(progressAfter.districts[0].passed).toBe(progressBefore.districts[0].passed);
  });
});
