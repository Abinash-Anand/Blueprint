/**
 * One-off: writes the plain statement of every recall checklist point that has none (recall-statements-v1), for the
 * results' "complete point" column. Statements are shown, never graded: no label, score or date changes. New
 * checklists get theirs in the background when a recall starts; this fills in the existing ones.
 *
 *   node dist/src/scripts/backfill-point-statements.js            # writes them for every checklist, prints them, saves nothing
 *   node dist/src/scripts/backfill-point-statements.js --apply    # the same, and saves them
 *   node dist/src/scripts/backfill-point-statements.js 3 7        # only these checklist ids
 *
 * One AI call per checklist that still has points without a statement, so running it twice writes nothing twice.
 * Prints each point's description next to its statement as JSON.
 */
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createPrisma } from "../db.js";
import { systemClock } from "../lib/clock.js";
import { loadAiConfig } from "../modules/ai/config.js";
import { createProviders } from "../modules/ai/providers/factory.js";
import { STATEMENT_PROMPT_VERSION } from "../modules/recall/prompts.js";
import type { RecallService } from "../modules/recall/service.js";

const apply = process.argv.includes("--apply");
const ids = process.argv.slice(2).filter((x) => /^\d+$/.test(x)).map(Number);

const config = loadConfig();
const prisma = createPrisma();
const aiConfig = loadAiConfig();
const app = createApp({ prisma, clock: systemClock(config.appToday), ai: { config: aiConfig, providers: createProviders(aiConfig) } });
const recall = app.locals.recall as RecallService;

const results: unknown[] = [];
try {
  const checklists = await prisma.recallChecklist.findMany({
    where: { ...(ids.length ? { id: { in: ids } } : {}), points: { some: { statement: null } } },
    orderBy: { id: "asc" },
    select: { id: true, cityId: true, subtopic: { select: { name: true } } },
  });
  for (const c of checklists) {
    try {
      results.push({ id: c.id, subtopic: c.subtopic.name, points: await recall.writeStatements(c.cityId, c.id, { apply }) });
    } catch (e) {
      results.push({ id: c.id, subtopic: c.subtopic.name, failed: e instanceof Error ? e.message : String(e) });
    }
  }
} finally {
  await prisma.$disconnect();
}
console.log(JSON.stringify({ apply, promptVersion: STATEMENT_PROMPT_VERSION, model: aiConfig.generationModel, results }, null, 2));
