# Recall: plan

*Approved 20 November 2026. It replaces both earlier revision systems (the sub-topic recall dialog of
`Revision-Spec.md` and the packs, quizzes and cycles of `Revision-v2-Plan.md`). Learning, the plan and the city are
unchanged: revision never moves the car and never awards a floor or a roof.*

## 1. In one paragraph

Revision becomes pure active recall. When a learned sub-topic is due, you open it and explain everything you remember,
by voice or typing, in any order, optionally with a photo of a sketch you drew from memory. You never grade yourself.
An AI checks your explanation against a hidden, locked checklist of that sub-topic's points; code turns the AI's labels
into a score, a depth level and the next review date. Afterwards a separate senior-engineer step asks about only what
you missed, and the Progress tab shows how each point moves from missed to remembered over weeks.

## 2. Principles

1. **Recall, not recognition.** Nothing hints at the answers before you finish: no questions, no options, no notes.
2. **The AI labels, code decides.** The AI only says, per checklist point, *accurate*, *partial* or *missed*, quoting
   your words, and lists misconceptions. Scores, levels and dates are fixed formulas in code (§6).
3. **No self-assessment.** There are no Forgot/Recalled buttons; you are not the judge of your own recall.
4. **One locked checklist per sub-topic.** Built once from the curriculum, hidden until after your first review, never
   changed silently, so results stay comparable across sessions.
5. **The grader sees nothing else.** Only the checklist and today's explanation: no history, no earlier sessions.
6. **Measurements, not rewards.** Score, depth and the concept grid; no points, streaks or badges.

## 3. The experience

### 3.1 Due today
The Revision tab and Today show **Due today** (sub-topics whose review date has come) and **Upcoming**. A sub-topic
first becomes due the day after you tick it learned. At most `revisionDailyMinutes ÷ 8` reviews are due per day
(30 min → 3); the rest wait for the next day, oldest first.

### 3.2 Recall (the blank slate)
*Revise* opens a calm, full-screen page with the sub-topic and its topic, a record button and a text box. One quiet
line offers the same nudge for every sub-topic: *what it is, why it exists, how it works, where it gets tricky*. It
never shows the checklist.
- **Voice:** record as long as you need, in parts of up to two minutes each (each part is transcribed when it ends and
  appears as text you can read; the audio is never kept). Typing can be mixed in.
- **Sketches (phase 3):** up to three photos of diagrams or code you drew on paper from memory.
- **Check my recall** sends it. *Not today* puts the sub-topic back to tomorrow without a result.

### 3.3 Results
Within seconds:
- **Recall score** (e.g. 78 %) and **depth**: Foundational, Intermediate or Mastery.
- **Point cards:** green (accurate) with the quote from your words, yellow (partial) with what was missing, red
  (missed) naming the point. On your first review of a sub-topic this is also where you first see its checklist.
- **Misconceptions:** what you said and the correction.
- **Next review:** the date and why (stage up, held, or back).
- *This point isn't part of this sub-topic*: on a card, leaves the point out of this and future scores (§4.3).

### 3.4 Senior engineer (after the results)
A separate section: *A senior engineer looked at your gaps.* One or two questions about only the red and yellow
points and the misconceptions, the way a reviewer probes in a design review. Answer by voice or text, or skip. An
answer that now shows a missed point marks it *recalled when asked* (shown separately; it does not change today's
score or date, §6.4). *Complete revision* closes it.

### 3.5 Progress
Per sub-topic: a **concept grid** (points × review dates, green/yellow/red, ↑ when recalled only when asked), the score
over time, and a short **coaching summary** written from computed facts (§7): what you have locked in, what slipped
after a longer gap, and blind spots you keep missing.

## 4. The checklist

### 4.1 Building it
When a sub-topic first comes up for review (or in the background when you tick it learned), the AI receives the city
and district, the topic and its description, the sub-topic, and the topic's other sub-topics (so points stay inside
this one). It returns 6–8 **atomic points**, each with a short label, a one-line description used by the grader,
**tier** 1 (definition and purpose), 2 (how it works and is used) or 3 (edge cases, trade-offs, internals), and
**weight** = tier. At least two points per tier where the sub-topic has that depth; language as the city's.

### 4.2 Checks in code
6–8 points, tiers 1–3 present in order, labels distinct, no point repeating another sub-topic's name; on failure one
repair, then the sub-topic shows *checklist couldn't be prepared, try again later*. Model, prompt version and date are
stored with it; then it is **locked**.

### 4.3 Changing it
Leaving a point out (§3.3) excludes it from scoring from then on and is shown in the grid; it can be brought back.
Rebuilding a checklist creates version 2 and starts a new grid; earlier sessions stay with version 1. No other edits.

## 5. Evaluating an explanation

