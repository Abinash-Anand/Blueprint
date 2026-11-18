-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('CORE', 'IMPORTANT', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('ROADMAP', 'DOCS', 'COURSE', 'ARTICLE');

-- CreateEnum
CREATE TYPE "StageKind" AS ENUM ('MAIN', 'PARALLEL');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('STUDY', 'PRACTICE', 'REVISION');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('PLAN', 'MANUAL');

-- CreateTable
CREATE TABLE "District" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL,
    "layer" INTEGER NOT NULL,
    "color" CHAR(7) NOT NULL,
    "cols" INTEGER NOT NULL,
    "goal" TEXT NOT NULL,
    "note" TEXT NOT NULL,

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "Priority" NOT NULL,
    "estimatedHours" INTEGER NOT NULL,
    "exercise" TEXT NOT NULL,
    "demonstratedAt" TIMESTAMPTZ(3),
    "demonstrationNote" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subtopic" (
    "id" SERIAL NOT NULL,
    "topicId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Subtopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" SERIAL NOT NULL,
    "topicId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" "ResourceKind" NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicDependency" (
    "topicId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,

    CONSTRAINT "TopicDependency_pkey" PRIMARY KEY ("topicId","dependsOnId")
);

-- CreateTable
CREATE TABLE "Stage" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StageKind" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,

    CONSTRAINT "Stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" SERIAL NOT NULL,
    "topicId" TEXT,
    "subtopicId" INTEGER,
    "stageId" TEXT,
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "kind" "TaskKind" NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "originalDate" DATE NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "completedAt" TIMESTAMPTZ(3),
    "source" "TaskSource" NOT NULL,
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudySession" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "taskId" INTEGER,
    "topicId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "journeyStart" DATE NOT NULL,
    "journeyEnd" DATE NOT NULL,
    "timezone" TEXT NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyTarget" (
    "weekday" INTEGER NOT NULL,
    "targetMinutes" INTEGER NOT NULL,

    CONSTRAINT "WeeklyTarget_pkey" PRIMARY KEY ("weekday")
);

-- CreateTable
CREATE TABLE "_DistrictToStage" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DistrictToStage_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "District_position_key" ON "District"("position");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_districtId_position_key" ON "Topic"("districtId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Subtopic_topicId_position_key" ON "Subtopic"("topicId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_topicId_position_key" ON "Resource"("topicId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Stage_position_key" ON "Stage"("position");

-- CreateIndex
CREATE INDEX "Task_scheduledDate_idx" ON "Task"("scheduledDate");

-- CreateIndex
CREATE INDEX "Task_status_scheduledDate_idx" ON "Task"("status", "scheduledDate");

-- CreateIndex
CREATE INDEX "Task_topicId_idx" ON "Task"("topicId");

-- CreateIndex
CREATE INDEX "Task_stageId_idx" ON "Task"("stageId");

-- CreateIndex
CREATE INDEX "StudySession_date_idx" ON "StudySession"("date");

-- CreateIndex
CREATE INDEX "StudySession_taskId_idx" ON "StudySession"("taskId");

-- CreateIndex
CREATE INDEX "_DistrictToStage_B_index" ON "_DistrictToStage"("B");

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subtopic" ADD CONSTRAINT "Subtopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicDependency" ADD CONSTRAINT "TopicDependency_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicDependency" ADD CONSTRAINT "TopicDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_subtopicId_fkey" FOREIGN KEY ("subtopicId") REFERENCES "Subtopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DistrictToStage" ADD CONSTRAINT "_DistrictToStage_A_fkey" FOREIGN KEY ("A") REFERENCES "District"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DistrictToStage" ADD CONSTRAINT "_DistrictToStage_B_fkey" FOREIGN KEY ("B") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Business-rule CHECK constraints (not expressible in the Prisma schema; added by hand).
ALTER TABLE "District" ADD CONSTRAINT "District_color_hex" CHECK ("color" ~ '^#[0-9a-f]{6}$');
ALTER TABLE "District" ADD CONSTRAINT "District_layer_range" CHECK ("layer" BETWEEN 1 AND 5);
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_hours_positive" CHECK ("estimatedHours" > 0);
ALTER TABLE "Stage" ADD CONSTRAINT "Stage_dates_ordered" CHECK ("endDate" >= "startDate");
ALTER TABLE "Task" ADD CONSTRAINT "Task_estimate_range" CHECK ("estimatedMinutes" BETWEEN 5 AND 720);
ALTER TABLE "Task" ADD CONSTRAINT "Task_done_has_timestamp" CHECK (("status" = 'DONE') = ("completedAt" IS NOT NULL));
ALTER TABLE "Task" ADD CONSTRAINT "Task_reschedule_nonnegative" CHECK ("rescheduleCount" >= 0);
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_minutes_range" CHECK ("minutes" BETWEEN 1 AND 720);
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_singleton" CHECK ("id" = 1);
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_dates_ordered" CHECK ("journeyEnd" > "journeyStart");
ALTER TABLE "WeeklyTarget" ADD CONSTRAINT "WeeklyTarget_weekday_range" CHECK ("weekday" BETWEEN 1 AND 7);
ALTER TABLE "WeeklyTarget" ADD CONSTRAINT "WeeklyTarget_minutes_range" CHECK ("targetMinutes" BETWEEN 0 AND 960);
