-- Revision reports (docs/Revision-v2-Plan.md §3.4). Additive only: one enum and one table; nothing existing changes.
-- Rollback: DROP TABLE "RevisionReport"; DROP TYPE "RevisionReportReason";
-- CreateEnum
CREATE TYPE "RevisionReportReason" AS ENUM ('OUT_OF_SYLLABUS', 'UNCLEAR', 'UNFAIR_CHECK', 'OTHER');

-- CreateTable
CREATE TABLE "RevisionReport" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL,
    "topicId" TEXT,
    "scheduleId" INTEGER,
    "promptId" INTEGER,
    "evaluationId" INTEGER,
    "promptText" TEXT NOT NULL,
    "reason" "RevisionReportReason" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevisionReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RevisionReport_cityId_idx" ON "RevisionReport"("cityId");

-- AddForeignKey
ALTER TABLE "RevisionReport" ADD CONSTRAINT "RevisionReport_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

