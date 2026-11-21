-- Recall phases 2 and 3 (docs/Recall-Plan.md §3.4, §7; sketches): the senior engineer's follow-up and verdict, sketch
-- descriptions, and the analysis of how a sub-topic's recall changed over time.
--
-- Additive: four nullable or defaulted columns on RecallReview and one new table; no existing data changes.
-- Rollback:
--   DROP TABLE "RecallAnalysis";
--   ALTER TABLE "RecallReview" DROP COLUMN "followupAnswer", DROP COLUMN "followupQuestion", DROP COLUMN "seniorVerdict", DROP COLUMN "sketchParts";

-- AlterTable
ALTER TABLE "RecallReview" ADD COLUMN     "followupAnswer" TEXT,
ADD COLUMN     "followupQuestion" TEXT,
ADD COLUMN     "seniorVerdict" JSONB,
ADD COLUMN     "sketchParts" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "RecallAnalysis" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL DEFAULT '',
    "reviewId" INTEGER NOT NULL,
    "subtopicId" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL,
    "diffPayload" JSONB NOT NULL,
    "narrative" TEXT NOT NULL DEFAULT '',
    "model" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecallAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecallAnalysis_reviewId_key" ON "RecallAnalysis"("reviewId");

-- CreateIndex
CREATE INDEX "RecallAnalysis_cityId_subtopicId_idx" ON "RecallAnalysis"("cityId", "subtopicId");

-- AddForeignKey
ALTER TABLE "RecallAnalysis" ADD CONSTRAINT "RecallAnalysis_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallAnalysis" ADD CONSTRAINT "RecallAnalysis_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "RecallReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

