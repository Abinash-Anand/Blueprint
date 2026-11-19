-- Multi-user foundation (docs/Sprint-Multi-User.md §3). Non-destructive: it only adds tables and columns, backfills the
-- existing Engineering City data into one city, and replaces two global unique constraints by per-city ones.
-- No table, column or row is dropped. Rehearsed on a restored copy of the live backup before commit.

-- 1. Types
CREATE TYPE "CityStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');
CREATE TYPE "AuthTokenPurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');
CREATE TYPE "CurriculumSource" AS ENUM ('BUILTIN', 'TEMPLATE', 'IMPORT', 'GENERATED');
CREATE TYPE "CurriculumVersionStatus" AS ENUM ('PROPOSED', 'APPLIED', 'REJECTED');

-- 2. New tables
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
    "language" TEXT NOT NULL DEFAULT 'en',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "onboardedAt" TIMESTAMPTZ(3),
    "passwordChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "remember" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuthToken_userId_purpose_idx" ON "AuthToken"("userId", "purpose");

CREATE TABLE "ConsentRecord" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ConsentRecord_userId_purpose_at_idx" ON "ConsentRecord"("userId", "purpose", "at");

CREATE TABLE "DeletedAccount" (
    "userId" TEXT NOT NULL,
    "deletedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeletedAccount_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "idPrefix" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "goal" TEXT NOT NULL DEFAULT '',
    "category" TEXT,
    "status" "CityStatus" NOT NULL DEFAULT 'DRAFT',
    "template" TEXT,
    "requirements" JSONB,
    "constraints" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "pausedAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "City_idPrefix_key" ON "City"("idPrefix");
CREATE INDEX "City_ownerId_status_idx" ON "City"("ownerId", "status");

CREATE TABLE "CurriculumVersion" (
    "id" SERIAL NOT NULL,
    "cityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "CurriculumVersionStatus" NOT NULL,
    "source" "CurriculumSource" NOT NULL,
    "contractVersion" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "changes" JSONB,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMPTZ(3),
    CONSTRAINT "CurriculumVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CurriculumVersion_cityId_version_key" ON "CurriculumVersion"("cityId", "version");

-- 3. The existing curriculum becomes one city, unowned until an account claims it. Only on an existing install:
--    a fresh database starts without cities (each user creates their own).
INSERT INTO "City" ("id", "ownerId", "idPrefix", "name", "description", "goal", "status", "template", "createdAt", "updatedAt")
SELECT 'engineering', NULL, '', 'Engineering City',
       'Nine-month software-engineering journey: frontend, backend, databases, architecture, cloud and applied AI.',
       'Become a strong full-stack software engineer.', 'ACTIVE', 'engineering', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "District");

-- 4. cityId on every city-owned table: add nullable, backfill, then enforce.
ALTER TABLE "District" ADD COLUMN "cityId" TEXT;
ALTER TABLE "Topic" ADD COLUMN "cityId" TEXT;
ALTER TABLE "Stage" ADD COLUMN "cityId" TEXT;
ALTER TABLE "Task" ADD COLUMN "cityId" TEXT;
ALTER TABLE "StudySession" ADD COLUMN "cityId" TEXT;
ALTER TABLE "Settings" ADD COLUMN "cityId" TEXT;
ALTER TABLE "WeeklyTarget" ADD COLUMN "cityId" TEXT;
ALTER TABLE "RevisionPrompt" ADD COLUMN "cityId" TEXT;
ALTER TABLE "RevisionSchedule" ADD COLUMN "cityId" TEXT;
ALTER TABLE "RevisionAttempt" ADD COLUMN "cityId" TEXT;
ALTER TABLE "LearningCheckpoint" ADD COLUMN "cityId" TEXT;
ALTER TABLE "RevisionEvaluation" ADD COLUMN "cityId" TEXT;

UPDATE "District" SET "cityId" = 'engineering';
UPDATE "Topic" SET "cityId" = 'engineering';
UPDATE "Stage" SET "cityId" = 'engineering';
UPDATE "Task" SET "cityId" = 'engineering';
UPDATE "StudySession" SET "cityId" = 'engineering';
UPDATE "Settings" SET "cityId" = 'engineering';
UPDATE "WeeklyTarget" SET "cityId" = 'engineering';
UPDATE "RevisionPrompt" SET "cityId" = 'engineering';
UPDATE "RevisionSchedule" SET "cityId" = 'engineering';
UPDATE "RevisionAttempt" SET "cityId" = 'engineering';
UPDATE "LearningCheckpoint" SET "cityId" = 'engineering';
UPDATE "RevisionEvaluation" SET "cityId" = 'engineering';

ALTER TABLE "District" ALTER COLUMN "cityId" SET NOT NULL;
ALTER TABLE "Topic" ALTER COLUMN "cityId" SET NOT NULL;
ALTER TABLE "Stage" ALTER COLUMN "cityId" SET NOT NULL;
ALTER TABLE "Task" ALTER COLUMN "cityId" SET NOT NULL;
ALTER TABLE "StudySession" ALTER COLUMN "cityId" SET NOT NULL;
ALTER TABLE "Settings" ALTER COLUMN "cityId" SET NOT NULL;
ALTER TABLE "WeeklyTarget" ALTER COLUMN "cityId" SET NOT NULL;
ALTER TABLE "RevisionPrompt" ALTER COLUMN "cityId" SET NOT NULL;
ALTER TABLE "RevisionSchedule" ALTER COLUMN "cityId" SET NOT NULL;
ALTER TABLE "RevisionAttempt" ALTER COLUMN "cityId" SET NOT NULL;
ALTER TABLE "LearningCheckpoint" ALTER COLUMN "cityId" SET NOT NULL;
ALTER TABLE "RevisionEvaluation" ALTER COLUMN "cityId" SET NOT NULL;
-- Default "" matches no city: a row created outside the city scope is rejected by the foreign key (fail closed).
ALTER TABLE "District" ALTER COLUMN "cityId" SET DEFAULT '';
ALTER TABLE "Topic" ALTER COLUMN "cityId" SET DEFAULT '';
ALTER TABLE "Stage" ALTER COLUMN "cityId" SET DEFAULT '';
ALTER TABLE "Task" ALTER COLUMN "cityId" SET DEFAULT '';
ALTER TABLE "StudySession" ALTER COLUMN "cityId" SET DEFAULT '';
ALTER TABLE "Settings" ALTER COLUMN "cityId" SET DEFAULT '';
ALTER TABLE "WeeklyTarget" ALTER COLUMN "cityId" SET DEFAULT '';
ALTER TABLE "RevisionPrompt" ALTER COLUMN "cityId" SET DEFAULT '';
ALTER TABLE "RevisionSchedule" ALTER COLUMN "cityId" SET DEFAULT '';
ALTER TABLE "RevisionAttempt" ALTER COLUMN "cityId" SET DEFAULT '';
ALTER TABLE "LearningCheckpoint" ALTER COLUMN "cityId" SET DEFAULT '';
ALTER TABLE "RevisionEvaluation" ALTER COLUMN "cityId" SET DEFAULT '';

-- 5. Settings: one row per city (the existing row keeps id 1; new ids continue after it). The old single-row check
--    (id = 1) is replaced by one row per city (unique cityId).
ALTER TABLE "Settings" DROP CONSTRAINT "Settings_singleton";
CREATE SEQUENCE settings_id_seq;
SELECT setval('settings_id_seq', GREATEST((SELECT COALESCE(MAX("id"), 0) FROM "Settings"), 1));
ALTER TABLE "Settings" ALTER COLUMN "id" SET DEFAULT nextval('settings_id_seq');
ALTER SEQUENCE settings_id_seq OWNED BY "Settings"."id";
CREATE UNIQUE INDEX "Settings_cityId_key" ON "Settings"("cityId");

-- 6. Weekly targets per city.
ALTER TABLE "WeeklyTarget" DROP CONSTRAINT "WeeklyTarget_pkey", ADD CONSTRAINT "WeeklyTarget_pkey" PRIMARY KEY ("cityId", "weekday");

-- 7. Uniqueness and indexes per city (the old global ones only ever held one city).
DROP INDEX "District_position_key";
CREATE UNIQUE INDEX "District_cityId_position_key" ON "District"("cityId", "position");
DROP INDEX "Stage_position_key";
CREATE UNIQUE INDEX "Stage_cityId_position_key" ON "Stage"("cityId", "position");
DROP INDEX "StudySession_date_idx";
CREATE INDEX "StudySession_cityId_date_idx" ON "StudySession"("cityId", "date");
DROP INDEX "Task_scheduledDate_idx";
CREATE INDEX "Task_cityId_scheduledDate_idx" ON "Task"("cityId", "scheduledDate");
DROP INDEX "Task_status_scheduledDate_idx";
CREATE INDEX "Task_cityId_status_scheduledDate_idx" ON "Task"("cityId", "status", "scheduledDate");
CREATE INDEX "Topic_cityId_idx" ON "Topic"("cityId");
CREATE INDEX "RevisionPrompt_cityId_idx" ON "RevisionPrompt"("cityId");
CREATE INDEX "RevisionSchedule_cityId_nextDueDate_idx" ON "RevisionSchedule"("cityId", "nextDueDate");

-- 8. Foreign keys. Deleting a city removes everything in it; deleting a user removes their cities.
ALTER TABLE "District" ADD CONSTRAINT "District_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Stage" ADD CONSTRAINT "Stage_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeeklyTarget" ADD CONSTRAINT "WeeklyTarget_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RevisionPrompt" ADD CONSTRAINT "RevisionPrompt_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RevisionSchedule" ADD CONSTRAINT "RevisionSchedule_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RevisionAttempt" ADD CONSTRAINT "RevisionAttempt_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningCheckpoint" ADD CONSTRAINT "LearningCheckpoint_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RevisionEvaluation" ADD CONSTRAINT "RevisionEvaluation_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "City" ADD CONSTRAINT "City_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CurriculumVersion" ADD CONSTRAINT "CurriculumVersion_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
