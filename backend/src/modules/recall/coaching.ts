/**
 * Recall coaching for the Progress tab (docs/Recall-Plan.md §3.5, §7): per sub-topic, what is newly locked in, what
 * slipped, the blind spots missed in a row and mistakes that came back, computed in code from the checked reviews of
 * each sub-topic's current checklist; the short note is the one already written after the last completed review
 * (never a new AI call here). Across sub-topics: every blind spot, longest first.
 */
import type { PrismaClient } from "@prisma/client";
import type { ISODate } from "../../domain/dates.js";
import { d2i } from "../../db.js";
import { type AttemptView, type Depth, type PointStatus, computeSessionDiff } from "./rules.js";

export interface CoachingSubtopic {
  subtopicId: number; subtopic: string; topic: string; reviews: number; lastDate: ISODate;
  lastScore: number; scoreDelta: number | null; narrative: string;
  newlyMastered: string[]; slipped: string[]; blindSpots: { label: string; missedInARow: number }[];
  recurringMisconceptions: { claim: string; correction: string }[];
}
export interface Coaching {
  subtopics: CoachingSubtopic[];
  blindSpots: { subtopicId: number; subtopic: string; label: string; missedInARow: number }[];
}

const misconceptionsOf = (v: unknown): { claim: string; correction: string }[] =>
  Array.isArray(v) ? v.filter((m): m is { claim: string; correction: string } => !!m && typeof m === "object" && typeof (m as { claim?: unknown }).claim === "string" && typeof (m as { correction?: unknown }).correction === "string") : [];

export async function loadCoaching(prisma: PrismaClient, limit = 20): Promise<Coaching> {
  const reviews = await prisma.recallReview.findMany({
    where: { status: { in: ["CHECKED", "COMPLETE"] }, score: { not: null } },
    orderBy: [{ subtopicId: "asc" }, { attempt: "asc" }],
    select: {
      subtopicId: true, checklistId: true, attempt: true, date: true, score: true, depth: true, misconceptions: true,
      subtopic: { select: { name: true, topic: { select: { name: true } } } },
      results: { select: { pointId: true, status: true, recalledWhenAsked: true } },
      analysis: { select: { narrative: true } },
    },
  });
  if (!reviews.length) return { subtopics: [], blindSpots: [] };
  const checklistIds = [...new Set(reviews.map((r) => r.checklistId))];
  const points = await prisma.recallPoint.findMany({ where: { checklistId: { in: checklistIds }, leftOutAt: null }, select: { id: true, checklistId: true, label: true } });

  const bySubtopic = new Map<number, typeof reviews>();
  for (const r of reviews) bySubtopic.set(r.subtopicId, [...(bySubtopic.get(r.subtopicId) ?? []), r]);

  const subtopics: CoachingSubtopic[] = [];
  for (const all of bySubtopic.values()) {
    // Only the current checklist's reviews compare point by point.
    const checklistId = all[all.length - 1].checklistId;
    const rs = all.filter((r) => r.checklistId === checklistId);
    const last = rs[rs.length - 1];
    const labels = new Map(points.filter((p) => p.checklistId === checklistId).map((p) => [p.id, p.label]));
    const history: AttemptView[] = rs.map((r) => ({
      attempt: r.attempt, date: d2i(r.date), score: r.score ?? 0, depth: (r.depth ?? "FOUNDATIONAL") as Depth,
      points: Object.fromEntries(r.results.map((p) => [p.pointId, { status: p.status as PointStatus, recalledWhenAsked: p.recalledWhenAsked }])),
      misconceptions: misconceptionsOf(r.misconceptions),
    }));
    const diff = computeSessionDiff(history, labels);
    subtopics.push({
      subtopicId: last.subtopicId, subtopic: last.subtopic.name, topic: last.subtopic.topic.name, reviews: rs.length,
      lastDate: d2i(last.date), lastScore: last.score ?? 0, scoreDelta: diff.scoreDelta,
      narrative: last.analysis?.narrative ?? "",
      newlyMastered: diff.newlyMastered.map((x) => x.label),
      slipped: diff.regressed.map((x) => x.label),
      blindSpots: diff.persistentBlindSpots.map((x) => ({ label: x.label, missedInARow: x.missedInARow })),
      recurringMisconceptions: diff.recurringMisconceptions.map(({ claim, correction }) => ({ claim, correction })),
    });
  }
  subtopics.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.subtopic.localeCompare(b.subtopic));
  const blindSpots = subtopics
    .flatMap((s) => s.blindSpots.map((b) => ({ subtopicId: s.subtopicId, subtopic: s.subtopic, ...b })))
    .sort((a, b) => b.missedInARow - a.missedInARow || a.subtopic.localeCompare(b.subtopic));
  return { subtopics: subtopics.slice(0, limit), blindSpots: blindSpots.slice(0, limit) };
}
