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
| **A recall is graded** (its due date moves) | Recall tasks only, within the day rules above. New material is not re-flowed until the next daily run, so Today doesn't reshuffle after every recall |
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
   - Migration (additive): `Task.pinnedAt`, `Settings.replannedFor`, `PlanChange`.
   - The daily run, the runs after settings, start-date and recall changes, and the advisory lock.
   - Hand moves set `pinnedAt`. `syncRecallTasks` goes through the scheduler. "Move all forward" is removed.
4. **Frontend.** Today's "plan changed" notice and a quieter "Carried over" section. Progress shows the last change.
   Task rows mark pinned tasks, with a way to unpin.
5. **Curriculum changes** (2.5), with their own dry run.

Phase 3, the "Availability & pace" sheet with a live forecast preview, follows once this is in.

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
