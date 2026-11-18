-- Revision workload inside the weekly plan (SRS BR-18): weekly cap on over-target revision minutes.
ALTER TABLE "Settings" ADD COLUMN "revisionWeeklyOvertimeMinutes" INTEGER NOT NULL DEFAULT 120;

ALTER TABLE "Settings" ADD CONSTRAINT "Settings_revisionWeeklyOvertimeMinutes_range"
  CHECK ("revisionWeeklyOvertimeMinutes" BETWEEN 0 AND 720);
