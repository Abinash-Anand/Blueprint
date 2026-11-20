/**
 * Revision v2, phases 2 and 3 (docs/Revision-v2-Plan.md §3, §4, §6): the revision home, sessions of stored questions,
 * checking (multiple choice in code, open answers by the AI check), hints, results, relearning before you leave, the
 * six cycles and their dates, and the per-topic history.
 *
 * - Every query goes through the city-scoped client the route passes in; background-free and deterministic: the
 *   planner (cycles.ts) decides, the AI only checks open answers.
 * - Questions reach the client without their answers; expected points, model answer, hints and option explanations are
 *   sent only after the learner has answered (or asked for a hint).
 * - Nothing here changes learning, demonstration or the plan. A topic's sub-topic schedules stop creating revision tasks
 *   once the topic has its first v2 review (RevisionTrack.startedAt); their history stays.
 */
import type { Prisma, PrismaClient, RevisionItem, RevisionResponse, RevisionTrack } from "@prisma/client";
import { d2i, i2d } from "../../db.js";
import { type ISODate, addDays, berlinDate } from "../../domain/dates.js";
import type { Clock } from "../../lib/clock.js";
import { HttpError, notFound } from "../../lib/http.js";
import type { AiService } from "../ai/service.js";
import { maxLevel } from "./pack.js";
import {
  CYCLES, MAINTENANCE_DAYS, type PlanConcept, type QueueEntry, RESULT, RESULT_LABEL, advanceTrack, firstDue, itemMinutes, pickItem, planSession, planTopic,
  rollUp, storyLine, suggestResult,
} from "./cycles.js";
import { revisionPolicy } from "./service.js";

