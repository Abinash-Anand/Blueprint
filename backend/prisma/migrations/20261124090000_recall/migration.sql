-- Recall (docs/Recall-Plan.md): a locked checklist per sub-topic, its schedule, and every review with its point results.
--
-- Additive: five new tables, four enums and one AiOperation value; no existing table changes. Every learned sub-topic
-- gets a RecallState: an earlier sub-topic revision date is kept, never before tomorrow; the rest are due tomorrow (the
-- daily limit spreads them). Rollback:
--   DROP TABLE "RecallPointResult", "RecallReview", "RecallState", "RecallPoint", "RecallChecklist";
--   DROP TYPE "RecallReviewStatus", "RecallPointStatus", "RecallDepth", "RecallOutcome";
--   (the 'RECALL' value stays in "AiOperation": PostgreSQL cannot drop an enum value; it is unused then.)
-- CreateEnum
CREATE TYPE "RecallReviewStatus" AS ENUM ('DRAFT', 'WAITING', 'CHECKED', 'COMPLETE');

-- CreateEnum
CREATE TYPE "RecallPointStatus" AS ENUM ('ACCURATE', 'PARTIAL', 'MISSED');

-- CreateEnum
CREATE TYPE "RecallDepth" AS ENUM ('FOUNDATIONAL', 'INTERMEDIATE', 'MASTERY');

-- CreateEnum
CREATE TYPE "RecallOutcome" AS ENUM ('PASS', 'HOLD', 'LAPSE');

-- AlterEnum
ALTER TYPE "AiOperation" ADD VALUE 'RECALL';

-- CreateTable
CREATE TABLE "RecallChecklist" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL DEFAULT '',
    "subtopicId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "gradingModel" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "lockedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecallChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecallPoint" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL DEFAULT '',
    "checklistId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,
    "leftOutAt" TIMESTAMPTZ(3),

    CONSTRAINT "RecallPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecallState" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL DEFAULT '',
    "subtopicId" INTEGER NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 0,
    "nextDueDate" DATE,
    "lastReviewDate" DATE,
    "lastGapDays" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RecallState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecallReview" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL DEFAULT '',
    "subtopicId" INTEGER NOT NULL,
    "checklistId" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "RecallReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "date" DATE NOT NULL,
    "spokenParts" JSONB NOT NULL DEFAULT '[]',
    "typed" TEXT NOT NULL DEFAULT '',
    "explanation" TEXT NOT NULL DEFAULT '',
    "gradingModel" TEXT,
    "promptVersion" TEXT,
    "score" DOUBLE PRECISION,
    "depth" "RecallDepth",
    "outcome" "RecallOutcome",
    "misconceptions" JSONB NOT NULL DEFAULT '[]',
    "stageBefore" INTEGER,
    "stageAfter" INTEGER,
    "nextDueDate" DATE,
    "waitReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMPTZ(3),
    "checkedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RecallReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecallPointResult" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL DEFAULT '',
    "reviewId" INTEGER NOT NULL,
    "pointId" INTEGER NOT NULL,
    "status" "RecallPointStatus" NOT NULL,
    "evidence" TEXT,
    "recalledWhenAsked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RecallPointResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecallChecklist_cityId_idx" ON "RecallChecklist"("cityId");

-- CreateIndex
CREATE UNIQUE INDEX "RecallChecklist_subtopicId_version_key" ON "RecallChecklist"("subtopicId", "version");

-- CreateIndex
CREATE INDEX "RecallPoint_cityId_idx" ON "RecallPoint"("cityId");

-- CreateIndex
CREATE UNIQUE INDEX "RecallPoint_checklistId_code_key" ON "RecallPoint"("checklistId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RecallState_subtopicId_key" ON "RecallState"("subtopicId");

-- CreateIndex
CREATE INDEX "RecallState_cityId_nextDueDate_idx" ON "RecallState"("cityId", "nextDueDate");

-- CreateIndex
CREATE INDEX "RecallReview_cityId_status_idx" ON "RecallReview"("cityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RecallReview_subtopicId_attempt_key" ON "RecallReview"("subtopicId", "attempt");

-- CreateIndex
CREATE INDEX "RecallPointResult_cityId_idx" ON "RecallPointResult"("cityId");

-- CreateIndex
CREATE UNIQUE INDEX "RecallPointResult_reviewId_pointId_key" ON "RecallPointResult"("reviewId", "pointId");

-- AddForeignKey
ALTER TABLE "RecallChecklist" ADD CONSTRAINT "RecallChecklist_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallChecklist" ADD CONSTRAINT "RecallChecklist_subtopicId_fkey" FOREIGN KEY ("subtopicId") REFERENCES "Subtopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallPoint" ADD CONSTRAINT "RecallPoint_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallPoint" ADD CONSTRAINT "RecallPoint_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "RecallChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallState" ADD CONSTRAINT "RecallState_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallState" ADD CONSTRAINT "RecallState_subtopicId_fkey" FOREIGN KEY ("subtopicId") REFERENCES "Subtopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallReview" ADD CONSTRAINT "RecallReview_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallReview" ADD CONSTRAINT "RecallReview_subtopicId_fkey" FOREIGN KEY ("subtopicId") REFERENCES "Subtopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallReview" ADD CONSTRAINT "RecallReview_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "RecallChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallPointResult" ADD CONSTRAINT "RecallPointResult_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallPointResult" ADD CONSTRAINT "RecallPointResult_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "RecallReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallPointResult" ADD CONSTRAINT "RecallPointResult_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "RecallPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Checks
ALTER TABLE "RecallPoint" ADD CONSTRAINT "RecallPoint_tier_check" CHECK ("tier" BETWEEN 1 AND 3 AND "weight" BETWEEN 1 AND 3);
ALTER TABLE "RecallState" ADD CONSTRAINT "RecallState_stage_check" CHECK ("stage" >= 0 AND ("lastGapDays" IS NULL OR "lastGapDays" >= 0));
ALTER TABLE "RecallReview" ADD CONSTRAINT "RecallReview_score_check" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 1));

-- Every learned sub-topic starts in recall.
INSERT INTO "RecallState" ("cityId", "subtopicId", "stage", "nextDueDate", "updatedAt")
SELECT t."cityId", s."id", 0,
       GREATEST(COALESCE(rs."nextDueDate", CURRENT_DATE + 1), CURRENT_DATE + 1),
       CURRENT_TIMESTAMP
FROM "Subtopic" s
JOIN "Topic" t ON t."id" = s."topicId"
LEFT JOIN "RevisionSchedule" rs ON rs."subtopicId" = s."id"
WHERE s."completedAt" IS NOT NULL;
