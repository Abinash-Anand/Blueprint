-- Recall: a plain statement for each checklist point, what a correct answer would say, shown next to the learner's
-- words and never graded. Additive: existing points get NULL until their statements are written.
ALTER TABLE "RecallPoint" ADD COLUMN "statement" TEXT;
