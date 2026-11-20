-- Revision v2, phases 2 and 3 (docs/Revision-v2-Plan.md §4, §6, §8): a revision track per topic (cycles 1-6 and their
-- dates), sessions, every answered question with its evidence, and each concept's result per cycle. Additive: four new
-- tables, three new enums and two nullable columns on RevisionReport; no existing row changes.
--
-- Rollback (deletes only what this migration created):
--   DROP TABLE "ConceptResult"; DROP TABLE "RevisionResponse"; DROP TABLE "RevisionSession"; DROP TABLE "RevisionTrack";
--   DROP TYPE "RevisionSessionStatus"; DROP TYPE "RevisionSessionKind"; DROP TYPE "RevisionTrackState";
--   ALTER TABLE "RevisionReport" DROP COLUMN "itemId", DROP COLUMN "responseId";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261122090000_revision_sessions';

-- CreateEnum
CREATE TYPE "RevisionTrackState" AS ENUM ('ACTIVE', 'RETAINED');

-- CreateEnum
CREATE TYPE "RevisionSessionKind" AS ENUM ('PLANNED', 'EARLY', 'PRACTICE');

-- CreateEnum
CREATE TYPE "RevisionSessionStatus" AS ENUM ('ACTIVE', 'FINISHED');

-- AlterTable
ALTER TABLE "RevisionReport" ADD COLUMN     "itemId" INTEGER,
ADD COLUMN     "responseId" INTEGER;

-- CreateTable
CREATE TABLE "RevisionTrack" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL DEFAULT '',
    "topicId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL DEFAULT 0,
    "state" "RevisionTrackState" NOT NULL DEFAULT 'ACTIVE',
    "nextDueDate" DATE,
    "lastReviewDate" DATE,
    "weakOnly" BOOLEAN NOT NULL DEFAULT false,
    "maintenance" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RevisionTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionSession" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL DEFAULT '',
    "date" DATE NOT NULL,
    "kind" "RevisionSessionKind" NOT NULL,
    "status" "RevisionSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "budgetMinutes" INTEGER NOT NULL,
    "plannedMinutes" INTEGER NOT NULL,
    "queue" JSONB NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RevisionSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionResponse" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL DEFAULT '',
    "sessionId" INTEGER NOT NULL,
    "itemId" INTEGER,
    "conceptId" INTEGER,
    "topicId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "relearn" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "code" TEXT,
    "expected" JSONB NOT NULL,
    "modelAnswer" TEXT NOT NULL,
    "confidence" INTEGER,
    "mode" TEXT NOT NULL,
    "answer" TEXT NOT NULL DEFAULT '',
    "choice" JSONB,
    "correct" BOOLEAN,
    "evaluation" JSONB,
    "hintsUsed" INTEGER NOT NULL DEFAULT 0,
    "modelShown" BOOLEAN NOT NULL DEFAULT false,
    "suggested" INTEGER,
    "final" INTEGER,
    "seconds" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevisionResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConceptResult" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL DEFAULT '',
    "conceptId" INTEGER,
    "conceptTitle" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "cycle" INTEGER NOT NULL,
    "result" INTEGER NOT NULL,
    "firstResult" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConceptResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RevisionTrack_topicId_key" ON "RevisionTrack"("topicId");

-- CreateIndex
CREATE INDEX "RevisionTrack_cityId_nextDueDate_idx" ON "RevisionTrack"("cityId", "nextDueDate");

-- CreateIndex
CREATE INDEX "RevisionSession_cityId_date_idx" ON "RevisionSession"("cityId", "date");

-- CreateIndex
CREATE INDEX "RevisionResponse_sessionId_idx" ON "RevisionResponse"("sessionId");

-- CreateIndex
CREATE INDEX "RevisionResponse_conceptId_idx" ON "RevisionResponse"("conceptId");

-- CreateIndex
CREATE INDEX "RevisionResponse_cityId_idx" ON "RevisionResponse"("cityId");

-- CreateIndex
CREATE INDEX "ConceptResult_topicId_cycle_idx" ON "ConceptResult"("topicId", "cycle");

-- CreateIndex
CREATE INDEX "ConceptResult_conceptId_idx" ON "ConceptResult"("conceptId");

-- CreateIndex
CREATE INDEX "ConceptResult_cityId_idx" ON "ConceptResult"("cityId");

-- AddForeignKey
ALTER TABLE "RevisionTrack" ADD CONSTRAINT "RevisionTrack_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionTrack" ADD CONSTRAINT "RevisionTrack_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionSession" ADD CONSTRAINT "RevisionSession_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionResponse" ADD CONSTRAINT "RevisionResponse_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionResponse" ADD CONSTRAINT "RevisionResponse_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RevisionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionResponse" ADD CONSTRAINT "RevisionResponse_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "RevisionItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionResponse" ADD CONSTRAINT "RevisionResponse_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "RevisionConcept"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionResponse" ADD CONSTRAINT "RevisionResponse_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptResult" ADD CONSTRAINT "ConceptResult_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptResult" ADD CONSTRAINT "ConceptResult_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "RevisionConcept"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptResult" ADD CONSTRAINT "ConceptResult_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptResult" ADD CONSTRAINT "ConceptResult_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RevisionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Cycles are 0 to 6 completed; results and confidence are 0 to 3 (plan §4.2, §4.4).
ALTER TABLE "RevisionTrack" ADD CONSTRAINT "RevisionTrack_cycle_check" CHECK ("cycle" BETWEEN 0 AND 6);
ALTER TABLE "ConceptResult" ADD CONSTRAINT "ConceptResult_result_check" CHECK ("result" BETWEEN 0 AND 3 AND "firstResult" BETWEEN 0 AND 3);
ALTER TABLE "RevisionResponse" ADD CONSTRAINT "RevisionResponse_scores_check" CHECK (("final" IS NULL OR "final" BETWEEN 0 AND 3) AND ("suggested" IS NULL OR "suggested" BETWEEN 0 AND 3) AND ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 3));
