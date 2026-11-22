# Phase 3: changing your time, with a preview before you save

Plan for review. Nothing here is built yet.

Part of the Blueprint relationship model. Phase 1 made availability and allocation data. Phase 2 made the plan
re-plan itself whenever an input changes (`docs/Scheduler-Phase2-Plan.md`). This phase lets the learner change the
inputs that only city creation could set until now, and see what a change does before saving it.

## 1. Why

Since phase 2 the plan follows every change correctly, but the learner can change almost none of the inputs:

| Input | Set at creation | Changeable today |
|---|---|---|
| Hours a day you can study (availability) | yes | no (`WeeklyTarget.availableMinutes` has no API) |
| Study days and rest days | yes | only by setting a weekday's new-material target to 0 through an unused API |
| Pace: how much of that time is new material | yes | no (`targetMinutes` per weekday, through the same unused API) |
| Target finish date | yes | no |
| The city's time zone | yes | no |
| A topic's hours | yes | only by importing a whole new curriculum version |

So the plan and forecast silently go wrong as soon as the learner's life changes. Phase 3 hands these inputs back.

## 2. What the learner gets

### 2.1 "Your time" sheet

It opens from the Forecast on Progress ("Change your time") and from the study-time card on Today. It reuses the
create-city time screen: the same controls, the same pace split bar.

- **Hours per study day**, in steps of 15 minutes.
- **Study days:** Monday to Sunday on or off.
- **Pace:** Light, Steady or Intensive (new material gets 60, 75 or 90 % of the time, as at creation; the rest is
  revision time).
  - A city whose split matches none of these shows it as **Current**, for example "Current: all new material, no
    revision time". It stays until the learner picks a preset.
- **Target date:** set, change or clear it. It never moves the plan; the forecast only checks it.
- **Time zone:** the city's "today".

Your local data fits this simple model with nothing lost: every city uses the same hours on all its study days
(22 Nov 2026).

### 2.2 Live preview, before saving

Each change asks the server what it would do, about 400 ms after the last edit, and saves nothing:

- **Projected finish:** before → after, for example "12 Aug → 2 Sep (3 weeks later)".
- **Target date:** on track or not, and the weekly hours of new material it would need.
- **Your week:** available hours, new material and revision.
- **Revision, next 4 weeks:** recalls a week.
- **Tasks that would move**, and how many days on Today change.

**Save** writes the week and re-plans, recorded as an AVAILABILITY change. The Today notice says what moved.
**Cancel** changes nothing.

### 2.3 Topic hours (optional, see question 3)

On a topic's panel, "Change estimate" sets its hours. Behind it is a curriculum version with only that change,
approved at once, so phase 2 step 5 resizes the topic's open work and re-plans it. The version history keeps the
change, which keeps future versions' "previous hours" right.

## 3. Design

- **The week, from the sheet:**
  - a study day is available for the hours given, and gets new material of `round(hours × share / 15 min) × 15 min`;
  - a rest day gets 0 for both;
  - the Current split keeps each weekday's own ratio.
  - This is a pure function (`domain/week.ts`), shared by the preview and the save, so what is previewed is what is
    saved.
- **Preview: `POST /schedule/preview`.** It loads the city as a re-plan does, then runs the pure scheduler and
  forecast on the proposed week (and target date), with the forecast's finish taken from that re-plan. It writes
  nothing and takes no lock. It answers in about 25–120 ms (the phase 2 timings), so typing stays responsive.
- **Save: `PUT /schedule/availability`.** It writes both columns of the seven `WeeklyTarget` rows, the target date
  and the time zone, then runs `replanIn` (AVAILABILITY) in the same transaction under the city's lock. A time-zone
  change counts "today" in the new zone from that request on.
- **Validation:**
  - hours 0–16 a day in 15-minute steps;
  - at least one study day;
  - a target date after today and within the three-year limit;
  - a known IANA time zone (`validTimeZone`).
- **Unchanged:** the scheduler, the forecast's rules and stage dates (stages keep their start dates, as decided in
  phase 2).

## 4. Steps

Each step gets its own branch and pull request.

1. **Backend:** `domain/week.ts`, the preview and save endpoints, and tests. These cover the preview matching the save
   exactly, nothing written by a preview, the lock, and validation.
2. **Frontend:**
   - the sheet with its live preview;
   - its entry points on Progress and Today;
   - checked at desktop and phone width, and in the dev app against real cities.
3. **Topic hours** (if wanted, question 3): the one-change version, approved at once.

**Dry run:** before step 2 ships, the preview runs for every local city on a copy of the data, with its current week
and a change of an hour a day. It must report "no change" for the current week, and a sensible finish for the change.

## 4a. Step 1 results: the backend (22 Nov 2026)

Answers taken: the suggested ones (one hours figure; "Current" for unmatched splits; topic hours later; the sheet opens
from Progress and Today).

- **`domain/week.ts`** (pure): the week from a choice, and the choice that describes a week.
  - Its paces are the ones city creation uses (tested equal).
  - The choice describing a week gives back exactly that week.
  - Of the local cities: AI Engineer, Full-Stack AI Engineer and RxJS in Angular are Steady. The other nine are
    Current: six at 100 % new material, and the three German cities at 180/150.
- **Endpoints:**
  - `GET /schedule/availability` describes the current week;
  - `POST /schedule/preview` saves nothing;
  - `PUT /schedule/availability` writes the week, target date and time zone, and re-plans (AVAILABILITY) under the
    lock.
- **Tests:** backend 371. The integration test checks:
  - an unchanged choice previews as unchanged;
  - a change previews a later finish and writes no task date, week row or plan change;
  - the save moves exactly the previewed number of tasks to the previewed finish;
  - target date and time zone validation.
- **Checked on a copy** of the local data (backup `before-your-time-20261122-191242.dump`):
  - each city's current week previews as unchanged once the day's re-plan has run (as every request does first);
  - a preview takes 9–58 ms.
- **Finding for step 2: more time barely moves the finish.** An hour more a day finishes 0–7 days sooner, while an
  hour less finishes months later (Engineering City 12 Aug → 11 Oct 2027). Stage start dates are fixed (phase 2,
  option 1): extra time pulls work earlier within a stage, and the next stage still waits for its start date. So the
  preview of "more time" will mostly show more free days, not an earlier finish. To be decided before the sheet
  ships: say this plainly in the preview, or let a later stage start early.

## 5. Questions for you

1. **Hours model:** one "hours per study day" for all study days, as at creation (suggested; it fits every city you
   have), or a separate number for each weekday?
2. **Cities at 100 % new material** (Engineering City, German Language, German B2, Tech City, Angular City, Jasmine
   City): show
   their split as "Current" until you pick a pace (suggested), or offer "all new material" as a fourth pace?
3. **Topic hours:**
   - Build it now as step 3, or leave it for later (suggested)?
   - The built-in Engineering City reloads its curriculum from the template on every start, which would undo a topic
     edit there. So for that city it would need a different design, or no topic editing at all.
4. **Where the sheet opens:** from the Forecast on Progress and from Today's study-time card (suggested), or from the
   City page instead?
