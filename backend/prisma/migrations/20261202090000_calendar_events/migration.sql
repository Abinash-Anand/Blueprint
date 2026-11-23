-- Richer calendar events (docs/Google-Calendar-MVP-Plan.md §8): recall events of their own, a day laid out across
-- cities, reminders. Columns only; existing blocks become STUDY. The unique index widens to include the kind.
-- DropIndex
DROP INDEX "CalendarEvent_userId_cityId_day_key";

-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'STUDY',
ADD COLUMN     "placedMinute" INTEGER;

-- AlterTable
ALTER TABLE "GoogleConnection" ADD COLUMN     "cityOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "reminderMinutes" INTEGER NOT NULL DEFAULT 10;

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_userId_cityId_day_kind_key" ON "CalendarEvent"("userId", "cityId", "day", "kind");

