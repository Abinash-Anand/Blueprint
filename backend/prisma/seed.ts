/**
 * Start-up seed (LLD §3.2, multi-user: docs/Sprint-Multi-User.md §3). Idempotent:
 *  - refreshes the curriculum text of every city built from the Engineering template, never overwriting learner-owned
 *    fields, never removing ticked sub-topics, never regenerating an existing plan;
 *  - creates no city on a fresh database (each user creates their own), unless `createEngineeringCity` is set
 *    (tests and demos): then an unowned "engineering" city with the original ids.
 */
import { PrismaClient } from "@prisma/client";
import { systemClock } from "../src/lib/clock.js";
import { cityScoped } from "../src/lib/cityScope.js";
import { applyCurriculum, engineeringTemplate } from "../src/modules/cities/apply.js";

export async function seed(
  prisma: PrismaClient,
  log = console.log,
  today = systemClock(process.env.APP_TODAY || undefined).today(),
  options: { createEngineeringCity?: boolean } = {},
) {
  if (options.createEngineeringCity && !(await prisma.city.findUnique({ where: { id: "engineering" } }))) {
    await prisma.city.create({ data: { id: "engineering", idPrefix: "", name: "Engineering City", status: "ACTIVE", template: "engineering", goal: "Become a strong full-stack software engineer." } });
  }
  const cities = await prisma.city.findMany({ where: { template: "engineering", status: { not: "DRAFT" } }, select: { id: true, idPrefix: true } });
  const doc = engineeringTemplate();
  for (const c of cities) {
    await applyCurriculum(cityScoped(prisma, c.id), doc, c.idPrefix, today, (m) => log(`Seed (${c.id}): ${m}`));
  }
  if (cities.length === 0) log("Seed: no Engineering template cities yet.");
}

// Run directly: `tsx prisma/seed.ts` or `node dist/prisma/seed.js`
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()!);
if (isMain) {
  const prisma = new PrismaClient();
  seed(prisma)
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
