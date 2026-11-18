-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "InputMode" AS ENUM ('TYPED', 'SPOKEN');

-- CreateEnum
CREATE TYPE "AiOperation" AS ENUM ('TRANSCRIBE', 'EVALUATE');

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "aiConsentAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "RevisionAttempt" ADD COLUMN     "evaluationId" INTEGER,
ADD COLUMN     "inputMode" "InputMode" NOT NULL DEFAULT 'TYPED',
ADD COLUMN     "selfScore" INTEGER;

-- CreateTable
CREATE TABLE "RevisionEvaluation" (
    "id" SERIAL NOT NULL,
    "scheduleId" INTEGER NOT NULL,
    "promptId" INTEGER,
    "parentId" INTEGER,
    "inputHash" TEXT NOT NULL,
    "promptText" TEXT NOT NULL,
    "criteriaText" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "followUpQuestion" TEXT,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "suggestedScore" INTEGER,
    "errorCode" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RevisionEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operation" "AiOperation" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "audioSeconds" INTEGER,
    "costMicroEur" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RevisionEvaluation_createdAt_idx" ON "RevisionEvaluation"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RevisionEvaluation_scheduleId_inputHash_key" ON "RevisionEvaluation"("scheduleId", "inputHash");

-- CreateIndex
CREATE INDEX "AiUsage_at_idx" ON "AiUsage"("at");

-- CreateIndex
CREATE UNIQUE INDEX "RevisionAttempt_evaluationId_key" ON "RevisionAttempt"("evaluationId");

-- AddForeignKey
ALTER TABLE "RevisionAttempt" ADD CONSTRAINT "RevisionAttempt_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "RevisionEvaluation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionEvaluation" ADD CONSTRAINT "RevisionEvaluation_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "RevisionSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionEvaluation" ADD CONSTRAINT "RevisionEvaluation_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "RevisionPrompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionEvaluation" ADD CONSTRAINT "RevisionEvaluation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "RevisionEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Integrity rules the Prisma schema cannot express (AI design §5.1).
ALTER TABLE "RevisionAttempt" ADD CONSTRAINT "RevisionAttempt_selfScore_range" CHECK ("selfScore" IS NULL OR "selfScore" BETWEEN 0 AND 3);
ALTER TABLE "RevisionEvaluation" ADD CONSTRAINT "RevisionEvaluation_suggestedScore_range" CHECK ("suggestedScore" IS NULL OR "suggestedScore" BETWEEN 0 AND 3);
ALTER TABLE "RevisionEvaluation" ADD CONSTRAINT "RevisionEvaluation_succeeded_has_result" CHECK (("status" = 'SUCCEEDED') = ("result" IS NOT NULL AND "suggestedScore" IS NOT NULL));
ALTER TABLE "RevisionEvaluation" ADD CONSTRAINT "RevisionEvaluation_failed_has_code" CHECK ("status" <> 'FAILED' OR "errorCode" IS NOT NULL);
ALTER TABLE "RevisionEvaluation" ADD CONSTRAINT "RevisionEvaluation_followup_has_question" CHECK ("parentId" IS NULL OR "followUpQuestion" IS NOT NULL);
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_non_negative" CHECK ("costMicroEur" >= 0 AND "latencyMs" >= 0);
