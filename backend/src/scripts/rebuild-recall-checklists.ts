/**
 * One-off: rebuilds the given recall checklists with the current checklist prompt (docs/Recall-Plan.md §14). Each
 * becomes a new version of its sub-topic's checklist; earlier versions and their reviews are never changed.
 *
 *   node dist/src/scripts/rebuild-recall-checklists.js 1 2 3          # shows what would be rebuilt
 *   node dist/src/scripts/rebuild-recall-checklists.js 1 2 3 --apply  # rebuilds them
 *
 * A checklist id that is not its sub-topic's current version is skipped, so running it twice rebuilds nothing twice.
 * Prints the old and new point labels as JSON.
 */
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createPrisma } from "../db.js";
import { cityScoped } from "../lib/cityScope.js";
import { systemClock } from "../lib/clock.js";
import { loadAiConfig } from "../modules/ai/config.js";
import { createProviders } from "../modules/ai/providers/factory.js";
import { CHECKLIST_PROMPT_VERSION } from "../modules/recall/prompts.js";
import type { RecallService } from "../modules/recall/service.js";

const apply = process.argv.includes("--apply");
const ids = process.argv.slice(2).filter((x) => /^\d+$/.test(x)).map(Number);
if (!ids.length) {
  console.error("Give the checklist ids to rebuild, then --apply to rebuild them.");
  process.exit(2);
}

const config = loadConfig();
const prisma = createPrisma();
const aiConfig = loadAiConfig();
const app = createApp({ prisma, clock: systemClock(config.appToday), ai: { config: aiConfig, providers: createProviders(aiConfig) } });
const recall = app.locals.recall as RecallService;

const results: unknown[] = [];
try {
  for (const id of ids) {
    const c = await prisma.recallChecklist.findUnique({ where: { id }, select: { id: true, cityId: true, subtopicId: true, version: true, promptVersion: true } });
    if (!c) { results.push({ id, skipped: "no such checklist" }); continue; }
    const latest = await prisma.recallChecklist.findFirst({ where: { subtopicId: c.subtopicId }, orderBy: { version: "desc" }, select: { id: true } });
    if (latest?.id !== c.id) { results.push({ id, skipped: "not the sub-topic's current version" }); continue; }
    if (!apply) { results.push({ id, wouldRebuild: { subtopicId: c.subtopicId, version: c.version, promptVersion: c.promptVersion, to: CHECKLIST_PROMPT_VERSION } }); continue; }
    try {
      results.push({ id, rebuilt: await recall.rebuildChecklist(cityScoped(prisma, c.cityId), c.cityId, c.subtopicId) });
    } catch (e) {
      results.push({ id, failed: e instanceof Error ? e.message : String(e) });
    }
  }
} finally {
  await prisma.$disconnect();
}
console.log(JSON.stringify({ apply, promptVersion: CHECKLIST_PROMPT_VERSION, results }, null, 2));
