-- Study slots (docs/Google-Calendar-MVP-Plan.md §9): when each city's study starts.
ALTER TABLE "Settings" ADD COLUMN "studyStartMinute" INTEGER;

-- One time: blocks that the first sync after the richer-events update wrongly kept as "moved by the learner" (they
-- had no record of where Blueprint had placed them) are laid out again. Only the calendar mirror changes.
UPDATE "CalendarEvent" SET "startMinute" = NULL, "contentHash" = NULL;
