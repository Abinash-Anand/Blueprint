/**
 * Revision section read model (Revision enhancement, SRS FR-REV-19 to FR-REV-22, LLD §4.3).
 * Read-only: it derives every list from the one authoritative RevisionSchedule table and never schedules anything.
 */
import type { PrismaClient } from "@prisma/client";
import { addDays, diffDays } from "../../domain/dates.js";
import { type RevisionCandidate, displayStatus, interleave, isWeak, revisionOrder } from "../../domain/revision.js";
import { attentionPresentation, checkpointPresentation, revisionPresentation } from "../../domain/presentation.js";
import { d2i } from "../../db.js";
import type { Clock } from "../../lib/clock.js";
import { attemptDTO, revisionPolicy } from "./service.js";

export const UPCOMING_DAYS = 14;
const HISTORY_LIMIT = 50;

export function revisionOverview(prisma: PrismaClient, clock: Clock) {
  return async () => {
    const today = clock.today();
    const [policy, schedules, suspended, attempts, checkpoints] = await Promise.all([
      revisionPolicy(prisma),
      prisma.revisionSchedule.findMany({
        where: { suspendedAt: null },
        include: {
          topic: { select: { name: true, districtId: true } },
          subtopic: { select: { name: true } },
          tasks: { where: { status: "TODO" }, select: { id: true, scheduledDate: true } },
          attempts: { orderBy: [{ attemptedAt: "desc" }, { id: "desc" }], take: 1, select: { id: true } },
        },
        orderBy: { id: "asc" },
      }),
      prisma.revisionSchedule.count({ where: { suspendedAt: { not: null } } }),
      prisma.revisionAttempt.findMany({
        orderBy: [{ attemptedAt: "desc" }, { id: "desc" }],
        take: HISTORY_LIMIT,
        include: { schedule: { select: { scope: true, topicId: true, topic: { select: { name: true } }, subtopic: { select: { name: true } } } } },
      }),
      prisma.learningCheckpoint.findMany({
        orderBy: [{ completedAt: "desc" }, { id: "desc" }],
        take: 20,
        include: { topic: { select: { name: true } }, subtopic: { select: { name: true } } },
      }),
    ]);

    const units = schedules.map((s) => {
      const due = s.nextDueDate ? d2i(s.nextDueDate) : null;
      const lastAttemptDate = s.lastAttemptDate ? d2i(s.lastAttemptDate) : null;
      const weak = isWeak(s, policy);
      return {
        scheduleId: s.id,
        topicId: s.topicId,
        topicName: s.topic.name,
        districtId: s.topic.districtId,
        subtopicId: s.subtopicId,
        scope: s.scope,
        label: s.scope === "TOPIC" ? `${s.topic.name} (whole topic)` : (s.subtopic?.name ?? s.topic.name),
        status: displayStatus({ nextDueDate: due, correctionPending: s.correctionPending, suspended: false }, today),
        nextDueDate: due,
        overdueDays: due && due < today ? diffDays(due, today) : 0,
        lastAttemptDate,
        lastScore: s.lastScore,
        consecutiveSuccesses: s.consecutiveSuccesses,
        weak,
        presentation: revisionPresentation({ correctionPending: s.correctionPending, nextDueDate: due, lastAttemptDate, weak }, today),
        correctionPending: s.correctionPending,
        pendingAttemptId: s.correctionPending ? (s.attempts[0]?.id ?? null) : null,
        openTask: s.tasks[0] ? { id: s.tasks[0].id, scheduledDate: d2i(s.tasks[0].scheduledDate) } : null,
      };
    });
    type Unit = (typeof units)[number];

    // Same priority as placement (spec §8.5): overdue weak first, then oldest due, lowest score, longest since last.
    const cand = (u: Unit): RevisionCandidate => ({
      scheduleId: u.scheduleId, dueDate: u.nextDueDate ?? "9999-12-31", minutes: 0, weak: u.weak,
      lastScore: u.lastScore, lastAttemptDate: u.lastAttemptDate,
    });
    const byPriority = (a: Unit, b: Unit) => revisionOrder(today)(cand(a), cand(b));
    const horizon = addDays(today, UPCOMING_DAYS);

    const overdue = units.filter((u) => u.status === "OVERDUE").sort(byPriority);
    const due = units.filter((u) => u.status === "DUE").sort(byPriority);
    const upcoming = units
      .filter((u) => u.status === "SCHEDULED" && u.nextDueDate! <= horizon)
      .sort((a, b) => a.nextDueDate!.localeCompare(b.nextDueDate!) || a.scheduleId - b.scheduleId);
    const later = units.filter((u) => u.status === "SCHEDULED" && u.nextDueDate! > horizon).length;
    const weak = units.filter((u) => u.weak).sort(byPriority);
    const awaitingCorrection = units.filter((u) => u.correctionPending);

    // A session covers everything due now that can be attempted (not blocked by a correction), interleaved by topic.
    const session = interleave([...overdue, ...due].filter((u) => !u.correctionPending).sort(byPriority), (u) => u.topicId)
      .map((u) => ({ topicId: u.topicId, scope: u.scope, subtopicId: u.subtopicId }));

    return {
      today,
      upcomingDays: UPCOMING_DAYS,
      dailyAllowanceMinutes: policy.dailyBudgetMinutes,
      weeklyOvertimeMinutes: policy.weeklyOvertimeMinutes,
      counts: {
        due: due.length, overdue: overdue.length, upcoming: upcoming.length, later, weak: weak.length,
        awaitingCorrection: awaitingCorrection.length, active: units.length, paused: suspended,
      },
      attention: attentionPresentation(due.length + overdue.length, overdue.length),
      overdue, due, upcoming, weak, awaitingCorrection, session,
      history: attempts.map((a) => ({
        ...attemptDTO({ ...a, schedule: { scope: a.schedule.scope, topic: a.schedule.topic, subtopic: a.schedule.subtopic } }),
        topicId: a.schedule.topicId,
        topicName: a.schedule.topic.name,
      })),
      checkpoints: checkpoints.map((c) => ({
        id: c.id, topicId: c.topicId, topicName: c.topic.name, subtopicId: c.subtopicId, label: c.subtopic.name,
        result: c.result, presentation: checkpointPresentation(c.result), neededAssistance: c.neededAssistance, gaps: c.gaps, date: d2i(c.date),
      })),
    };
  };
}
export type RevisionOverviewDTO = Awaited<ReturnType<ReturnType<typeof revisionOverview>>>;
