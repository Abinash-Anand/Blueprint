-- Availability per city (Blueprint relationship model, phase 1): how many minutes the learner can study on each
-- weekday, next to the new-material target the plan already uses (the allocation). The difference is the time
-- left for revision. And the target finish date the learner gave, for the forecast's feasibility check.
ALTER TABLE "WeeklyTarget" ADD COLUMN "availableMinutes" INTEGER;
ALTER TABLE "Settings" ADD COLUMN "targetDate" DATE;

-- Backfill from each city's creation answers. A study day (target > 0) is available for the hours a day the learner
-- gave, never less than its target (older cities planned their full hours as new material); a rest day stays 0.
-- Without answers (the built-in Engineering City) availability is the target itself.
UPDATE "WeeklyTarget" w
SET "availableMinutes" = CASE
  WHEN w."targetMinutes" = 0 THEN 0
  ELSE GREATEST(w."targetMinutes", COALESCE(ROUND((c."constraints"->>'hoursPerDay')::numeric * 60)::int, w."targetMinutes"))
END
FROM "City" c
WHERE c."id" = w."cityId";

UPDATE "Settings" s
SET "targetDate" = (c."constraints"->>'targetDate')::date
FROM "City" c
WHERE c."id" = s."cityId" AND (c."constraints"->>'targetDate') ~ '^\d{4}-\d{2}-\d{2}$';
