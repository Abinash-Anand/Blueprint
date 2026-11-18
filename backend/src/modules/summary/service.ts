/**
 * Read-side aggregates: Today (Mission Control), Week and Progress (LLD §4.3, §10–§12.4).
 */
import type { PrismaClient } from "@prisma/client";
import {
  type ISODate, addDays, diffDays, eachDay, isoWeekday, maxDate, minDate, monthKey, weekStart,
} from "../../domain/dates.js";
import { currentTopicId, districtFraction, districtPassed, roadProgress } from "../../domain/progress.js";
import { eligibleDays, reservedDates, type PlanStage } from "../../domain/planner.js";
import { d2i, i2d } from "../../db.js";
import type { Clock } from "../../lib/clock.js";
import { loadLearning } from "../learning.js";
import { loadSettings, loadTargets, stageDTO, stageInclude } from "../schedule/service.js";
import { sessionDTO } from "../sessions/routes.js";
import { taskDTO, taskInclude, taskOrder } from "../tasks/mapper.js";

const MAIN_WEEKDAYS = [1, 2, 3, 4, 5, 6];
const PARALLEL_WEEKDAYS = [6]; // the parallel architecture track uses Saturdays (SRS §6)

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

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
      const [tasks, carried, sessions, reviews] = await Promise.all([
        prisma.task.findMany({ where: { scheduledDate: i2d(day) }, include: taskInclude, orderBy: taskOrder }),
        day === today
          ? prisma.task.findMany({ where: { status: "TODO", scheduledDate: { lt: i2d(today) } }, include: taskInclude, orderBy: taskOrder })
          : Promise.resolve([]),
        prisma.studySession.findMany({ where: { date: i2d(day) }, orderBy: { id: "asc" } }),
        prisma.topic.findMany({ where: { needsReview: true }, select: { id: true, name: true, districtId: true }, orderBy: { id: "asc" } }),
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
        weekday: isoWeekday(day),
        isRestDay: weekdayTarget === 0,
        isBufferDay: target > 0 && tasks.length === 0,
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
      };
    },

    async week(date?: ISODate) {
      const today = clock.today();
      const ws = weekStart(date ?? today);
      const we = addDays(ws, 6);
      const [settings, targets, tasks, sessions, stages] = await Promise.all([
        loadSettings(prisma),
        loadTargets(prisma),
        prisma.task.findMany({ where: { scheduledDate: { gte: i2d(ws), lte: i2d(we) } }, include: taskInclude, orderBy: taskOrder }),
        prisma.studySession.findMany({ where: { date: { gte: i2d(ws), lte: i2d(we) } } }),
        stagesWithRules(),
      ]);
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
      ].sort((a, b) => a.date.localeCompare(b.date));

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
      const targets = await loadTargets(prisma);
      const live = tasks.filter((t) => t.status !== "SKIPPED");
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
      const districts = learning.districts.map((d) => {
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
          plannedMinutes: sum(live.filter((t) => topicDistrict(t.topicId) === d.id), (t) => t.estimatedMinutes),
          actualMinutes: sum(sessions.filter((s) => topicDistrict(s.topicId) === d.id), (s) => s.minutes),
        };
      });

      const road = roadProgress(learning.districts);
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
        return {
          ...dto,
          status,
          delayDays: status === "DELAYED" ? diffDays(dto.endDate, today) : 0,
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
        stages: stageStatus,
      };
    },
  };
}