const strings = (v: Prisma.JsonValue | null | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
type Option = { text: string; correct: boolean; explanation: string };
const optionsOf = (v: Prisma.JsonValue | null | undefined): Option[] => (Array.isArray(v) ? (v as unknown as Option[]) : []);
const queueOf = (v: Prisma.JsonValue): QueueEntry[] => (Array.isArray(v) ? (v as unknown as QueueEntry[]) : []);

/** Practice ("keep going" on the weakest concepts): at most this many questions. */
const PRACTICE_MAX = 6;

export interface AnswerInput { index: number; mode: "TYPED" | "SPOKEN" | "CODE" | "CHOICE"; answer?: string; choice?: number[]; confidence?: number; seconds?: number }

/**
 * `topUp` asks the pack for a few more questions in the background for concepts whose questions near the wanted level
 * have all been asked (plan §5.2); it does nothing when AI is off or not allowed.
 */
export function sessionService(db: PrismaClient, clock: Clock, ai: AiService, aiReady: () => Promise<boolean>, topUp: (conceptIds: number[]) => void = () => {}) {
  const today = () => clock.today();

  /* ---------------- tracks ---------------- */

  /**
   * Every topic with a ready pack gets a track (plan §4.1); a track starts its first cycle the day after the topic's
   * first sub-topic was learned. Idempotent; runs on every read of the home.
   */
  async function syncTracks() {
    const t = today();
    const topics = await db.topic.findMany({
      where: { revisionPacks: { some: { status: "READY" } } },
      select: { id: true, revisionTrack: true, subtopics: { where: { completedAt: { not: null } }, select: { completedAt: true }, orderBy: { completedAt: "asc" }, take: 1 } },
    });
    for (const x of topics) {
      const learned = x.subtopics[0]?.completedAt ? berlinDate(x.subtopics[0].completedAt) : null;
      if (!x.revisionTrack) {
        const due = firstDue(learned, t);
        await db.revisionTrack.create({ data: { topicId: x.id, nextDueDate: due ? i2d(due) : null } });
      } else if (x.revisionTrack.cycle === 0 && !x.revisionTrack.nextDueDate && !x.revisionTrack.lastReviewDate && learned) {
        await db.revisionTrack.update({ where: { id: x.revisionTrack.id }, data: { nextDueDate: i2d(firstDue(learned, t)!) } });
      }
    }
  }

  /** The current pack's live concepts with their live questions, results and how often each question was asked. */
  async function topicInputs(topicIds: string[]) {
    if (!topicIds.length) return new Map<string, { concepts: PlanConcept[]; top: number; uses: Map<number, number>; titles: Map<number, string> }>();
    const [packs, results, responses] = await Promise.all([
      db.revisionPack.findMany({
        where: { topicId: { in: topicIds }, status: "READY" },
        orderBy: { version: "desc" },
        include: { concepts: { where: { removedAt: null }, orderBy: { position: "asc" }, include: { items: { where: { removedAt: null }, select: { id: true, level: true, kind: true, format: true } } } } },
      }),
      db.conceptResult.findMany({ where: { topicId: { in: topicIds } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      db.revisionResponse.groupBy({ by: ["itemId"], where: { topicId: { in: topicIds }, itemId: { not: null } }, _count: { _all: true } }),
    ]);
    const tracks = await db.revisionTrack.findMany({ where: { topicId: { in: topicIds } } });
    const uses = new Map(responses.map((r) => [r.itemId!, r._count._all]));
    const out = new Map<string, { concepts: PlanConcept[]; top: number; uses: Map<number, number>; titles: Map<number, string> }>();
    for (const id of topicIds) {
      const pack = packs.find((p) => p.topicId === id);
      if (!pack) continue;
      const k = (tracks.find((t) => t.topicId === id)?.cycle ?? 0) + 1;
      const latest = (conceptId: number, cycle: number) => results.filter((r) => r.conceptId === conceptId && r.cycle === cycle).at(-1)?.result ?? null;
      out.set(id, {
        top: maxLevel(pack.basis),
        uses,
        titles: new Map(pack.concepts.map((c) => [c.id, c.title])),
        concepts: pack.concepts.map((c) => ({ id: c.id, position: c.position, items: c.items, previous: latest(c.id, k - 1), current: latest(c.id, k) })),
      });
    }
    return out;
  }

  async function candidates(tracks: (RevisionTrack & { topic: { name: string } })[]) {
    const inputs = await topicInputs(tracks.map((t) => t.topicId));
    return tracks.flatMap((t) => {
      const i = inputs.get(t.topicId);
      if (!i) return [];
      const questions = planTopic({ cycle: t.cycle, weakOnly: t.weakOnly, maintenance: t.state === "RETAINED" && t.maintenance }, i.concepts, i.top, i.uses);
      const weak = t.weakOnly || i.concepts.some((c) => (c.current ?? c.previous ?? 2) <= RESULT.STRUGGLED);
      return [{ topicId: t.topicId, name: t.topic.name, due: d2i(t.nextDueDate!), weak, cycle: t.cycle, questions }];
    });
  }

  // Active topics, and retained ones whose optional maintenance check is on (plan §4.2).
  const dueTracks = (until: ISODate) =>
    db.revisionTrack.findMany({ where: { OR: [{ state: "ACTIVE" }, { state: "RETAINED", maintenance: true }], nextDueDate: { lte: i2d(until) } }, include: { topic: { select: { name: true } } }, orderBy: { nextDueDate: "asc" } });

  /** One line about where a topic stands (plan §3.1). */
  async function trackLines(topicIds: string[]) {
    const inputs = await topicInputs(topicIds);
    const lines = new Map<string, string>();
    for (const [id, i] of inputs) {
      const weak = i.concepts.filter((c) => (c.current ?? c.previous) !== null && (c.current ?? c.previous)! <= RESULT.STRUGGLED);
      const pending = i.concepts.filter((c) => c.current === null).length;
      lines.set(id, weak.length ? `${weak.slice(0, 2).map((c) => i.titles.get(c.id)).join(", ")} still shaky` : pending && pending < i.concepts.length ? `${pending} of ${i.concepts.length} concepts left in this cycle` : `${i.concepts.length} concepts`);
    }
    return lines;
  }

  /* ---------------- questions and feedback ---------------- */

  const questionDTO = (e: QueueEntry, index: number, item: RevisionItem | null, topicName: string, conceptTitle: string) => ({
    index, topicId: e.topicId, topicName, conceptId: e.conceptId, conceptTitle, cycle: e.cycle, relearn: e.relearn, minutes: e.minutes,
    itemId: e.itemId, level: item?.level ?? null, kind: item?.kind ?? null, format: item?.format ?? null,
    situation: item?.situation ?? "", code: item?.code ?? null, question: item?.question ?? "This question was removed from the pack.",
    answerSize: item?.answerSize ?? "", options: item ? optionsOf(item.options).map((o) => o.text) : [],
    hintsUsed: e.hintsUsed ?? 0, hintsAvailable: item ? strings(item.hints).length : 0,
    hints: item ? strings(item.hints).slice(0, e.hintsUsed ?? 0) : [],
  });

  async function feedbackDTO(r: RevisionResponse) {
    const item = r.itemId ? await db.revisionItem.findUnique({ where: { id: r.itemId } }) : null;
    const concept = r.conceptId ? await db.revisionConcept.findUnique({ where: { id: r.conceptId }, select: { misconceptions: true } }) : null;
    const chosen = new Set(Array.isArray(r.choice) ? (r.choice as number[]) : []);
    const modelAnswer = r.modelAnswer;
    const first = modelAnswer.match(/^.+?[.!?](\s|$)/)?.[0]?.trim() ?? modelAnswer;
    return {
      responseId: r.id, index: r.position, format: r.format, mode: r.mode, answer: r.answer, correct: r.correct,
      options: item ? optionsOf(item.options).map((o, i) => ({ ...o, chosen: chosen.has(i) })) : [],
      expected: strings(r.expected),
      /** The model answer in two layers: the gist first, the rest on request (plan §3.4). */
      modelAnswer: { gist: first, full: modelAnswer },
      code: r.code,
      hints: item ? strings(item.hints) : [],
      misconceptions: strings(concept?.misconceptions),
      evaluation: r.evaluation ?? null,
      confidence: r.confidence, hintsUsed: r.hintsUsed,
      suggested: r.suggested, suggestedLabel: r.suggested === null ? null : RESULT_LABEL[r.suggested],
      final: r.final,
    };
  }

  async function sessionDTO(id: number) {
    const s = await db.revisionSession.findUnique({ where: { id } });
    if (!s) throw notFound("Session");
    const queue = queueOf(s.queue);
    const [responses, items, topics, concepts] = await Promise.all([
      db.revisionResponse.findMany({ where: { sessionId: s.id }, orderBy: { position: "asc" } }),
      db.revisionItem.findMany({ where: { id: { in: queue.map((q) => q.itemId) } } }),
      db.topic.findMany({ where: { id: { in: [...new Set(queue.map((q) => q.topicId))] } }, select: { id: true, name: true } }),
      db.revisionConcept.findMany({ where: { id: { in: [...new Set(queue.map((q) => q.conceptId))] } }, select: { id: true, title: true } }),
    ]);
    const byPos = new Map(responses.map((r) => [r.position, r]));
    const name = new Map(topics.map((t) => [t.id, t.name]));
    const title = new Map(concepts.map((c) => [c.id, c.title]));
    const item = new Map(items.map((i) => [i.id, i]));
    const entries = queue.map((e, index) => {
      const r = byPos.get(index);
      return {
        index, topicId: e.topicId, topicName: name.get(e.topicId) ?? "", conceptTitle: title.get(e.conceptId) ?? "", relearn: e.relearn, minutes: e.minutes,
        state: !r ? "OPEN" : r.final === null ? "ANSWERED" : "DONE", final: r?.final ?? null,
      };
    });
    const at = entries.findIndex((e) => e.state !== "DONE");
    const e = at >= 0 ? queue[at] : null;
    const r = at >= 0 ? byPos.get(at) : undefined;
    const topicsIn = [...new Set(queue.map((q) => q.topicId))];
    return {
      id: s.id, kind: s.kind, status: s.status, date: d2i(s.date), budgetMinutes: s.budgetMinutes, plannedMinutes: s.plannedMinutes,
      topics: topicsIn.map((t) => ({ topicId: t, name: name.get(t) ?? "", questions: queue.filter((q) => q.topicId === t).length, done: entries.filter((x) => x.topicId === t && x.state === "DONE").length })),
      entries,
      current: e ? { question: questionDTO(e, at, item.get(e.itemId) ?? null, name.get(e.topicId) ?? "", title.get(e.conceptId) ?? ""), feedback: r ? await feedbackDTO(r) : null } : null,
    };
  }

  async function activeSession(id: number) {
    const s = await db.revisionSession.findUnique({ where: { id } });
    if (!s) throw notFound("Session");
    if (s.status !== "ACTIVE") throw new HttpError(409, "SESSION_FINISHED", "This revision session has finished.");
    return s;
  }

  /** The first v2 review of a topic: its sub-topic schedules stop creating revision tasks (plan §8); history stays. */
  async function moveToV2(topicIds: string[]) {
    for (const topicId of topicIds) {
      const t = await db.revisionTrack.findUnique({ where: { topicId } });
      if (!t || t.startedAt) continue;
      await db.revisionTrack.update({ where: { id: t.id }, data: { startedAt: clock.now() } });
      await db.task.deleteMany({ where: { topicId, status: "TODO", source: "REVISION", revisionScheduleId: { not: null } } });
    }
  }

  async function finishSession(id: number) {
    const s = await db.revisionSession.findUniqueOrThrow({ where: { id } });
    const t = today();
    const responses = await db.revisionResponse.findMany({ where: { sessionId: s.id, final: { not: null } } });
    const cards: { topicId: string; name: string; cycle: number; cycleDone: boolean; retained: boolean; nextDueDate: string | null; weakOnly: boolean; results: { conceptId: number | null; title: string; result: number; label: string; relearned: boolean }[]; firstNext: string | null }[] = [];
    if (s.kind !== "PRACTICE") {
      const topicIds = [...new Set(responses.map((r) => r.topicId))];
      for (const topicId of topicIds) {
        const rs = responses.filter((r) => r.topicId === topicId && r.conceptId !== null);
        const cycle = rs[0]?.cycle ?? 1;
        const rolled = rollUp(rs.map((r) => ({ conceptId: r.conceptId!, format: r.format, final: r.final!, relearn: r.relearn })));
        const concepts = await db.revisionConcept.findMany({ where: { id: { in: [...rolled.keys()] } }, select: { id: true, title: true } });
        const title = new Map(concepts.map((c) => [c.id, c.title]));
        for (const [conceptId, v] of rolled)
          await db.conceptResult.create({ data: { conceptId, conceptTitle: title.get(conceptId) ?? "", topicId, sessionId: s.id, cycle, result: v.result, firstResult: v.firstResult, date: i2d(t) } });
        const track = await db.revisionTrack.findUnique({ where: { topicId }, include: { topic: { select: { name: true } } } });
        if (!track) continue;
        const inputs = (await topicInputs([topicId])).get(topicId);
        const live = inputs?.concepts ?? [];
        const k = Math.min(track.cycle + 1, CYCLES);
        if (track.state === "RETAINED") {
          // A maintenance check: the topic stays retained; the next check follows in about four months.
          const due = track.maintenance ? addDays(t, MAINTENANCE_DAYS) : null;
          await db.revisionTrack.update({ where: { id: track.id }, data: { nextDueDate: due ? i2d(due) : null, lastReviewDate: i2d(t) } });
          cards.push({
            topicId, name: track.topic.name, cycle: CYCLES, cycleDone: false, retained: true, nextDueDate: due, weakOnly: false,
            results: [...rolled].map(([conceptId, v]) => ({ conceptId, title: title.get(conceptId) ?? "", result: v.result, label: RESULT_LABEL[v.result], relearned: v.result > v.firstResult })),
            firstNext: null,
          });
          continue;
        }
        const next = advanceTrack(
          { cycle: track.cycle, state: track.state, nextDueDate: track.nextDueDate ? d2i(track.nextDueDate) : null, weakOnly: track.weakOnly },
          live.map((c) => c.current), t, track.nextDueDate ? d2i(track.nextDueDate) : null,
        );
        await db.revisionTrack.update({
          where: { id: track.id },
          data: { cycle: next.cycle, state: next.state, nextDueDate: next.nextDueDate ? i2d(next.nextDueDate) : null, weakOnly: next.weakOnly, lastReviewDate: i2d(t) },
        });
        const weakest = live.filter((c) => c.current !== null).sort((a, b) => a.current! - b.current!)[0];
        cards.push({
          topicId, name: track.topic.name, cycle: k, cycleDone: next.cycle > track.cycle, retained: next.state === "RETAINED",
          nextDueDate: next.nextDueDate, weakOnly: next.weakOnly,
          results: [...rolled].map(([conceptId, v]) => ({ conceptId, title: title.get(conceptId) ?? "", result: v.result, label: RESULT_LABEL[v.result], relearned: v.result > v.firstResult })),
          firstNext: weakest && weakest.current! <= RESULT.RECALLED ? (inputs?.titles.get(weakest.id) ?? null) : null,
        });
      }
    }
    await db.revisionSession.update({ where: { id: s.id }, data: { status: "FINISHED", finishedAt: clock.now() } });
    return cards;
  }

  /* ---------------- the service ---------------- */

  return {
    syncTracks,

    /** The revision home (plan §3.1): today's set, topics needing material, every topic's cycle and next date. */
    async home() {
      await syncTracks();
      const t = today();
      const [policy, due, all, needs, active, tomorrow] = await Promise.all([
        revisionPolicy(db),
        dueTracks(t),
        db.revisionTrack.findMany({ include: { topic: { select: { name: true } } }, orderBy: [{ nextDueDate: "asc" }, { topicId: "asc" }] }),
        db.topic.findMany({
          where: { subtopics: { some: { completedAt: { not: null } } }, revisionPacks: { none: { status: { in: ["READY", "BUILDING"] } } } },
          select: { id: true, name: true, district: { select: { name: true } } }, orderBy: [{ district: { position: "asc" } }, { position: "asc" }],
        }),
        db.revisionSession.findFirst({ where: { status: "ACTIVE", date: i2d(t) }, orderBy: { id: "desc" }, select: { id: true, kind: true } }),
        db.revisionTrack.count({ where: { state: "ACTIVE", nextDueDate: i2d(addDays(t, 1)) } }),
      ]);
      const cands = await candidates(due);
      const plan = planSession(cands, policy.dailyBudgetMinutes);
      const lines = await trackLines(all.map((x) => x.topicId));
      const planned = new Set(plan.topics);
      return {
        today: t,
        budgetMinutes: policy.dailyBudgetMinutes,
        plan: {
          topics: cands.filter((c) => planned.has(c.topicId)).map((c) => ({ topicId: c.topicId, name: c.name, cycle: Math.min(c.cycle + 1, CYCLES), questions: c.questions.length, minutes: c.questions.reduce((a, q) => a + q.minutes, 0) })),
          questions: plan.queue.length, minutes: plan.minutes, laterToday: plan.left,
        },
        activeSession: active,
        needsMaterial: needs.map((x) => ({ topicId: x.id, name: x.name, district: x.district.name })),
        tracks: all.map((x) => ({
          topicId: x.topicId, name: x.topic.name, cycle: x.cycle, inProgress: Math.min(x.cycle + 1, CYCLES), state: x.state,
          nextDueDate: x.nextDueDate ? d2i(x.nextDueDate) : null, lastReviewDate: x.lastReviewDate ? d2i(x.lastReviewDate) : null,
          weakOnly: x.weakOnly, maintenance: x.maintenance, due: !!x.nextDueDate && d2i(x.nextDueDate) <= t, overdue: !!x.nextDueDate && d2i(x.nextDueDate) < t,
          line: lines.get(x.topicId) ?? "",
        })),
        keepGoing: { tomorrow, practice: (await db.conceptResult.count({ where: { firstResult: { lte: RESULT.STRUGGLED }, conceptId: { not: null } } })) > 0 },
      };
    },

    /** Starts today's session, "keep going" on tomorrow's topics, or practice on the weakest concepts (plan §3.1, §6). */
    async start(kind: "PLANNED" | "EARLY" | "PRACTICE") {
      await syncTracks();
      const t = today();
      if (kind === "PLANNED") {
        const open = await db.revisionSession.findFirst({ where: { status: "ACTIVE", date: i2d(t), kind: "PLANNED" } });
        if (open) return sessionDTO(open.id);
      }
      const policy = await revisionPolicy(db);
      let queue: QueueEntry[];
      let minutes: number;
      if (kind === "PRACTICE") {
        // The weakest concepts: still weak, or weak until they were relearned at the end of a session.
        const weak = await db.conceptResult.findMany({ where: { firstResult: { lte: RESULT.STRUGGLED }, conceptId: { not: null }, concept: { removedAt: null } }, orderBy: [{ result: "asc" }, { firstResult: "asc" }, { date: "desc" }] });
        const ids = [...new Set(weak.map((w) => w.conceptId!))].slice(0, PRACTICE_MAX);
        const concepts = await db.revisionConcept.findMany({ where: { id: { in: ids } }, include: { items: { where: { removedAt: null } }, pack: { select: { topicId: true, basis: true } } } });
        const uses = new Map<number, number>();
        for (const g of await db.revisionResponse.groupBy({ by: ["itemId"], where: { conceptId: { in: ids }, itemId: { not: null } }, _count: { _all: true } })) uses.set(g.itemId!, g._count._all);
        const tracks = await db.revisionTrack.findMany({ where: { topicId: { in: concepts.map((c) => c.pack.topicId) } } });
        queue = [];
        for (const id of ids) {
          const c = concepts.find((x) => x.id === id);
          if (!c) continue;
          const cycle = Math.min((tracks.find((x) => x.topicId === c.pack.topicId)?.cycle ?? 0) + 1, CYCLES);
          const it = pickItem(c.items, Math.max(1, cycle - 1), "OPEN", uses, new Set());
          if (it) queue.push({ itemId: it.id, conceptId: c.id, topicId: c.pack.topicId, cycle, minutes: itemMinutes(it.kind, it.format), relearn: false });
        }
        minutes = queue.reduce((a, q) => a + q.minutes, 0);
        if (!queue.length) throw new HttpError(409, "NOTHING_TO_PRACTISE", "There are no weak concepts to practise right now.");
      } else {
        const tracks = kind === "PLANNED" ? await dueTracks(t) : (await dueTracks(addDays(t, 1))).filter((x) => d2i(x.nextDueDate!) === addDays(t, 1));
        const plan = planSession(await candidates(tracks), policy.dailyBudgetMinutes);
        queue = plan.queue;
        minutes = plan.minutes;
        if (!queue.length) throw new HttpError(409, "NOTHING_DUE", kind === "PLANNED" ? "Nothing is due for revision today." : "Nothing is due tomorrow.");
        await moveToV2(plan.topics);
        const reused = [...new Set(plan.queue.filter((q) => q.reused).map((q) => q.conceptId))];
        if (reused.length) topUp(reused);
      }
      const s = await db.revisionSession.create({
        data: { date: i2d(t), kind, budgetMinutes: policy.dailyBudgetMinutes, plannedMinutes: minutes, queue: queue as unknown as Prisma.InputJsonValue },
      });
      return sessionDTO(s.id);
    },

    session: sessionDTO,

    /** Turns the optional maintenance check of a retained topic on or off (plan §4.2, §14.4: off by default). */
    async setMaintenance(topicId: string, on: boolean) {
      const track = await db.revisionTrack.findUnique({ where: { topicId } });
      if (!track) throw notFound("Revision track");
      if (track.state !== "RETAINED") throw new HttpError(409, "NOT_RETAINED", "Maintenance checks start after all six cycles.");
      const t = today();
      const from = track.lastReviewDate ? addDays(d2i(track.lastReviewDate), MAINTENANCE_DAYS) : addDays(t, MAINTENANCE_DAYS);
      await db.revisionTrack.update({ where: { id: track.id }, data: { maintenance: on, nextDueDate: on ? i2d(from < t ? t : from) : null } });
      return { topicId, maintenance: on, nextDueDate: on ? (from < t ? t : from) : null };
    },

    /** The next stored hint (plan §3.4): no AI, no wait. Counts against the result. */
    async hint(sessionId: number, index: number) {
      const s = await activeSession(sessionId);
      const queue = queueOf(s.queue);
      const e = queue[index];
      if (!e) throw notFound("Question");
      if (await db.revisionResponse.findFirst({ where: { sessionId, position: index } })) throw new HttpError(409, "ALREADY_ANSWERED", "This question is already answered.");
      const item = await db.revisionItem.findUnique({ where: { id: e.itemId } });
      const hints = strings(item?.hints);
      const used = e.hintsUsed ?? 0;
      if (used >= hints.length) throw new HttpError(409, "NO_MORE_HINTS", "There are no more hints for this question.");
      queue[index] = { ...e, hintsUsed: used + 1 };
      await db.revisionSession.update({ where: { id: s.id }, data: { queue: queue as unknown as Prisma.InputJsonValue } });
      return { index, hintsUsed: used + 1, hints: hints.slice(0, used + 1), hintsAvailable: hints.length };
    },

    /** Records an answer and checks it: multiple choice in code, open answers by the AI check when it is available. */
    async answer(sessionId: number, b: AnswerInput) {
      const s = await activeSession(sessionId);
      const queue = queueOf(s.queue);
      const e = queue[b.index];
      if (!e) throw notFound("Question");
      if (await db.revisionResponse.findFirst({ where: { sessionId, position: b.index } })) throw new HttpError(409, "ALREADY_ANSWERED", "This question is already answered.");
      // Questions are answered in order (skipping moves one to the end), so positions stay 0, 1, 2, …
      if ((await db.revisionResponse.count({ where: { sessionId } })) !== b.index) throw new HttpError(409, "NOT_CURRENT", "Answer the current question first.");
      const item = await db.revisionItem.findUnique({ where: { id: e.itemId } });
      if (!item) throw new HttpError(409, "QUESTION_REMOVED", "This question was removed from the pack. Skip it.");
      const hintsUsed = e.hintsUsed ?? 0;
      let correct: boolean | null = null;
      let evaluation: Prisma.InputJsonValue | undefined;
      let aiScore: number | null = null;
      let aiError: string | null = null;
      if (item.format !== "OPEN") {
        const opts = optionsOf(item.options);
        const chosen = [...new Set(b.choice ?? [])].filter((i) => Number.isInteger(i) && i >= 0 && i < opts.length).sort();
        if (!chosen.length) throw new HttpError(400, "VALIDATION_ERROR", "Choose an answer first.");
        if (item.format === "CHOICE" && chosen.length !== 1) throw new HttpError(400, "VALIDATION_ERROR", "Choose one answer.");
        const right = opts.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0);
        correct = right.length === chosen.length && right.every((i) => chosen.includes(i));
        b.choice = chosen;
      } else {
        const text = (b.answer ?? "").trim();
        if (!text) throw new HttpError(400, "VALIDATION_ERROR", "Write or say your answer first.");
        if (await aiReady()) {
          try {
            const r = await ai.checkAnswer({ question: [item.situation, item.code ?? "", item.question].filter(Boolean).join("\n\n"), kind: item.kind, criteria: strings(item.expected), answer: text });
            evaluation = r as unknown as Prisma.InputJsonValue;
            aiScore = r.suggestedScore;
          } catch (err) {
            if (!(err instanceof HttpError)) throw err;
            aiError = err.message; // the learner assesses themself against the expected points instead
          }
        }
      }
      const suggested = suggestResult({ format: item.format, correct, aiScore, hintsUsed });
      const r = await db.revisionResponse.create({
        data: {
          sessionId, itemId: item.id, conceptId: e.conceptId, topicId: e.topicId, cycle: e.cycle, relearn: e.relearn, position: b.index,
          level: item.level, kind: item.kind, format: item.format, question: item.question, code: item.code, expected: item.expected as Prisma.InputJsonValue,
          modelAnswer: item.modelAnswer, confidence: item.format === "OPEN" ? (b.confidence ?? null) : null,
          mode: item.format === "OPEN" ? b.mode : "CHOICE", answer: (b.answer ?? "").slice(0, 5000), choice: b.choice ? (b.choice as Prisma.InputJsonValue) : undefined,
          correct, evaluation, hintsUsed, suggested, seconds: b.seconds ?? null,
        },
      });
      return { ...(await feedbackDTO(r)), aiError };
    },

    /**
     * The learner's result for an answer (Forgot · Struggled · Recalled · Strong recall; plan §3.5). A missed concept
     * gets one easier question at the end of the session (relearn before you leave, §3.4).
     */
    async result(sessionId: number, b: { responseId: number; final: number; modelShown?: boolean }) {
      const s = await activeSession(sessionId);
      const r = await db.revisionResponse.findFirst({ where: { id: b.responseId, sessionId } });
      if (!r) throw notFound("Answer");
      if (r.final !== null) throw new HttpError(409, "RESULT_RECORDED", "This result is already recorded.");
      const final = r.format !== "OPEN" && b.final === RESULT.STRONG ? RESULT.RECALLED : b.final;
      await db.revisionResponse.update({ where: { id: r.id }, data: { final, modelShown: !!b.modelShown } });
      const queue = queueOf(s.queue);
      if (final <= RESULT.STRUGGLED && !r.relearn && s.kind !== "PRACTICE" && r.conceptId && !queue.some((q) => q.relearn && q.conceptId === r.conceptId)) {
        const items = await db.revisionItem.findMany({ where: { conceptId: r.conceptId, removedAt: null } });
        const inSession = new Set(queue.map((q) => q.itemId));
        const easier = pickItem(items, Math.max(1, r.level - 1), "CHOICE", new Map(), inSession);
        if (easier) {
          queue.push({ itemId: easier.id, conceptId: r.conceptId, topicId: r.topicId, cycle: r.cycle, minutes: itemMinutes(easier.kind, easier.format), relearn: true });
          await db.revisionSession.update({ where: { id: s.id }, data: { queue: queue as unknown as Prisma.InputJsonValue } });
        }
      }
      return sessionDTO(s.id);
    },

    /** Leaves a question unanswered for now: it moves to the end of the session. */
    async skip(sessionId: number, index: number) {
      const s = await activeSession(sessionId);
      const queue = queueOf(s.queue);
      if (!queue[index]) throw notFound("Question");
      if (await db.revisionResponse.findFirst({ where: { sessionId, position: { gte: index } } })) throw new HttpError(409, "ALREADY_ANSWERED", "Only the current question can be skipped.");
      const [e] = queue.splice(index, 1);
      // A question removed from the pack meanwhile is dropped instead of coming back at the end.
      if (await db.revisionItem.findFirst({ where: { id: e.itemId, removedAt: null }, select: { id: true } })) queue.push(e);
      await db.revisionSession.update({ where: { id: s.id }, data: { queue: queue as unknown as Prisma.InputJsonValue } });
      return sessionDTO(s.id);
    },

    /** Ends the session (plan §3.5): concept results per cycle, the next dates, the completion cards. */
    async finish(sessionId: number) {
      const s = await activeSession(sessionId);
      const pending = await db.revisionResponse.count({ where: { sessionId: s.id, final: null } });
      if (pending) throw new HttpError(409, "RESULT_PENDING", "Choose a result for the answered question first.");
      return { cards: await finishSession(s.id), session: await sessionDTO(s.id) };
    },

    /** Spelling hints for transcription: the session's concept titles and the current question. */
    async terms(sessionId: number, index: number) {
      const s = await activeSession(sessionId);
      const e = queueOf(s.queue)[index];
      if (!e) throw notFound("Question");
      const [item, concept, topic] = await Promise.all([
        db.revisionItem.findUnique({ where: { id: e.itemId }, select: { question: true, expected: true } }),
        db.revisionConcept.findUnique({ where: { id: e.conceptId }, select: { title: true, keyPoints: true } }),
        db.topic.findUnique({ where: { id: e.topicId }, select: { name: true } }),
      ]);
      return [topic?.name ?? "", concept?.title ?? "", ...strings(concept?.keyPoints), item?.question ?? "", ...strings(item?.expected)].filter(Boolean);
    },

    /** Concepts × cycles with every answer behind each cell, and one line per concept (plan §3.6). */
    async history(topicId: string) {
      const topic = await db.topic.findUnique({ where: { id: topicId }, select: { id: true, name: true, revisionTrack: true } });
      if (!topic) throw notFound("Topic");
      const [results, responses, pack] = await Promise.all([
        db.conceptResult.findMany({ where: { topicId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
        db.revisionResponse.findMany({ where: { topicId, final: { not: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
        db.revisionPack.findFirst({ where: { topicId, status: "READY" }, orderBy: { version: "desc" }, include: { concepts: { orderBy: { position: "asc" }, select: { id: true, title: true, removedAt: true } } } }),
      ]);
      const keys = new Map<string, { conceptId: number | null; title: string; removed: boolean }>();
      for (const c of pack?.concepts ?? []) keys.set(`c${c.id}`, { conceptId: c.id, title: c.title, removed: !!c.removedAt });
      for (const r of results) {
        const key = r.conceptId ? `c${r.conceptId}` : `t${r.conceptTitle}`;
        if (!keys.has(key)) keys.set(key, { conceptId: r.conceptId, title: r.conceptTitle, removed: !r.conceptId });
      }
      const cycles = [...new Set(results.map((r) => r.cycle))].sort((a, b) => a - b);
      const rows = [...keys].map(([key, k]) => {
        const mine = results.filter((r) => (r.conceptId ? `c${r.conceptId}` : `t${r.conceptTitle}`) === key);
        const cells = cycles.map((cycle) => {
          const rs = mine.filter((r) => r.cycle === cycle);
          const last = rs.at(-1);
          const sessions = new Set(rs.map((r) => r.sessionId));
          return {
            cycle,
            result: last?.result ?? null, label: last ? RESULT_LABEL[last.result] : null, firstResult: last?.firstResult ?? null, date: last ? d2i(last.date) : null,
            reviews: rs.length,
            answers: responses.filter((x) => x.conceptId === k.conceptId && k.conceptId !== null && x.cycle === cycle && sessions.has(x.sessionId)).map((x) => ({
              id: x.id, relearn: x.relearn, kind: x.kind, format: x.format, question: x.question, code: x.code, answer: x.answer, mode: x.mode,
              correct: x.correct, evaluation: x.evaluation, expected: strings(x.expected), modelAnswer: x.modelAnswer,
              hintsUsed: x.hintsUsed, confidence: x.confidence, final: x.final, label: RESULT_LABEL[x.final!], date: x.createdAt.toISOString(),
            })),
          };
        });
        return { ...k, cells, story: storyLine(k.title, cycles.flatMap((cycle) => { const l = mine.filter((r) => r.cycle === cycle).at(-1); return l ? [{ cycle, result: l.result }] : []; })) };
      });
      const t = topic.revisionTrack;
      return {
        topicId: topic.id, name: topic.name,
        track: t ? { cycle: t.cycle, state: t.state, nextDueDate: t.nextDueDate ? d2i(t.nextDueDate) : null, weakOnly: t.weakOnly } : null,
        cycles, concepts: rows,
      };
    },
  };
}
export type SessionService = ReturnType<typeof sessionService>;