1. **Transcription:** Whisper large-v3 on GWDG, primed with the sub-topic, topic and the checklist's technical terms
   (words only, never the points' descriptions), in the city's language.
2. **Sketches (phase 3):** a vision model (Qwen 3.5 397B) writes out literally what each photo shows, labels and
   arrows, without completing anything. The text is kept, the photo is not.
3. **Grading:** one call, temperature 0, strict JSON schema, with only the checklist and the explanation (spoken and
   typed text, then sketch text, each tagged). For every point: `status` (accurate / partial / missed) and `evidence`
   (verbatim words from the explanation); plus `misconceptions` (claim, correction). It never sees earlier sessions.
4. **Checks in code:** exactly one result per point, matching ids; `missed` has no evidence; every quote must appear in
   the explanation (ignoring case, spaces and punctuation), otherwise that point becomes *missed*; a misconception's
   claim must be quoted the same way, otherwise it is dropped. Invalid output: one retry, then *waiting for the check*.
5. **The grading model is pinned** per checklist. If it is busy, the check waits and retries (up to an hour, then *Check
   again* appears); it never switches to another model mid-history. Each session stores the model that graded it.
6. **Which model** (Mistral Large 4 or Qwen 3.5 397B) is decided by the consistency test (§10) before release.

## 6. Scoring and scheduling (pure code)

### 6.1 Score
`score = max(0, Σ wᵢ·m(sᵢ) / Σ wᵢ − 0.15 × misconceptions)`, with m(accurate) = 1, m(partial) = 0.5, m(missed) = 0,
over the tier 1 and 2 points not left out (since 21 Nov 2026, §14.3; tier 3 decides Mastery depth only; a checklist
with no tier 1 or 2 point is scored on all its points).

### 6.2 Depth
Each tier's share is computed on its own. **Mastery:** tiers 1, 2 and 3 each ≥ 70 %. **Intermediate:** tiers 1 and 2
each ≥ 70 %. Otherwise **Foundational**.

### 6.3 Stage and next date
Stages 1–5 have gaps of 1, 2, 4, 7 and 15 days; from stage 6 each gap is the previous gap × 2.2, rounded, at most 180
days. Ticking a sub-topic learned sets stage 0 (due the next day).
| Result | Rule | Stage |
|---|---|---|
| **Pass** | score ≥ 75 % and no misconception | +1 |
| **Hold** | score 50–74 %, or ≥ 75 % with a misconception | unchanged |
| **Lapse** | score < 50 % | max(1, stage − 2) |
The next date is counted from the day you actually reviewed. *Not today* moves only the date.

### 6.4 Recalled when asked
Answers in the senior-engineer step are checked against the missed points only. A point shown there is stored as
`missed` with `recalledWhenAsked = true`. Score and stage use unprompted recall only, so the schedule measures memory,
not prompting.

## 7. Progress analysis

After each completed review, code compares it with every earlier session of the sub-topic (same checklist version):
per point *newly remembered* (missed/partial → accurate), *retained* (accurate → accurate), *slipped* (accurate →
partial/missed) and *blind spot* (missed twice or more in a row), plus the score trend and whether a misconception came
back. Only this computed summary goes to a small model (Qwen 3.8 27B) to write three or four plain sentences, stored
with the session so the Progress tab loads without waiting. If the AI is off, the computed facts are shown as a list.

## 8. Data

New tables (additive migration; backup and approval before deploy):
- `RecallChecklist` (sub-topic, version, model, prompt version, locked at) and `RecallPoint` (code c1…, label,
  description, tier, weight, left out at).
- `RecallState` per sub-topic: stage, next due date, last review date.
- `RecallReview`: sub-topic, checklist version, status (draft, waiting, checked, complete, skipped), transcript parts,
  typed text, sketch text, grading model and prompt version, score, depth, result, stage before and after, next date,
  follow-up questions and answers, analysis summary, timestamps.
- `RecallPointResult`: review, point, status, evidence, recalled when asked.
All city-scoped (`req.db`), in the data export, deleted with the city. Audio and photos are never stored.

## 9. Retiring the old systems

- **Removed from the app:** sub-topic revision tasks on Today and Week, the recall dialog (revision and the study-time
  *Check*), revision packs and material, quiz sessions, conversation mode, the code sandbox, photo material, cycles,
  the revision analytics section, and their routes.
- **No more planned revision tasks:** the planner stops creating them; the 40 open ones are deleted at deploy (after a
  backup; done revision tasks stay).
- **History kept, read-only:** earlier attempts and checks stay in the database and appear under *Earlier revision*
  in the Revision tab. No table is dropped; removing them would be a separate decision.
- **Starting point:** every learned sub-topic (28 today) gets `RecallState` stage 0; those with an old schedule keep its
  next date (not before tomorrow), the others are spread from tomorrow within the daily limit.
- **Settings:** the daily revision minutes stay (they set the daily limit); the weekly over-target allowance goes.

## 10. Testing and the consistency test

- **Unit:** score, depth, stage table, daily limit and spreading, quote matching, the diff classes.
- **Integration (fake provider):** learned → due → recall → check → results → follow-up → complete → next date;
  waiting and retry; leaving a point out; isolation between cities; export; the retirement migration on a copy of the
  live data.
- **Consistency (real GWDG, before release):** ten explanations (some yours, some written to be partial or wrong),
  each graded five times by each candidate model. Target: ≥ 95 % of point labels identical across runs and every
  quote verified; the steadier model becomes the grader. Results kept in `eval/results`.
- **Browser:** the recall page, results and grid at laptop and phone widths.

## 11. AI use, privacy and consent

Sent to GWDG: sub-topic and topic names and descriptions (checklist), your recording (transcription; never stored),
your explanation text and sketch photos (grading; photos not stored), and computed facts (summary). Nothing else, no
history in grading, nothing that identifies you. This changes what is sent, so `AI_PROCESSING` gets a new version and
the privacy notice is updated; recall needs that consent. Without AI, revision shows *needs the AI check* and nothing
is scheduled backwards.

## 12. Phases

| Phase | Work | Done when |
|---|---|---|
| **1. Recall core** | Checklist, recall page (voice in parts, typing), grading, checks, score, depth, stages, results, due list, retirement of the old systems (§9), consent | A full review runs end to end; the consistency test passes |
| **2. Senior engineer and progress** | Follow-up questions, recalled when asked, diff, concept grid, summary | Gaps get targeted questions; the grid shows a sub-topic's history |
| **3. Sketches** | Photos of your own drawings, read literally | A sketch's labels count as evidence |

## 13. Decisions in this draft (change any before approval)

1. Daily limit = `revisionDailyMinutes ÷ 8` reviews.
2. Gaps 1, 2, 4, 7, 15 days, then × 2.2, capped at 180 days.
3. Voice parts of up to two minutes, any number of parts.
4. Grader chosen by the consistency test; summary by Qwen 3.8 27B.
5. 40 open old revision tasks deleted at deploy; all other old data kept read-only.

## 14. As built (21 November 2026)

All three phases are built, tested and live. Where the build differs from the plan above, this section wins.

### 14.1 Status

| Phase | Status |
|---|---|
| 1. Recall core | Live since 20 Nov. Grader pinned to Qwen 3.5 397B at temperature 0, never a fallback model. Prompts: checklist `recall-checklist-v4` (core points only, at most two tier-3 points; v3: distinct points, never an umbrella point over parts already listed; v4: a last self-check, and code sends back a draft with an umbrella point, `umbrellaPoints` in rules.ts), grading `recall-grade-v4` (generous with paraphrase; casing, spelling and speech-to-text formatting are never misconceptions; v4: code keeps its `<` `>`, only the prompt's own tags are neutralised) with `recall-misconception-check-v1` (a second call confirms each flagged misconception; unconfirmed ones are dropped, after a live trial flagged true statements). |
| 2. Senior engineer and progress | Live since 21 Nov. Follow-up (`POST /probe`, `/followup`), verdict (`/complete`), comparison and progress note (`RecallAnalysis`), grid (`GET /subtopics/:id/matrix`). |
| 3. Sketches | Live since 21 Nov. Up to 3 photos (PNG, JPEG, WebP, 5 MB); only the literal description is kept and graded as `[SKETCH n]`. |

The consistency test passed on 21 Nov with `recall-grade-v3`: 95.7 % of point labels were identical in every one of 5 runs (67 of 70), no quote was rejected and no call failed (`eval/results/recall-consistency-2026-11-21T02-37-35-440Z.json`).

### 14.2 Additions since approval

- **Mistakes that come back (§7):** the comparison lists each misconception of the latest review that an earlier review already corrected (`recurringMisconceptions`). Two misconceptions count as the same when at least 60 % of the shorter one's content words, and at least three, appear in the other. The progress note prompt is `recall-narrative-v2`.
- **Progress tab coaching (§3.5):** blind spots across sub-topics (points missed in a row), then each recalled sub-topic with its last score and change, the note written after its last review, and tags for newly remembered, slipped, keeps missing and a mistake that came back. Each one opens recall over time. It is computed in code on each load (`recall/coaching.ts`); no AI call.
- **Data export:** includes the progress notes (`recallAnalyses`).
- **Glass design (DESIGN.md §10):** the Revision tab, the recall flow (Recall, Check, Results, Follow-up, Verdict) and recall over time. The follow-up question is written while the results show, and opens as its own step.

### 14.3 Open

1. **Scoring weight of edge cases: decided 21 Nov 2026.** Tier weights 1/2/3 made the two tier-3 points about 43 % of a checklist, so a strong explanation that skipped them could not reach *remembered well*: in the consistency test, strong explanations of Subjects scored 57 % and of Guards 46 to 64 %. The score now counts tiers 1 and 2 only and tier 3 decides Mastery depth (§6.1). On the same labels that gives 100 % (PASS) and 62 % (HOLD), while partial and wrong explanations still lapse. Recalls checked before the change keep their scores and dates.
2. **Live data from before the v2 and v3 prompts:** the 4 checklists built with v1 and the Observers checklist (v2, with an umbrella point) were rebuilt on 21 Nov as new versions (v3, and Observers again with v4) by `src/scripts/rebuild-recall-checklists.ts`; graded reviews stay on their versions, an unsent draft moved, schedules unchanged. Re-grading the 2 recalls graded with v1 still waits for a decision.

