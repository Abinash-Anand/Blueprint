/**
 * Read-side aggregates: Today (Mission Control), Week and Progress (LLD §4.3, §10–§12.4).
 */
import type { PrismaClient } from "@prisma/client";
import {
  type ISODate, addDays, diffDays, eachDay, isoWeekday, maxDate, minDate, monthKey, weekStart,
} from "../../domain/dates.js";
import { attentionPresentation, districtPresentation, milestonePresentation, stagePresentation } from "../../domain/presentation.js";
import { currentTopicId, districtFraction, districtPassed, roadProgress } from "../../domain/progress.js";
import { eligibleDays, reservedDates, type PlanStage } from "../../domain/planner.js";
import { interleave, isWeak, overTarget } from "../../domain/revision.js";
import { d2i, i2d } from "../../db.js";
import type { Clock } from "../../lib/clock.js";
import { loadLearning } from "../learning.js";
import { loadCoaching } from "../recall/coaching.js";
import { loadSettings, loadTargets, loadWeek, stageDTO, stageInclude } from "../schedule/service.js";
import { forecast } from "../../domain/forecast.js";
import { RULES, gapFor } from "../recall/rules.js";
import { sessionDTO } from "../sessions/routes.js";
import { taskDTO, taskInclude, taskOrder } from "../tasks/mapper.js";

const MAIN_WEEKDAYS = [1, 2, 3, 4, 5, 6];
const PARALLEL_WEEKDAYS = [6]; // the parallel architecture track uses Saturdays (SRS §6)

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
/** Revision tasks: the earlier sub-topic revisions and recall tasks (docs/Recall-Plan.md); never learning. */
const isRevision = (t: { source: string }) => t.source === "REVISION";

