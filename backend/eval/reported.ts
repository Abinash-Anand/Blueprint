/**
 * Reported AI checks into the benchmark (Revision v2 plan §3.4, §12): every "The AI check was unfair" report on a
 * revision v2 answer becomes a benchmark case with the question, its expected points and the learner's answer; the
 * learner's own final result is the expected score. Reads the database named by DATABASE_URL and never writes to it.
 * The cases contain the learner's answers, so they are written to eval/results (git-ignored), one new file per run.
 *
 *   npx tsx --env-file=../.env eval/reported.ts                        (writes eval/results/reported-cases-<time>.json)
 *   npx tsx --env-file=../.env eval/run.ts --cases eval/results/reported-cases-<time>.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import type { Case } from "./gates.js";

const prisma = new PrismaClient();
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const reports = await prisma.revisionReport.findMany({ where: { reason: "UNFAIR_CHECK", responseId: { not: null } }, orderBy: { id: "asc" } });
const responses = await prisma.revisionResponse.findMany({ where: { id: { in: reports.map((r) => r.responseId!) } } });
const byId = new Map(responses.map((r) => [r.id, r]));
const cases: Case[] = [];
for (const rep of reports) {
  const r = byId.get(rep.responseId!);
  if (!r || r.format !== "OPEN" || r.final === null || !r.answer.trim()) continue;
  cases.push({
    id: `report-${rep.id}`, topic: r.topicId, variant: "reported", answer: r.answer,
    expect: [r.final, r.final], question: r.question, criteria: strings(r.expected), method: r.kind,
  });
}
await prisma.$disconnect();

const out = join(dirname(fileURLToPath(import.meta.url)), "results", `reported-cases-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ about: "AI checks the learner reported as unfair (revision v2); expect = the learner's own result.", cases }, null, 2), { flag: "wx" });
console.log(`${cases.length} reported case${cases.length === 1 ? "" : "s"} (of ${reports.length} unfair-check reports) written to ${out}`);
