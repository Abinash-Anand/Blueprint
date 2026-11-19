-- Curriculum generation (AI design §10.3). Additive only: two version states, a usage operation, two nullable columns.
ALTER TYPE "AiOperation" ADD VALUE 'GENERATE';
ALTER TYPE "CurriculumVersionStatus" ADD VALUE 'GENERATING';
ALTER TYPE "CurriculumVersionStatus" ADD VALUE 'FAILED';
ALTER TABLE "CurriculumVersion" ADD COLUMN "progress" JSONB, ADD COLUMN "error" TEXT;
