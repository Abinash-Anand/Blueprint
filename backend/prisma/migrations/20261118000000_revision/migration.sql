-- Revision and active recall (Revision spec v1.0, LLD §2.4). Generated with prisma migrate diff; constraints below added by hand.

-- CreateEnum
CREATE TYPE "RevisionScope" AS ENUM ('SUBTOPIC', 'TOPIC');

-- CreateEnum
CREATE TYPE "RetrievalMethod" AS ENUM ('CONCEPTUAL', 'QUESTION_ANSWER', 'WRITTEN', 'VISUAL', 'PRACTICAL', 'SCENARIO');

-- CreateEnum
CREATE TYPE "PromptSource" AS ENUM ('CURRICULUM', 'TEMPLATE', 'LEARNER');

-- CreateEnum
CREATE TYPE "CheckpointResult" AS ENUM ('RECALLED', 'PARTIAL', 'NOT_RECALLED');

-- AlterEnum
ALTER TYPE "TaskSource" ADD VALUE 'REVISION';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "revisionScheduleId" INTEGER;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "revisionDailyMinutes" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "RevisionPrompt" (
    "id" SERIAL NOT NULL,
    "key" TEXT,
    "topicId" TEXT NOT NULL,
    "subtopicId" INTEGER,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "retrievalMethod" "RetrievalMethod" NOT NULL,
    "expectedAnswer" TEXT NOT NULL,
    "difficulty" INTEGER,
    "source" "PromptSource" NOT NULL,
    "templateKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RevisionPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionSchedule" (
    "id" SERIAL NOT NULL,
    "unit" TEXT NOT NULL,
    "scope" "RevisionScope" NOT NULL,
    "topicId" TEXT NOT NULL,
    "subtopicId" INTEGER,
    "eligibleSince" DATE NOT NULL,
    "nextDueDate" DATE,
    "lastAttemptAt" TIMESTAMPTZ(3),
    "lastAttemptDate" DATE,
    "lastScore" INTEGER,
    "previousIntervalDays" INTEGER NOT NULL DEFAULT 0,
    "consecutiveSuccesses" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "correctionPending" BOOLEAN NOT NULL DEFAULT false,
    "suspendedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RevisionSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionAttempt" (
    "id" SERIAL NOT NULL,
    "scheduleId" INTEGER NOT NULL,
    "promptId" INTEGER,
    "taskId" INTEGER,
    "promptText" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "effectiveScore" INTEGER NOT NULL,
    "retrievalMethod" "RetrievalMethod" NOT NULL,
    "attemptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptDate" DATE NOT NULL,
    "durationMinutes" INTEGER,
    "usedHints" BOOLEAN NOT NULL,
    "usedNotes" BOOLEAN NOT NULL,
    "response" TEXT NOT NULL DEFAULT '',
    "mistakes" TEXT NOT NULL DEFAULT '',
    "correctionCompleted" BOOLEAN NOT NULL,
    "correctedAt" TIMESTAMPTZ(3),
    "comment" TEXT NOT NULL DEFAULT '',
    "intervalDays" INTEGER NOT NULL,
    "nextDueDate" DATE,

    CONSTRAINT "RevisionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningCheckpoint" (
    "id" SERIAL NOT NULL,
    "topicId" TEXT NOT NULL,
    "subtopicId" INTEGER NOT NULL,
    "promptId" INTEGER,
    "promptText" TEXT NOT NULL,
    "result" "CheckpointResult" NOT NULL,
    "neededAssistance" BOOLEAN NOT NULL,
    "gaps" TEXT NOT NULL DEFAULT '',
    "response" TEXT NOT NULL DEFAULT '',
    "date" DATE NOT NULL,
    "completedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RevisionPrompt_key_key" ON "RevisionPrompt"("key");

-- CreateIndex
CREATE INDEX "RevisionPrompt_topicId_idx" ON "RevisionPrompt"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "RevisionSchedule_unit_key" ON "RevisionSchedule"("unit");

-- CreateIndex
CREATE UNIQUE INDEX "RevisionSchedule_subtopicId_key" ON "RevisionSchedule"("subtopicId");

-- CreateIndex
CREATE INDEX "RevisionSchedule_topicId_idx" ON "RevisionSchedule"("topicId");

-- CreateIndex
CREATE INDEX "RevisionAttempt_scheduleId_attemptedAt_idx" ON "RevisionAttempt"("scheduleId", "attemptedAt");

-- CreateIndex
CREATE INDEX "RevisionAttempt_attemptDate_idx" ON "RevisionAttempt"("attemptDate");

-- CreateIndex
CREATE INDEX "LearningCheckpoint_topicId_idx" ON "LearningCheckpoint"("topicId");

-- CreateIndex
CREATE INDEX "Task_revisionScheduleId_idx" ON "Task"("revisionScheduleId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_revisionScheduleId_fkey" FOREIGN KEY ("revisionScheduleId") REFERENCES "RevisionSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionPrompt" ADD CONSTRAINT "RevisionPrompt_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionPrompt" ADD CONSTRAINT "RevisionPrompt_subtopicId_fkey" FOREIGN KEY ("subtopicId") REFERENCES "Subtopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionSchedule" ADD CONSTRAINT "RevisionSchedule_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionSchedule" ADD CONSTRAINT "RevisionSchedule_subtopicId_fkey" FOREIGN KEY ("subtopicId") REFERENCES "Subtopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionAttempt" ADD CONSTRAINT "RevisionAttempt_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RevisionSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionAttempt" ADD CONSTRAINT "RevisionAttempt_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "RevisionPrompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionAttempt" ADD CONSTRAINT "RevisionAttempt_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningCheckpoint" ADD CONSTRAINT "LearningCheckpoint_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningCheckpoint" ADD CONSTRAINT "LearningCheckpoint_subtopicId_fkey" FOREIGN KEY ("subtopicId") REFERENCES "Subtopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningCheckpoint" ADD CONSTRAINT "LearningCheckpoint_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "RevisionPrompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written integrity rules (not expressible in the Prisma schema)
-- ---------------------------------------------------------------------------

-- REV-13: at most one open (TODO) revision task per revision unit.
CREATE UNIQUE INDEX "Task_one_open_revision_per_schedule" ON "Task"("revisionScheduleId")
  WHERE "status" = 'TODO' AND "revisionScheduleId" IS NOT NULL;

ALTER TABLE "Task" ADD CONSTRAINT "Task_revision_link_kind"
  CHECK ("revisionScheduleId" IS NULL OR "kind" = 'REVISION');

ALTER TABLE "Settings" ADD CONSTRAINT "Settings_revisionDailyMinutes_range"
  CHECK ("revisionDailyMinutes" BETWEEN 0 AND 240);

ALTER TABLE "RevisionPrompt" ADD CONSTRAINT "RevisionPrompt_difficulty_range"
  CHECK ("difficulty" IS NULL OR "difficulty" BETWEEN 1 AND 3);
ALTER TABLE "RevisionPrompt" ADD CONSTRAINT "RevisionPrompt_content_not_blank"
  CHECK (length(trim("content")) > 0 AND length(trim("title")) > 0);
ALTER TABLE "RevisionPrompt" ADD CONSTRAINT "RevisionPrompt_key_matches_source"
  CHECK (("source" = 'LEARNER') = ("key" IS NULL));

-- The unit key always matches scope and ids, so a topic unit and a sub-topic unit can never overwrite each other.
ALTER TABLE "RevisionSchedule" ADD CONSTRAINT "RevisionSchedule_unit_consistent"
  CHECK (
    ("scope" = 'TOPIC'    AND "subtopicId" IS NULL     AND "unit" = 't:' || "topicId") OR
    ("scope" = 'SUBTOPIC' AND "subtopicId" IS NOT NULL AND "unit" = 's:' || "subtopicId")
  );
ALTER TABLE "RevisionSchedule" ADD CONSTRAINT "RevisionSchedule_counters_non_negative"
  CHECK ("previousIntervalDays" >= 0 AND "consecutiveSuccesses" >= 0 AND "consecutiveFailures" >= 0);
ALTER TABLE "RevisionSchedule" ADD CONSTRAINT "RevisionSchedule_lastScore_range"
  CHECK ("lastScore" IS NULL OR "lastScore" BETWEEN 0 AND 3);
-- No due date only while a correction is pending (score 0 waits for its correction).
ALTER TABLE "RevisionSchedule" ADD CONSTRAINT "RevisionSchedule_due_or_correction"
  CHECK ("nextDueDate" IS NOT NULL OR "correctionPending");

ALTER TABLE "RevisionAttempt" ADD CONSTRAINT "RevisionAttempt_score_range"
  CHECK ("score" BETWEEN 0 AND 3 AND "effectiveScore" BETWEEN 0 AND "score");
ALTER TABLE "RevisionAttempt" ADD CONSTRAINT "RevisionAttempt_duration_range"
  CHECK ("durationMinutes" IS NULL OR "durationMinutes" BETWEEN 1 AND 720);
ALTER TABLE "RevisionAttempt" ADD CONSTRAINT "RevisionAttempt_correction_consistent"
  CHECK (("correctedAt" IS NULL) OR "correctionCompleted");
ALTER TABLE "RevisionAttempt" ADD CONSTRAINT "RevisionAttempt_interval_non_negative"
  CHECK ("intervalDays" >= 0);
