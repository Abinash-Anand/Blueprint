-- Recall tasks (docs/Recall-Plan.md, the planned workflow): a recall is planned into the day as a task again, linked to
-- its sub-topic's RecallState like the earlier revision tasks were linked to their schedule.
--
-- Additive: one nullable column, its foreign key, an index and a partial unique index. No data is changed; the app
-- plans the tasks itself. Rollback:
--   DROP INDEX "Task_recallStateId_open_key"; DROP INDEX "Task_recallStateId_idx";
--   ALTER TABLE "Task" DROP CONSTRAINT "Task_recallStateId_fkey", DROP COLUMN "recallStateId";

ALTER TABLE "Task" ADD COLUMN "recallStateId" INTEGER;

ALTER TABLE "Task" ADD CONSTRAINT "Task_recallStateId_fkey" FOREIGN KEY ("recallStateId") REFERENCES "RecallState"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Task_recallStateId_idx" ON "Task"("recallStateId");

-- At most one open recall task per sub-topic in recall.
CREATE UNIQUE INDEX "Task_recallStateId_open_key" ON "Task"("recallStateId") WHERE "status" = 'TODO';
