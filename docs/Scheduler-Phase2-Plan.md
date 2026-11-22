# Phase 2: the scheduler that keeps the plan true

Plan for review. Nothing here is built yet.

Part of the Blueprint relationship model: curriculum → availability → allocation → **scheduler ◄ revision engine** →
forecast. Phase 1 (merged, PR #21) made availability and allocation real data, added the forecast and gave each
city its own "today". This phase builds the component the model centres on: one scheduler that coordinates new
material and revision inside the learner's time, and keeps doing so as things change.

## 1. The problem today

There are two schedulers, and neither knows about the other.

- **The plan is built once.** `buildPlan` (`domain/planner.ts`) places every study and practice task when a city is
  created (`cities/apply.ts`: "the plan is generated only once per city"). After that, new material never moves
  unless the learner presses "Move all forward" (`placeOverdue`, `domain/reschedule.ts`).
- **Recalls go on top.** `syncRecallTasks` (`recall/tasks.ts`) puts each due recall on its date, up to a daily count
  from the fixed `revisionDailyMinutes` (default 30 min, so 3 recalls), skipping rest days. It never looks at how
  much new material that day already has, so a day can run past the learner's hours.
- **The forecast knows better than the plan.** Phase 1's forecast already works out what really fits each day:
  recalls first, new material in what is left. But it only reports; the tasks on Today don't follow it.

Of the model's change rules, these still fail: a revision backlog doesn't push new material back; time freed by a
mastered topic isn't given back; a missed study day waits for a manual button; and changes to availability,
allocation, start date or curriculum don't move the plan.

**Scale:** in the local data (22 Nov 2026), a city has at most 750 open plan tasks, 9 overdue tasks and 14 sub-topics
in recall. A full re-plan of one city is a few thousand calendar steps: milliseconds in a pure function.

## 2. What the scheduler does

One routine, **re-plan**, for one city. Given the city's open work and time, it decides on which day each open task
goes from today on. It is deterministic: the same inputs always give the same plan.

### 2.1 What it may move, and what it never moves

| Task | Re-plan |
|---|---|
| Open study and practice tasks from the plan (`source: PLAN`, `TODO`) | **Moves**, keeping their order |
| Open recall tasks | **Moves**, on or after the due date, never before |
| Finished or skipped tasks | Never moves; counts as used time on its day |
| Tasks the learner added (`MANUAL`) | Never moves; counts as used time |
| Tasks the learner moved by hand | Never moves (new: `Task.pinnedAt`, set when a date is changed by hand); counts as used time |
| Today's open tasks | Stay on today: the learner may be partway through. Today's free time can still take carried-over work |
| The old revision system's tasks (`revisionScheduleId`) | Untouched (legacy) |

### 2.2 How a day is filled

For every study day from today, in order:

1. **Fixed work first:** finished, skipped, manual and pinned tasks on that day use up its time.
2. **Recalls next, oldest due date first**, in the day's revision time (available minutes − new-material target).
   Revision does not wait, so a recall that doesn't fit can **borrow** from the new-material time, up to a cap (half
   the day's new-material target, see question 2). A recall that still doesn't fit moves to the next study day.
3. **New material last:** the next open study and practice tasks, in their original order (original date, then
   position), fill the rest of the day's new-material time. A task too big for what is left waits for the next day
   with room. A task longer than any whole day goes alone onto an empty day, as `placeOverdue` does now.

Rest days (no available time) get nothing. Stage weekdays and parallel-stage reservations from `buildPlan` still
apply, so a parallel topic keeps its days.

### 2.3 What it guarantees

These become tests (section 6):

- **Order:** new material keeps its order; nothing jumps ahead of what it depends on.
- **Time:** no day's planned work exceeds its available minutes, except a single oversized task alone on its day.
- **Revision first:** a recall is never later than it would be if no new material existed, beyond the borrow cap.
- **Stability:** re-planning a plan that is already valid moves nothing.
- **Nothing lost:** the set of open tasks is the same before and after (only dates change), and their total minutes
  are unchanged.
- **Hands off:** finished, manual and pinned tasks keep their days.

### 2.4 When it runs

| Event (from the model's change table) | Runs |
|---|---|
| **A new day** (missed study or recall becomes overdue) | Once a day per city, on the first request of the day (`Settings.replannedFor` records the date) |
| **Availability or allocation changes** (hours, study days, new-material share) | Right after the change, in the same transaction |
| **Start date changes** | Right after, from the new start |
| **A curriculum version is approved** | Right after (see 2.5) |
| **A recall is graded** (its due date moves) | A full re-plan from tomorrow, with no notice. Today's tasks never move, so Today doesn't reshuffle. (A recalls-only run was tried in step 3: with new material held in place, a city without revision time had no time to borrow, and a recall due on 22 Nov landed on 24 Dec.) |
| **A topic is mastered** (its intervals grow) | Nothing extra: the next daily run uses the freed time |

"Move all forward" goes away: the daily run does it, within capacity. The "Carried over" section on Today then only
shows work from earlier today.

### 2.5 Curriculum changes

When a new curriculum version is approved:

- **Removed topics:** their open plan tasks are deleted (finished ones stay, for history).
- **New topics:** their study and practice tasks are created with the planner's own chunking (`topicChunks`) and
  queued after the work that is already open, in curriculum order.
- **Changed hours:** the open tasks of a topic are resized to its remaining work. Done minutes count against the new
  total; done tasks are never changed.

Then re-plan runs. This is the most involved part, so it is its own step (5) and pull request.

## 3. Ownership, as the model asks

| Component | Owns | Code |
|---|---|---|
| Revision engine | When a sub-topic is due (stage, interval, due date) | `RecallState`, `recall/rules.ts`, unchanged |
| Availability and allocation | Minutes per weekday, and how much is new material | `WeeklyTarget` (phase 1) |
| Scheduler | Which day each open task goes on | **new** `domain/scheduler.ts` (pure) and `schedule/replan.ts` (database) |
| Forecast | What is achievable | `domain/forecast.ts`, changed to use the scheduler's day rules |

The scheduler never changes a due date, and the revision engine never picks a day. `syncRecallTasks` becomes a thin
call into the scheduler, and `revisionDailyMinutes` stops being used: revision time comes from availability.

## 4. Design details

- **A pure core.** `replan(input) → { moves, unplaced }`, with no database and no clock; `input` is today, the week's
  minutes, the stages, the open and fixed tasks, and the recall due dates. The database layer loads, calls, and
  writes only the tasks whose date changed, in one batched update.
- **One run at a time per city.** Each run takes a Postgres advisory lock on the city
  (`pg_advisory_xact_lock`) inside its transaction, so two requests on the first visit of the day, or two server
  instances, cannot interleave. This also works on several instances, unlike the in-process guards elsewhere
  (case study §7).
- **The forecast shares the day rules.** The forecast walks the same day-filling function, so "projected finish" and
  the tasks on Today can no longer disagree.
- **Visible changes.** Each run that moves something records a short summary (`PlanChange`: when, why, how many
  tasks moved, the new projected finish). Today shows the latest one once, for example "Moved 6 tasks: you missed
  Tuesday. Projected finish 12 Mar (+3 days)" (question 5).
- **Older cities.** Four cities planned their full hours as new material, so they have no revision time. Under the
  new rules their recalls borrow from new material, up to the cap, and new material moves later. The forecast
  already shows this. Phase 3's "Availability & pace" sheet is where the learner gives them revision time (question 3).

## 5. Steps

Each step gets its own branch and pull request, a database backup before any migration, and a dry run on a copy of
the local database (as with the point statements) before it touches real data.

1. **Pure scheduler and its tests.** `domain/scheduler.ts` with the guarantees in 2.3 as tests, including
   property-style tests on generated plans. The forecast moves onto its day rules. Nothing calls it yet.
2. **Dry run on real data.** A script that runs re-plan for every city on a copy and saves nothing. It prints the
   tasks moved per city, the days over capacity before and after, and the projected finish before and after. You see
   this before anything changes.
3. **Wire it in.**
   - Migration (additive): `Task.pinnedAt`, `Settings.replannedFor`, `PlanChange`, and `Stage.weekdays` and
     `Stage.queue`, filled in from each city's curriculum.
   - The forecast's finish comes from the re-planned work (5a, option 1).
   - The daily run, the runs after settings, start-date and recall changes, and the advisory lock.
   - Hand moves set `pinnedAt`. `syncRecallTasks` goes through the scheduler. "Move all forward" is removed.
4. **Frontend.** Today's "plan changed" notice and a quieter "Carried over" section. Progress shows the last change.
   Task rows mark pinned tasks, with a way to unpin.
5. **Curriculum changes** (2.5), with their own dry run.

Phase 3, the "Availability & pace" sheet with a live forecast preview, follows once this is in.

## 5a. Step 2 results: dry run on a copy of the local data (22 Nov 2026)

`scripts/replan-dry-run.ts`, run on a copy restored from `backups/before-replan-dry-run-20261122-170028.dump`.
Nothing was saved.

| City | Open (new + recalls) | Overdue | Tasks moved | Later / earlier | Largest shift | Days over time (from tomorrow) | Empty study days | Last new material | Forecast finish |
|---|---|---|---|---|---|---|---|---|---|
| AI Engineer | 522 + 2 | 0 | 65 | 0 / 65 | 4 d | 0 → 0 | 43 → 43 | 16 Sep 2027 | 1 Aug 2027 |
| Angular City | 67 + 10 | 0 | 22 | 15 / 7 | 5 d | 4 → 0 | 8 → 7 | 25 Jan 2027 | 15 Jan 2027 |
| Engineering City | 536 + 4 | 12 | 74 | 74 / 0 | 6 d | 1 → 0 | 59 → 55 | 12 Aug 2027 | 8 Jun 2027 |
| Full-Stack AI Engineer | 454 + 0 | 5 | 69 | 69 / 0 | 3 d | 0 → 0 | 32 → 30 | 18 Aug 2027 | 10 Jul 2027 |
| German A1 to C1 | 680 + 0 | 4 | 88 | 88 / 0 | 3 d | 0 → 0 | 42 → 40 | 8 Feb 2028 | 23 Dec 2027 |
| German A1 to C1 (2) | 433 + 2 | 8 | 72 | 72 / 0 | 5 d | 0 → 0 | 33 → 30 | 7 Sep 2027 | 31 Jul 2027 |
| German B2 | 367 + 2 | 0 | 49 | 0 / 49 | 2 d | 0 → 0 | 44 → 44 | 3 Nov 2027 | 20 Sep 2027 |
| German C1 | 458 + 0 | 0 | 0 | 0 / 0 | 0 | 0 → 0 | 23 → 23 | 9 Nov 2027 | 7 Oct 2027 |
| German Language | 750 + 0 | 7 | 129 | 129 / 0 | 4 d | 0 → 0 | 42 → 39 | 19 Jan 2028 | 4 Dec 2027 |
| Jasmine City | 114 + 14 | 0 | 42 | 31 / 11 | 4 d | 5 → 0 | 16 → 16 | 5 Apr 2027 | 19 Mar 2027 |
| RxJS in Angular | 101 + 4 | 2 | 12 | 11 / 1 | 3 d | 0 → 0 | 15 → 14 | 28 Jan 2027 | 8 Jan 2027 |
| Tech City | 681 + 4 | 3 | 117 | 116 / 1 | 4 d | 2 → 0 | 42 → 40 | 13 Jan 2028 | 17 Nov 2027 |

German City has no plan. No task was left without a day.

**What it shows**
- **It does what it should.** Days with more work than time go from 12 to 0. Overdue work finds the next free time,
  and recalls stop piling on top of full days. No task moves more than 6 days.
- **Learners ahead of plan get work pulled forward.** AI Engineer and German B2 have no overdue work, but tasks
  finished early (1,044 minutes on 21 Nov in AI Engineer) left days empty, and later work moves into them. This is the
  model's "freed time goes back to new material".
- **Stage start dates hold the finish in place.** In every city, the last day of new material is the same before and
  after. Every plan already has 8 to 59 empty study days: the gaps the first plan left between a stage's last task and
  the next stage's start. Work moves within a stage, and those gaps absorb it.
- **The forecast disagrees with the plan.** The forecast ignores stage dates and counts those empty days as usable,
  so its finish is 10 days to 2 months earlier than the plan can deliver. It shares the day rules, but not the stage
  rules.

**Revised (22 Nov 2026, phase 3): option 2.** Stages now start early once the work before them is placed, and tasks are split to fill a day. See `docs/Availability-Phase3-Plan.md`, 4b. What follows is the first decision, kept for the record.

**Decided (22 Nov 2026): option 1.** Stage start dates stay fixed, and the forecast's finish comes from the scheduler.
Step 3 gains:
- the forecast's projected finish becomes the last day of the re-planned open work, and its target-date check uses
  that day;
- revision load and the week's split still come from the day rules;
- `Stage` stores its weekdays and queue (an additive migration, filled in from each city's applied curriculum or
  the built-in template), so re-plan no longer reads the curriculum document;
- Today shows "Nothing planned today: you're ahead" on an empty study day.

The options as they were put:
1. **Keep stage starts fixed, and take the forecast from the scheduler (suggested).** The projected finish becomes
   the last day of the re-planned work, so the forecast and Today cannot disagree. The empty days stay as buffer, and
   Today says "nothing planned: you are ahead" on them. A stage can be pulled earlier in phase 3's editing sheet.
   This causes the least change.
2. **Let a stage start early when its earlier work is done.** The scheduler fills the empty days, so most plans
   finish weeks earlier, close to today's forecast. But nearly every open task moves on the first run, and stage dates
   stop meaning much.

## 5b. Step 3 results: wired in (22 Nov 2026)

- **Migration `20261129090000_scheduler`** (additive):
  - `Task.pinnedAt`, `Settings.replannedFor`, `Stage.weekdays` and `Stage.queue`, and the `PlanChange` table;
  - stage weekdays and queues are filled from each city's applied curriculum. Engineering City's come from its
    template, on the start-up seed.
- **`schedule/replan.ts`:**
  - loads a city, runs the pure scheduler, and writes only the dates that change, grouped by day;
  - holds a per-city advisory lock for the transaction, and records a `PlanChange` when anything moved.
- **Triggers:**
  - the first request of a city's day (`dailyReplan`, checked again under the lock);
  - weekly study time (AVAILABILITY) and stage dates (STAGES);
  - "Move all forward", which now runs the scheduler (OVERDUE);
  - a recall's due date (RECALL): a full re-plan from tomorrow with no notice. A recalls-only run was tried first: it
    left a recall due on 22 Nov on 24 Dec in a city without revision time;
  - curriculum changes remain step 5.
- **Hand moves** pin a task (`pinned` on each task); `PATCH { pinned: false }` unpins it.
- **Recall home:** its limit is now what fits today (revision time plus what may be borrowed, ÷ 8 min), and
  "overdue" counts from the due date.
- **Forecast:** its finish is the plan's last day of open new material.
- **Checked on a copy** of the local data, restored from the 22 Nov backup, migrated and seeded as on a deploy:
  - each city's daily re-plan matches the step 2 dry run, taking 23–117 ms;
  - a second run moves nothing, and syncing recalls changes nothing;
  - no day is over its time.
  - One fix came from this check: a stage whose weekdays are not recorded yet never claims days from the others.
- **Tests:** backend 356, including a scoped transaction seeing one city, re-planning one city leaving another
  untouched, and two first requests at once re-planning once.

## 5c. Step 4 results: the screens (22 Nov 2026)

- **Today:**
  - after a re-plan that moved tasks, one line says what moved, why, and what it did to the projected finish, for
    example "The plan moved 456 tasks to fit your new study times. Projected finish 18 Aug (6 days later).";
  - it stays until "Got it", and which change was seen is kept per city in the browser only;
  - "Move all forward" is gone, because the plan does it each day. What stays carried over says why: pinned, or no
    room yet;
  - a study day with nothing planned says "Nothing planned today: you're ahead".
- **Task rows:** a pinned task shows "Pinned" and an Unpin button, and moving a task says that moving pins it.
- **Revision:** "Today has time for N recalls", from the day's time rather than a fixed limit.
- **Progress:** the forecast explains its finish, and names the last change.
- **Found in the browser check, fixed:**
  - **Start-up recall planning took the first re-plan silently.** It re-planned every city under RECALL, which is
    not recorded, so the day's re-plan found nothing to move and no notice showed. Recall syncing now re-plans only
    when a recall task came or went.
  - **A recall due today could stick on a rest day.** A new recall task due today or earlier was parked on today, and
    today's open tasks never move. It is now parked on the day before, so it joins today only if today has time.
  - **A failing start-up job stopped the server.** It is now logged instead.
- **Tests:** backend 356, frontend 264. Checked in the dev app at desktop and phone width: the notice, a pin and
  unpin, a study-time change and back (456 moved out, 455 back, finish +6 then −6 days), and the forecast line.

## 5d. Step 5 results: curriculum changes (22 Nov 2026)

- **`domain/curriculumPlan.ts`** (pure) decides what an approved version does to an active city's plan tasks:
  - a planned topic without tasks gets the planner's study and practice chunks, placed right after the previous
    topic of its queue;
  - a topic with new hours has its open work resized to the new total less what is done: excess comes off the end,
    and more time becomes "(added time)" practice right after it;
  - finished and skipped tasks never change.
- **Order without renumbering:** new tasks take the original date and position of the task they follow, with higher
  ids. The scheduler orders by (original date, position, id), so they land right after it, and no existing task's
  history changes.
- **`cities/planUpdate.ts`** applies the operations and re-plans in one transaction under the city's lock, recorded
  as CURRICULUM. Today's notice reads "…to fit the curriculum changes you approved".
- **Found and fixed:** a version that inserted a topic in the middle of a district failed with a conflict, because
  topic and district positions are unique and were written in the new order over rows that had not moved yet. That
  bug predates phase 2; versions had only ever removed topics. Existing positions are now parked before the new
  ones are written.
- **Checked on a copy** of the local data, migrated and seeded:
  - re-approving each city's current curriculum creates, removes and resizes nothing (12 cities, 18–75 planned
    topics each);
  - the start-up seed keeps Engineering City's district and topic order exactly;
  - no other city's positions change.
- **Not covered:** changing a topic's sub-topics with the same hours keeps its tasks as they are, and moving a
  topic to another queue does not move its tasks.
- **Tests:** backend 364 (7 for the pure part; an approval that adds a topic, gives one more hours and one fewer),
  frontend 264.

## 6. Testing

- **Unit (pure):**
  - each guarantee in 2.3;
  - rest days, parallel stages, an oversized task, borrowing up to the cap;
  - a city with no revision time;
  - idempotence (re-planning a re-planned plan moves nothing);
  - the forecast and the scheduler agreeing on the same input.
- **Integration (PostgreSQL):**
  - each trigger in 2.4;
  - the daily run happening once (two concurrent first requests, under the lock);
  - finished, manual and pinned tasks never moved;
  - city isolation;
  - the curriculum cases in 2.5.
- **On real data:** the step 2 dry run, compared with the forecast.

## 7. Questions, and the answers (22 Nov 2026)

The suggested answers were accepted: tasks moved by hand stay until unpinned; recalls may borrow up to half the day's
new-material time; cities without revision time borrow now; stage dates keep their original targets; Today shows a
one-line notice after a re-plan that moved something.

**Step 1 is done** (`domain/scheduler.ts`):
- The forecast now uses the scheduler's day rules.
- On the built-in Engineering City's full plan, the first re-plan moves nothing.
- 60 generated plans pass every guarantee in 2.3.

The questions as asked:

1. **Pinning:** should a task you move by hand stay where you put it until you unpin it (my suggestion), or only
   until the next daily run? No open task in your local data has been moved by hand, so nothing needs backfilling.
2. **Borrow cap:** how much new-material time may extra recalls take on a busy day? I suggest half the day's
   new-material target. More keeps revision on time but slows new material more.
3. **Cities without revision time:** let recalls borrow from new material now (honest, but those plans move later),
   or keep their recalls on top until you set their availability in phase 3?
4. **Stage dates:** keep them as the plan's original targets, so Progress can still say "behind" (my suggestion), or
   move them with the re-plan?
5. **Change notice:** show a one-line "plan changed" notice on Today after a re-plan that moved something?
