import { frontend } from "./frontend.js";
import { backend } from "./backend.js";
import { database } from "./database.js";
import { architecture } from "./architecture.js";
import { cloud } from "./cloud.js";
import { ai } from "./ai.js";
import { consolidation } from "./consolidation.js";
import { BEDB_SEQUENCE } from "./stages.js";
import type { DistrictDef, TopicDef } from "./types.js";

export * from "./types.js";
export { stages, BEDB_SEQUENCE, JOURNEY, DEFAULT_TARGETS } from "./stages.js";

/** Road order (SRS FR-CUR-01). Do not reorder: map geometry follows it. */
export const districts: DistrictDef[] = [frontend, backend, database, architecture, cloud, ai, consolidation];

export const allTopics = (): TopicDef[] => districts.flatMap((d) => d.topics);

const isScheduled = (t: TopicDef) => t.priority !== "OPTIONAL";

/** Ordered topic list per planner queue (LLD §3.3). */
export function queues(): Record<string, TopicDef[]> {
  const bySlug = new Map(allTopics().map((t) => [t.slug, t]));
  const q: Record<string, TopicDef[]> = {};
  for (const d of districts) {
    if (d.slug === "be" || d.slug === "db") continue;
    q[d.slug] = d.topics.filter(isScheduled);
  }
  q.bedb = BEDB_SEQUENCE.map((s) => {
    const t = bySlug.get(s);
    if (!t) throw new Error(`BEDB_SEQUENCE references unknown topic ${s}`);
    return t;
  });
  return q;
}
