-- Phase 2 scheduler (docs/Scheduler-Phase2-Plan.md, step 3). Additive only: no existing value changes.

-- Tasks moved by hand stay where the learner put them.
ALTER TABLE "Task" ADD COLUMN "pinnedAt" TIMESTAMPTZ(3);

-- The day the plan was last re-planned for.
ALTER TABLE "Settings" ADD COLUMN "replannedFor" DATE;

-- Each stage's study weekdays and queue, which the planner used once and did not keep.
ALTER TABLE "Stage" ADD COLUMN "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "Stage" ADD COLUMN "queue" TEXT NOT NULL DEFAULT '';

-- Filled in from each city's latest applied curriculum (stage id = the city's id prefix + the stage key). The built-in
-- Engineering City has no stored version: its stages are refreshed from the template on start-up (cities/apply.ts).
UPDATE "Stage" s
SET "weekdays" = ARRAY(SELECT jsonb_array_elements_text(st -> 'weekdays')::INTEGER),
    "queue" = COALESCE(st ->> 'queue', '')
FROM (
  SELECT DISTINCT ON (v."cityId") v."cityId", v."content"
  FROM "CurriculumVersion" v
  WHERE v."status" = 'APPLIED'
  ORDER BY v."cityId", v."version" DESC
) cv
JOIN "City" c ON c."id" = cv."cityId"
CROSS JOIN LATERAL jsonb_array_elements(cv."content" -> 'stages') st
WHERE s."cityId" = cv."cityId" AND s."id" = c."idPrefix" || (st ->> 'key');

-- What each re-plan changed.
CREATE TABLE "PlanChange" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "moved" INTEGER NOT NULL,
    "finishBefore" DATE,
    "finishAfter" DATE,

    CONSTRAINT "PlanChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlanChange_cityId_at_idx" ON "PlanChange"("cityId", "at");
ALTER TABLE "PlanChange" ADD CONSTRAINT "PlanChange_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
