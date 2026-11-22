-- The scheduler's rules changed (docs/Availability-Phase3-Plan.md, 4b): a stage may start once the work before it is
-- placed, and a task that does not fit a day's room is split. Every city re-plans on its next visit, not tomorrow.
UPDATE "Settings" SET "replannedFor" = NULL;