export function summaryService(prisma: PrismaClient, clock: Clock) {
  async function stagesWithRules() {
    const rows = await prisma.stage.findMany({ orderBy: { position: "asc" }, include: stageInclude });
    return rows.map((r) => {
      const dto = stageDTO(r);
      const plan: PlanStage = {
        slug: dto.id, kind: dto.kind, start: dto.startDate, end: dto.endDate, queue: dto.id,
        weekdays: dto.kind === "PARALLEL" ? PARALLEL_WEEKDAYS : MAIN_WEEKDAYS,
      };
      return { dto, plan };
    });
  }

  return {
    async today(date?: ISODate) {
      const today = clock.today();
      const day = date ?? today;
      const [settings, targets, learning, stages] = await Promise.all([
        loadSettings(prisma), loadTargets(prisma), loadLearning(prisma), stagesWithRules(),
      ]);
      const recallOpen = { recallStateId: { not: null }, status: "TODO" as const };
      const [tasks, carried, sessions, reviews, recallDue, recallOverdue, recallTomorrow] = await Promise.all([
        prisma.task.findMany({ where: { scheduledDate: i2d(day) }, include: taskInclude, orderBy: taskOrder }),
        day === today
          ? prisma.task.findMany({ where: { status: "TODO", scheduledDate: { lt: i2d(today) } }, include: taskInclude, orderBy: taskOrder })
          : Promise.resolve([]),
        prisma.studySession.findMany({ where: { date: i2d(day) }, orderBy: { id: "asc" } }),
        prisma.topic.findMany({ where: { needsReview: true }, select: { id: true, name: true, districtId: true }, orderBy: { id: "asc" } }),
        // Recall (docs/Recall-Plan.md): always as of the real today, for the sidebar, the tab badge and Today.
        prisma.task.count({ where: { ...recallOpen, scheduledDate: { lte: i2d(today) } } }),
        prisma.task.count({ where: { ...recallOpen, scheduledDate: { lt: i2d(today) } } }),
        prisma.task.count({ where: { ...recallOpen, scheduledDate: i2d(addDays(today, 1)) } }),
      ]);

      const inJourney = day >= settings.journeyStart && day <= settings.journeyEnd;
      const weekdayTarget = targets[isoWeekday(day)] ?? 0;
      const target = inJourney ? weekdayTarget : 0;
      const live = tasks.filter((t) => t.status !== "SKIPPED");
      const open = tasks.filter((t) => t.status === "TODO");
      const road = roadProgress(learning.districts);
      const topicId = currentTopicId(learning.districts, open.map((t) => t.topicId));
      const currentDistrictId = topicId
        ? (learning.topicNames.get(topicId)?.districtId ?? null)
        : (learning.districts[road.currentDistrictIndex]?.id ?? null);
      const nextSub = topicId ? learning.subtopics.get(topicId)?.find((s) => !s.completedAt) : undefined;

      return {
        date: day,
        today,
        /** The city's time zone: "today" is counted in it. */
        timezone: settings.timezone,
        weekday: isoWeekday(day),
        isRestDay: weekdayTarget === 0,
        isBufferDay: target > 0 && !tasks.some((t) => !isRevision(t)),
        journey: {
          start: settings.journeyStart,
          end: settings.journeyEnd,
          day: diffDays(settings.journeyStart, day) + 1,
          totalDays: diffDays(settings.journeyStart, settings.journeyEnd) + 1,
          status: day < settings.journeyStart ? "BEFORE" : day > settings.journeyEnd ? "AFTER" : "ACTIVE",
        },
        targetMinutes: target,
        plannedMinutes: sum(live, (t) => t.estimatedMinutes),
        doneMinutes: sum(tasks.filter((t) => t.status === "DONE"), (t) => t.estimatedMinutes),
        actualMinutes: sum(sessions, (s) => s.minutes),
        tasks: tasks.map((t) => taskDTO(t, today)),
        carriedOver: carried.map((t) => taskDTO(t, today)),
        sessions: sessions.map(sessionDTO),
        stages: stages.filter((s) => s.dto.startDate <= day && day <= s.dto.endDate).map((s) => s.dto),
        current: { districtId: currentDistrictId, topicId },
        next: topicId ? { topicId, subtopic: nextSub?.name ?? null } : null,
        reviewTopics: reviews,
        recall: {
          dueCount: recallDue,
          overdueCount: recallOverdue,
          tomorrowCount: recallTomorrow,
          plannedMinutes: sum(live.filter(isRevision), (t) => t.estimatedMinutes),
        },
      };
    },

    async week(date?: ISODate) {
      const today = clock.today();
      const ws = weekStart(date ?? today);
      const we = addDays(ws, 6);
      const [settings, targets, tasks, sessions, stages, recalls] = await Promise.all([
        loadSettings(prisma),
        loadTargets(prisma),
        prisma.task.findMany({ where: { scheduledDate: { gte: i2d(ws), lte: i2d(we) } }, include: taskInclude, orderBy: taskOrder }),
        prisma.studySession.findMany({ where: { date: { gte: i2d(ws), lte: i2d(we) } } }),
        stagesWithRules(),
        // Recall (docs/Recall-Plan.md §3.1): sub-topics due this week; anything already overdue is shown on today.
        prisma.recallState.findMany({
          where: { nextDueDate: { not: null, lte: i2d(we) } },
          select: { nextDueDate: true, subtopic: { select: { name: true } }, tasks: { where: { status: "TODO" }, select: { scheduledDate: true }, orderBy: { scheduledDate: "asc" }, take: 1 } },
          orderBy: [{ nextDueDate: "asc" }, { subtopicId: "asc" }],
        }),
      ]);
      // The day a recall is planned on (its open task, moved off rest days and over the daily limit), else its due date.
      const recallDay = (r: (typeof recalls)[number]) => {
        const due = d2i(r.tasks[0]?.scheduledDate ?? r.nextDueDate!);
        return due < today ? today : due;
      };
      const live = tasks.filter((t) => t.status !== "SKIPPED");
      const days = eachDay(ws, we).map((d) => {
        const dt = live.filter((t) => d2i(t.scheduledDate) === d);
        const inJourney = d >= settings.journeyStart && d <= settings.journeyEnd;
        return {
          date: d,
          weekday: isoWeekday(d),
          inJourney,
          isRestDay: (targets[isoWeekday(d)] ?? 0) === 0,
          // Days outside the journey carry no target (nothing is expected before 17 Nov 2026).
          targetMinutes: inJourney ? (targets[isoWeekday(d)] ?? 0) : 0,
          plannedMinutes: sum(dt, (t) => t.estimatedMinutes),
          actualMinutes: sum(sessions.filter((s) => d2i(s.date) === d), (s) => s.minutes),
          tasksTotal: dt.length,
          tasksDone: dt.filter((t) => t.status === "DONE").length,
          revisionTasks: dt.filter(isRevision).length,
          /** Sub-topics due for recall on this day (names). */
          recall: recalls.filter((r) => recallDay(r) === d).map((r) => r.subtopic.name),
          revisionPlannedMinutes: sum(dt.filter(isRevision), (t) => t.estimatedMinutes),
          revisionDoneMinutes: sum(dt.filter((t) => isRevision(t) && t.status === "DONE"), (t) => t.estimatedMinutes),
          // Planned beyond the day's target (learning + revision); Sunday and days outside the journey have no target.
          overTargetMinutes: inJourney ? overTarget(sum(dt, (t) => t.estimatedMinutes), 0, targets[isoWeekday(d)] ?? 0) : 0,
        };
      });
      const todo = live.filter((t) => t.status === "TODO");
      const horizon = addDays(ws, 13);
      // One practice milestone per topic: its last practice part this week; done when every part is done.
      const practice = new Map<string, (typeof live)[number][]>();
      for (const t of live.filter((x) => x.kind === "PRACTICE")) {
        const key = t.topicId ?? `task-${t.id}`;
        practice.set(key, [...(practice.get(key) ?? []), t]);
      }
      const milestones = [
        ...[...practice.values()].map((parts) => {
          const last = parts.reduce((a, b) => (d2i(b.scheduledDate) > d2i(a.scheduledDate) ? b : a));
          return {
            date: d2i(last.scheduledDate), type: "PRACTICE" as const,
            title: last.topic ? `Practice: ${last.topic.name}` : last.title.replace(/ \(part \d+ of \d+\)$/, ""),
            topicId: last.topicId, stageId: last.stageId, done: parts.every((p) => p.status === "DONE"),
          };
        }),
        ...stages
          .filter((s) => s.dto.endDate >= ws && s.dto.endDate <= horizon)
          .map((s) => ({
            date: s.dto.endDate, type: "STAGE_END" as const, title: `${s.dto.name} ends`,
            topicId: null, stageId: s.dto.id, done: false,
          })),
      ]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((m) => ({ ...m, presentation: milestonePresentation(m, today) }));

      return {
        weekStart: ws,
        weekEnd: we,
        today,
        days,
        totals: {
          targetMinutes: sum(days, (d) => d.targetMinutes),
          plannedMinutes: sum(days, (d) => d.plannedMinutes),
          actualMinutes: sum(days, (d) => d.actualMinutes),
          tasksDone: live.filter((t) => t.status === "DONE").length,
          tasksRemaining: todo.length,
          remainingMinutes: sum(todo, (t) => t.estimatedMinutes),
        },
        milestones,
        tasks: tasks.map((t) => taskDTO(t, today)),
      };
    },

    async progress() {
      const today = clock.today();
      const [settings, learning, stages, tasks, sessions, todayOpen] = await Promise.all([
        loadSettings(prisma),
        loadLearning(prisma),
        stagesWithRules(),
        prisma.task.findMany({
          select: { estimatedMinutes: true, status: true, originalDate: true, scheduledDate: true, kind: true, stageId: true, topicId: true },
        }),
        prisma.studySession.findMany({ select: { date: true, minutes: true, topicId: true } }),
        prisma.task.findMany({ where: { scheduledDate: i2d(today), status: "TODO" }, select: { topicId: true }, orderBy: taskOrder }),
      ]);
      const [targets, recalls, inRecall, recallDue, coaching, week, recallStates] = await Promise.all([
        loadTargets(prisma),
        // Recall (docs/Recall-Plan.md): measurements only, no streaks or points.
        prisma.recallReview.findMany({ where: { status: { in: ["CHECKED", "COMPLETE"] } }, select: { date: true, score: true, depth: true, outcome: true } }),
        prisma.recallState.count({ where: { nextDueDate: { not: null } } }),
        prisma.task.count({ where: { recallStateId: { not: null }, status: "TODO", scheduledDate: { lte: i2d(today) } } }),
        loadCoaching(prisma),
        loadWeek(prisma),
        prisma.recallState.findMany({ where: { nextDueDate: { not: null } }, select: { stage: true, nextDueDate: true } }),
      ]);
      const live = tasks.filter((t) => t.status !== "SKIPPED");
      // What is realistically achievable (Blueprint relationship model): open new material against the learner's week,
      // with the revision that is due coming first. Reported only; nothing is scheduled from it.
      const outlook = forecast({
        today, planEnd: settings.journeyEnd, targetDate: settings.targetDate, week,
        remainingNewMinutes: sum(tasks.filter((t) => t.status === "TODO" && t.kind !== "REVISION"), (t) => t.estimatedMinutes),
        // The plan's own last day of open new material (it is re-planned each day, and on every change).
        plannedFinish: tasks.filter((t) => t.status === "TODO" && t.kind !== "REVISION").map((t) => d2i(t.scheduledDate)).sort().at(-1) ?? null,
        recalls: recallStates.map((r) => ({ stage: r.stage, nextDueDate: d2i(r.nextDueDate!) })),
        recallMinutes: RULES.minutesPerReview, gapFor,
      });
      const orig = (t: { originalDate: Date }) => d2i(t.originalDate);

      // Weekly series: journey start → current week (or journey end).
      const weekly: { weekStart: ISODate; actualMinutes: number; plannedMinutes: number }[] = [];
      const lastWeek = weekStart(minDate(maxDate(today, settings.journeyStart), settings.journeyEnd));
      for (let w = weekStart(settings.journeyStart); w <= lastWeek; w = addDays(w, 7)) {
        const e = addDays(w, 6);
        weekly.push({
          weekStart: w,
          actualMinutes: sum(sessions.filter((s) => d2i(s.date) >= w && d2i(s.date) <= e), (s) => s.minutes),
          plannedMinutes: sum(live.filter((t) => orig(t) >= w && orig(t) <= e), (t) => t.estimatedMinutes),
        });
      }
      const months = [...new Set(eachDay(settings.journeyStart, settings.journeyEnd).map(monthKey))];
      const monthly = months.map((m) => ({
        month: m,
        actualMinutes: sum(sessions.filter((s) => monthKey(d2i(s.date)) === m), (s) => s.minutes),
        plannedMinutes: sum(live.filter((t) => monthKey(orig(t)) === m), (t) => t.estimatedMinutes),
      }));

      const ws = weekStart(today);
      const topicDistrict = (id: string | null) => (id ? learning.topicNames.get(id)?.districtId : undefined);
      const road = roadProgress(learning.districts);
      const districts = learning.districts.map((d, i) => {
        const core = d.topics.filter((t) => t.priority === "CORE");
        const learned = (t: (typeof d.topics)[number]) => t.subtopicsTotal > 0 && t.subtopicsLearned >= t.subtopicsTotal;
        return {
          id: d.id,
          subtopicsTotal: sum(d.topics, (t) => t.subtopicsTotal),
          subtopicsLearned: sum(d.topics, (t) => t.subtopicsLearned),
          topicsTotal: d.topics.length,
          topicsLearned: d.topics.filter((t) => learned(t) || t.demonstrated).length,
          topicsDemonstrated: d.topics.filter((t) => t.demonstrated).length,
          coreTotal: core.length,
          coreLearned: core.filter((t) => learned(t) || t.demonstrated).length,
          coreDemonstrated: core.filter((t) => t.demonstrated).length,
          roadFraction: districtFraction(d),
          passed: districtPassed(d),
          presentation: districtPresentation(districtPassed(d), i === road.currentDistrictIndex),
          plannedMinutes: sum(live.filter((t) => topicDistrict(t.topicId) === d.id), (t) => t.estimatedMinutes),
          actualMinutes: sum(sessions.filter((s) => topicDistrict(s.topicId) === d.id), (s) => s.minutes),
        };
      });

      const reserved = reservedDates(stages.map((s) => s.plan));
      const stageStatus = stages.map(({ dto, plan }) => {
        const st = tasks.filter((t) => t.stageId === dto.id);
        const stLive = st.filter((t) => t.status !== "SKIPPED");
        const todo = st.filter((t) => t.status === "TODO");
        const overdue = todo.filter((t) => d2i(t.scheduledDate) < today);
        const plannedDays = new Set(st.map(orig));
        const bufferDays = eligibleDays(plan, reserved, (d) => targets[isoWeekday(d)] ?? 0).filter((d) => !plannedDays.has(d)).length;
        const complete = st.length > 0 && todo.length === 0;
        const status =
          complete ? "COMPLETE"
          : today > dto.endDate ? "DELAYED"
          : today < dto.startDate ? "UPCOMING"
          : overdue.length > 0 ? "BEHIND"
          : "ON_TRACK";
        const delayDays = status === "DELAYED" ? diffDays(dto.endDate, today) : 0;
        return {
          ...dto,
          status,
          presentation: stagePresentation(status, delayDays),
          delayDays,
          tasksTotal: stLive.length,
          tasksDone: stLive.filter((t) => t.status === "DONE").length,
          minutesTotal: sum(stLive, (t) => t.estimatedMinutes),
          minutesDone: sum(stLive.filter((t) => t.status === "DONE"), (t) => t.estimatedMinutes),
          overdueTasks: overdue.length,
          bufferDays,
        };
      });

      const coreTopics = learning.districts.flatMap((d) => d.topics).filter((t) => t.priority === "CORE");
      const practice = live.filter((t) => t.kind === "PRACTICE");
      return {
        today,
        hours: {
          plannedTotal: sum(live, (t) => t.estimatedMinutes),
          plannedToDate: sum(live.filter((t) => orig(t) <= today), (t) => t.estimatedMinutes),
          actualTotal: sum(sessions, (s) => s.minutes),
          thisWeek: sum(sessions.filter((s) => d2i(s.date) >= ws && d2i(s.date) <= addDays(ws, 6)), (s) => s.minutes),
          thisMonth: sum(sessions.filter((s) => monthKey(d2i(s.date)) === monthKey(today)), (s) => s.minutes),
        },
        weekly,
        monthly,
        districts,
        core: {
          total: coreTopics.length,
          learned: coreTopics.filter((t) => t.demonstrated || (t.subtopicsTotal > 0 && t.subtopicsLearned >= t.subtopicsTotal)).length,
          demonstrated: coreTopics.filter((t) => t.demonstrated).length,
        },
        practice: { total: practice.length, done: practice.filter((t) => t.status === "DONE").length },
        road: { ...road, currentTopicId: currentTopicId(learning.districts, todayOpen.map((t) => t.topicId)) },
        forecast: outlook,
        stages: stageStatus,
        recall: {
          inRecall,
          dueNow: recallDue,
          reviews: recalls.length,
          averageScore: recalls.length ? sum(recalls, (r) => r.score ?? 0) / recalls.length : null,
          depth: { FOUNDATIONAL: recalls.filter((r) => r.depth === "FOUNDATIONAL").length, INTERMEDIATE: recalls.filter((r) => r.depth === "INTERMEDIATE").length, MASTERY: recalls.filter((r) => r.depth === "MASTERY").length },
          outcomes: { PASS: recalls.filter((r) => r.outcome === "PASS").length, HOLD: recalls.filter((r) => r.outcome === "HOLD").length, LAPSE: recalls.filter((r) => r.outcome === "LAPSE").length },
          monthly: months
            .map((m) => {
              const xs = recalls.filter((r) => monthKey(d2i(r.date)) === m);
              return { month: m, reviews: xs.length, averageScore: xs.length ? sum(xs, (r) => r.score ?? 0) / xs.length : null };
            })
            .filter((m) => m.reviews > 0),
          /** Per sub-topic progress and blind spots across sub-topics, computed in code (docs/Recall-Plan.md §3.5, §7). */
          coaching,
        },
      };
    },
  };
}

