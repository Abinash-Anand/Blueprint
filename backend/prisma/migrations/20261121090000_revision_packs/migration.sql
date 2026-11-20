-- Revision v2, phase 1 (docs/Revision-v2-Plan.md §5, §8): a topic's revision material (extracted text only), its
-- revision pack, the pack's concepts and their questions. Additive: four new tables, four new enums and one new value
-- in AiOperation (its own usage-ledger operation and hourly limit); no existing table, column or row changes.
--
-- Rollback (deletes only what this migration created):
--   DROP TABLE "RevisionItem"; DROP TABLE "RevisionConcept"; DROP TABLE "RevisionPack"; DROP TABLE "RevisionMaterial";
--   DROP TYPE "RevisionContentSource"; DROP TYPE "RevisionConceptStatus"; DROP TYPE "RevisionPackBasis"; DROP TYPE "RevisionPackStatus";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261121090000_revision_packs';
--   The AiOperation value REVISION_PACK cannot be dropped in place; it is harmless when unused. To remove it, first
--   DELETE FROM "AiUsage" WHERE operation = 'REVISION_PACK', then recreate the type without it.

-- AlterEnum
ALTER TYPE "AiOperation" ADD VALUE 'REVISION_PACK';

-- CreateEnum
CREATE TYPE "RevisionPackStatus" AS ENUM ('BUILDING', 'READY', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RevisionPackBasis" AS ENUM ('MATERIAL', 'OUTLINE');

-- CreateEnum
CREATE TYPE "RevisionConceptStatus" AS ENUM ('BUILDING', 'READY', 'NEEDS_QUESTIONS');

-- CreateEnum
CREATE TYPE "RevisionContentSource" AS ENUM ('AI', 'EDITED', 'LEARNER');

-- CreateTable
CREATE TABLE "RevisionMaterial" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL DEFAULT '',
    "topicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "pages" INTEGER,
    "chars" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevisionMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionPack" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL DEFAULT '',
    "topicId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RevisionPackStatus" NOT NULL DEFAULT 'BUILDING',
    "basis" "RevisionPackBasis" NOT NULL,
    "language" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "progress" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RevisionPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionConcept" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL DEFAULT '',
    "packId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "subtopicId" INTEGER,
    "keyPoints" JSONB NOT NULL DEFAULT '[]',
    "misconceptions" JSONB NOT NULL DEFAULT '[]',
    "source" "RevisionContentSource" NOT NULL DEFAULT 'AI',
    "status" "RevisionConceptStatus" NOT NULL DEFAULT 'READY',
    "removedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevisionConcept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionItem" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL DEFAULT '',
    "conceptId" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "situation" TEXT NOT NULL DEFAULT '',
    "code" TEXT,
    "question" TEXT NOT NULL,
    "answerSize" TEXT NOT NULL DEFAULT '',
    "expected" JSONB NOT NULL,
    "modelAnswer" TEXT NOT NULL,
    "hints" JSONB NOT NULL,
    "options" JSONB,
    "source" "RevisionContentSource" NOT NULL DEFAULT 'AI',
    "removedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RevisionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RevisionMaterial_topicId_idx" ON "RevisionMaterial"("topicId");

-- CreateIndex
CREATE INDEX "RevisionMaterial_cityId_idx" ON "RevisionMaterial"("cityId");

-- CreateIndex
CREATE INDEX "RevisionPack_cityId_idx" ON "RevisionPack"("cityId");

-- CreateIndex
CREATE UNIQUE INDEX "RevisionPack_topicId_version_key" ON "RevisionPack"("topicId", "version");

-- CreateIndex
CREATE INDEX "RevisionConcept_packId_idx" ON "RevisionConcept"("packId");

-- CreateIndex
CREATE INDEX "RevisionConcept_cityId_idx" ON "RevisionConcept"("cityId");

-- CreateIndex
CREATE INDEX "RevisionItem_conceptId_level_idx" ON "RevisionItem"("conceptId", "level");

-- CreateIndex
CREATE INDEX "RevisionItem_cityId_idx" ON "RevisionItem"("cityId");

-- AddForeignKey
ALTER TABLE "RevisionMaterial" ADD CONSTRAINT "RevisionMaterial_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionMaterial" ADD CONSTRAINT "RevisionMaterial_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionPack" ADD CONSTRAINT "RevisionPack_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionPack" ADD CONSTRAINT "RevisionPack_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionConcept" ADD CONSTRAINT "RevisionConcept_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionConcept" ADD CONSTRAINT "RevisionConcept_packId_fkey" FOREIGN KEY ("packId") REFERENCES "RevisionPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionConcept" ADD CONSTRAINT "RevisionConcept_subtopicId_fkey" FOREIGN KEY ("subtopicId") REFERENCES "Subtopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionItem" ADD CONSTRAINT "RevisionItem_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionItem" ADD CONSTRAINT "RevisionItem_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "RevisionConcept"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Question levels are 1 to 6 (plan §4.3).
ALTER TABLE "RevisionItem" ADD CONSTRAINT "RevisionItem_level_check" CHECK ("level" BETWEEN 1 AND 6);
