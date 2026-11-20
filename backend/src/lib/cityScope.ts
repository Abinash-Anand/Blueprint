/**
 * City isolation (docs/Sprint-Multi-User.md §4). A Prisma client bound to one city: every read, update and delete on a
 * city-owned model gets `cityId` added to its filter, and every create gets it set. The learning services receive this
 * client instead of the raw one, so no query in them can reach another city's rows, whatever IDs a request carries.
 *
 * - City-owned models have a `cityId` column; Subtopic, Resource and TopicDependency are scoped through their topic.
 * - Account models (User, Session, …) and City itself are refused here: they belong to the account services, which
 *   use the unscoped client with explicit ownership checks.
 * - Raw SQL is not scoped; the services only use it for row locks on rows they have already found through this client.
 */
import type { PrismaClient } from "@prisma/client";

const CITY_OWNED = new Set([
  "District", "Topic", "Stage", "Task", "StudySession", "Settings", "WeeklyTarget",
  "RevisionPrompt", "RevisionSchedule", "RevisionAttempt", "LearningCheckpoint", "RevisionEvaluation", "RevisionReport",
  "RevisionMaterial", "RevisionPack", "RevisionConcept", "RevisionItem", "RevisionTrack", "RevisionSession", "RevisionResponse",
  "ConceptResult",
]);
const VIA_TOPIC = new Set(["Subtopic", "Resource", "TopicDependency"]);
/** Shared, non-personal ledger: the provider quota is per API key, not per city. */
const SHARED = new Set(["AiUsage"]);

const FILTERED = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy",
  "update", "updateMany", "updateManyAndReturn", "delete", "deleteMany",
]);
/** Unique lookups keep their unique field at the top level, so the scope is merged into it (and overrides a caller's). */
const UNIQUE = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"]);
/** Non-unique queries: the caller's filter AND the city, so naming another city's id finds nothing. */
const scopeWhere = (op: string, where: Record<string, unknown> | undefined, scope: Record<string, unknown>) =>
  UNIQUE.has(op) ? { ...(where ?? {}), ...scope } : where && Object.keys(where).length ? { AND: [where, scope] } : scope;

type Args = { where?: Record<string, unknown>; data?: unknown; create?: Record<string, unknown> };

/** True when a create input uses relation fields (`{ topic: { connect } }`), so the city must be connected too. */
const isChecked = (data: Record<string, unknown>) =>
  Object.values(data).some((v) => v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && ("connect" in v || "create" in v || "connectOrCreate" in v));

const withCity = (data: Record<string, unknown>, cityId: string) =>
  isChecked(data) ? { ...data, cityId: undefined, city: { connect: { id: cityId } } } : { ...data, cityId };

export class CityScopeError extends Error {}

/** Typed as the plain client: query extensions change behaviour, not types, so the services need no changes. */
export function cityScoped(prisma: PrismaClient, cityId: string): PrismaClient {
  if (!cityId) throw new CityScopeError("cityScoped needs a city id");
  return prisma.$extends({
    name: "city-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const a = (args ?? {}) as Args;
          if (CITY_OWNED.has(model)) {
            if (FILTERED.has(operation)) a.where = scopeWhere(operation, a.where, { cityId });
            else if (operation === "create") a.data = withCity(a.data as Record<string, unknown>, cityId);
            else if (operation === "createMany" || operation === "createManyAndReturn") {
              const d = a.data as Record<string, unknown> | Record<string, unknown>[];
              a.data = Array.isArray(d) ? d.map((x) => ({ ...x, cityId })) : { ...d, cityId };
            } else if (operation === "upsert") {
              a.where = scopeWhere(operation, a.where, { cityId });
              a.create = withCity(a.create ?? {}, cityId);
            } else throw new CityScopeError(`Unscoped operation ${model}.${operation}`);
          } else if (VIA_TOPIC.has(model)) {
            if (FILTERED.has(operation) || operation === "upsert") a.where = scopeWhere(operation, a.where, { topic: { cityId } });
            // Creates name their topic; the services only create these for topics they found through this client.
          } else if (!SHARED.has(model)) {
            throw new CityScopeError(`${model} is not city data: use the account services`);
          }
          return query(a as typeof args);
        },
      },
    },
  }) as unknown as PrismaClient;
}