/**
 * AI design §4.5: calibration (self-score vs saved score), AI agreement (suggestion vs saved score) and spoken vs
 * typed answers. Derived from attempts only; never feeds learning progress, demonstration or the road.
 */
export function aiAnalytics(
  attempts: { score: number; selfScore: number | null; inputMode: "TYPED" | "SPOKEN"; evaluation: { suggestedScore: number | null } | null }[],
) {
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const self = attempts.filter((a) => a.selfScore !== null);
  const checked = attempts.filter((a) => a.evaluation?.suggestedScore != null);
  const mode = (m: "TYPED" | "SPOKEN") => {
    const xs = attempts.filter((a) => a.inputMode === m);
    return { attempts: xs.length, averageScore: avg(xs.map((a) => a.score)) };
  };
  return {
    selfScored: self.length,
    selfMatches: self.filter((a) => a.selfScore === a.score).length,
    /** Positive: self-scores were higher than the saved score (over-confidence). */
    selfMeanDifference: avg(self.map((a) => a.selfScore! - a.score)),
    checked: checked.length,
    agreed: checked.filter((a) => a.evaluation!.suggestedScore === a.score).length,
    savedHigher: checked.filter((a) => a.score > a.evaluation!.suggestedScore!).length,
    savedLower: checked.filter((a) => a.score < a.evaluation!.suggestedScore!).length,
    spoken: mode("SPOKEN"),
    typed: mode("TYPED"),
  };
}
