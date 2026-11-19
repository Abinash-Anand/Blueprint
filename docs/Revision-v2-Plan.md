# Revision v2: plan

*Approved 20 November 2026, with the recommended answer to each decision in §14. Nothing is built yet. It replaces how revision questions are made, asked,
checked and scheduled. Learning, the plan and the city are unchanged: revision never moves the car and never awards
a floor or a roof.*

## 1. What changes, in one paragraph

Blueprint keeps planning and tracking; it does not know, and should not know, what you studied. So at the **first
revision of a topic you tell it**: paste a list or notes, or add files. From that the AI builds a **revision pack**
once: the concepts you covered, and for each concept questions at six levels of difficulty, with expected points,
common misconceptions, hints and a model answer. Every later revision uses the stored pack: the **same concepts**,
**different and harder questions** each cycle, at most **six cycles**, every answer and score kept so you can see how
you did in cycle 1 compared with cycle 4. A revision session is a **clear set of questions per topic** inside a
flexible time budget (30 minutes planned, "keep going" if you want), asked one at a time in a calm workspace, with
multiple-choice questions checked instantly and open answers checked by the AI.

## 2. Principles

1. **Blueprint plans and tracks; you bring the material.** No tracking of what or how you study.
2. **Code decides, the AI writes.** Code chooses topics, concepts, question levels, set sizes and timing; the AI writes
   the pack once and checks open answers. Sessions are predictable, fast and testable.
3. **Generate once, store, reuse.** No question generation while you wait; no regenerated packs each cycle.
4. **Same concepts, new questions.** Concepts stay fixed so cycles are comparable; questions vary and get harder, which
   transfers better than repeating identical questions ([Pan and Rickard 2018](https://sc-pan.github.io/pdf/PR_2018.pdf);
   [Butler 2010](https://arxiv.org/pdf/2405.09655) and related work summarised there).
5. **Everything is kept, nothing overwritten:** your answer, the AI's evaluation, the model answer, help used, your
   score, per question and per cycle.
6. **Finite and clear:** you always know how many questions a topic has today and when you are done.
7. **Calm, Apple-style, no gamification:** one task at a time, plain words, no points, streaks or confetti.

## 3. The experience

### 3.1 Revision home

> **Today · 3 topics · 9 questions · about 25 min**   [ Start ]
>
> RxJS · cycle 2 of 6 · due today
> Angular routing · cycle 4 of 6 · due today
> TypeScript generics · cycle 1 · **needs your material**

Below: each topic with its cycle (1–6), next date and a one-line state ("cold vs hot still shaky"). After the planned
questions: **"Today's revision is done. Keep going?"** with *Revise topics due tomorrow*, *Practise your weakest
concepts* or *Done*. You can stop at any time; answered topics count, the rest moves to tomorrow.

### 3.2 First revision of a topic: what did you study?

> **Before we start RxJS: what did you study?**
> Paste a list or your notes, or add files.
> [ text box ]   [ Add files: PDF, Word, Markdown, text, HTML, images¹ ]
> [ Build my revision ]   [ Skip: use the topic outline ]

Only the extracted **text** is kept, never the file. Building the pack takes about 30–90 seconds in the background.
Then Blueprint shows the **concepts** it found, as a list you can correct:

> **From your material, 6 concepts**
> ✓ Observables: next, error, complete · ✓ Subscriptions and unsubscribing · ✓ Observables vs promises ·
> ✓ Cold vs hot · ✓ Subject · ✓ BehaviorSubject     [ Add a concept ]
> Tap one to leave it out ("not in what I studied").

Skipping the material builds a pack from the topic and sub-topic names and says so ("based on the outline only").
Material can be added later; the pack then gains the new concepts and keeps your history.

¹ Images (photos of notes, screenshots) need a GWDG model that reads images; availability and handwriting quality are
checked before this is promised (§12).

### 3.3 A topic review: a set of questions

> **RxJS · 3 questions** · ① Tricky choice ② Predict the output ③ Explain · about 9 min

During the review: "RxJS · 2 of 3", and for the session "question 5 of 9". Each question card shows, in this order:

- a small chip with the kind and time: *Predict the output · about 3 min*;
- the situation in one or two lines, and code when the topic is code;
- the question in larger type;
- an answer-size hint ("2–3 sentences", "one method");
- the answer area: text, **Speak**, or a code box for code questions; or the options for a multiple-choice question.

Before the expected answer is revealed on an open question: **"How sure are you?"** (Not at all · Shaky · Fairly ·
Sure). Multiple-choice questions skip it.

### 3.4 Checking and correcting

- **Multiple choice:** checked instantly in code. A wrong option shows its own explanation, written in advance from the
  misconception it represents ("That's the common belief: …").
- **Open answers:** the AI checks your answer against **this question's expected points**, quoting your words; quotes
  are verified against your text as today. On screen: point cards, each covered point highlighting the matching phrase
  in your answer.
- **Gaps:** hints come from the stored three-step ladder (direction, clue, partial example) with no AI wait; the AI
  checks your answer to the hint. Then the misconception named in one line, the model answer in short layers, and for
  code topics a before/after comparison.
- **Relearn before you leave:** every concept you missed gets **one more, easier question at the end of the session**,
  after the correction. A session ends with every concept recalled correctly once, the usual criterion in successive
  relearning research
  ([Dunlosky, Greve, Badali, Wissman, Rawson](https://www.unh.edu/teaching-learning-resource-hub/sites/default/files/media/2023-06/itow-successive-relearning-dunlosky-greve-badali-wissman-rawson.pdf)).
- **Report** on every question: *out of syllabus*, *unclear*, *the check was unfair*. Out of syllabus removes the
  question (or the concept); an unfair check is recorded for the AI benchmark and your score stands as you choose it.

### 3.5 Finishing a topic

One tap: the suggested result per concept is pre-selected (Forgot · Struggled · Recalled · **Strong recall**; the word
"Mastered" goes), you can change any. Help used and time are recorded automatically. Then a completion card:

> **RxJS reviewed · cycle 2 of 6**
> Strong: observables, subscriptions · Recalled: promises vs observables · Struggled: cold vs hot
> Next review: **Mon 30 Nov** · cold vs hot comes first.

### 3.6 History per topic

A table of concepts × cycles with the result in each cell; tap a cell to see the question, your answer, the AI's
evaluation and the model answer of that cycle. A line under the topic tells the story: "Cold vs hot: struggled in
cycles 1–2, recalled in 3."

## 4. The learning model

### 4.1 What is scheduled

Today each sub-topic and each topic has its own revision schedule. In v2 the **topic** is the unit you revise (as you
think of it: "revise RxJS"), with **concepts** tracked inside it. A topic becomes due for its first cycle once at least
one of its sub-topics is learned. Existing sub-topic schedules and their history stay readable (§8).

### 4.2 Cycles and intervals

| Cycle | Due after the previous one | Question levels (per concept, see 4.3) |
|---|---|---|
| 1 | 1–3 days after the topic's first sub-topic is learned (after you add material) | 1–2 |
| 2 | 3 days | 2–3 |
| 3 | 7 days | 3 |
| 4 | 14 days | 4 |
| 5 | 30 days | 5 |
| 6 | 60 days | 6 (mixed transfer) |

- A cycle **advances** the topic when every concept ends at Recalled or better (after the end-of-session relearning).
- If a concept stays at Forgot or Struggled, the next review comes **sooner** (1–3 days), asks only the weak concepts,
  and does not count as a new cycle.
- After cycle 6 the topic is **retained**. An optional maintenance check every 3–6 months can be switched on per
  topic; off by default.
- Research supports this shape: each additional spaced relearning session improves retention, with strong maintenance
  after about three and typical studies using four or five at weekly intervals
  ([Rawson, Dunlosky et al.](https://journals.sagepub.com/doi/full/10.1177/09637214221100484);
  [Higham et al.](https://eprints.soton.ac.uk/449677/1/Higham_et_al._in_press_JEdPsych.pdf)). Six expanding cycles over
  about four months is a reasonable cap; the numbers are configuration and can be tuned with your data. FSRS-style
  scheduling can replace the table later (§11).

### 4.3 Question levels and kinds

| Level | Kinds | RxJS example |
|---|---|---|
| 1 | Direct recall | "What do `next`, `error` and `complete` do?" |
| 2 | Explain why / how; tricky multiple choice | "Two subscribers to one HTTP observable: how many requests?" (1 / 2 / it depends) |
| 3 | Indirect scenario; predict the output | *(snippet)* "What does this log, and in which order?" |
| 4 | Spot the error; debug; compare | "This component leaks memory after navigation. Why?" |
| 5 | Judge; apply / write | "Subject or BehaviorSubject for the current user? Defend it." |
| 6 | Mixed transfer | A new problem combining several concepts, possibly with another topic |

Multiple-choice variants: **two-part** (answer + reason), **select all that are true**, **what happens** (output
options), **find the wrong line**, **best fix**. Wrong options are built from real misconceptions, each with its
explanation.

**Adaptation per concept:** a concept that struggled stays at its level (or drops one) next time; one that was strong
moves up. **Strong recall** for a concept needs at least one answer in your own words or code in that cycle; multiple
choice alone gives at most Recalled.

### 4.4 Evidence recorded per question

Confidence (open questions), the answer and how it was given (text, voice, code, choice), the AI's evaluation per
point (covered independently, covered after a hint, missing, wrong), hints used (0–3), whether the model answer was
shown, the suggested result, your final result, time. Per concept and cycle these roll up into one result; per topic
and cycle into the completion card. Nothing is overwritten.

## 5. The revision pack

### 5.1 Building it

**Input:** your material's text (capped, as for plan files), the topic and sub-topic names and descriptions, which
sub-topics you have learned, and the language.

**Calls (GWDG, background):**
1. **Concepts** (one call): 3–10 concepts found *in your material*, each with a short summary drawn from it, the
   sub-topic it belongs to, key points and two or three common misconceptions.
2. **Questions** (one call per concept, in parallel, like districts): for each level 1–6, one open question and one or
   two multiple-choice questions, each with kind, situation, optional code, the question, answer size, 3–5 expected
   points, a model answer, three hints, and for multiple choice the options with the correct one(s) and an explanation
   per option.

**Checked in code before it is stored:** the structure; every concept has questions at every level; expected points
are not empty; the question text does not contain its own model answer; multiple choice has exactly one correct option
(or at least one for select-all) and an explanation for each; code blocks are a sensible length; the language matches.
Anything that fails gets one repair round, then the concept is marked "needs questions" (templates fill in).

**Grounding:** the prompts say the material and the concept summaries are the only source; questions outside them are
not allowed. The material is data, never instructions (same rules as city creation).

### 5.2 Using and changing it

- Each cycle uses questions not used before at the planned level; when a level runs out, an unused question from a
  neighbouring level, or (in the background) a few new ones are generated and stored for next time.
- You can edit a question or its expected points, remove a question or a concept, and add a concept (its questions
  are generated in the background).
- Adding material later refreshes the pack: new concepts are added; existing concepts, questions and history stay.
- A pack is versioned; nothing you answered is ever lost when it changes.

### 5.3 Without material

A pack is built from the outline (topic and sub-topic names, descriptions, the curriculum's revision question) at
levels 1–4 only, labelled "based on the outline only". The eight fixed templates remain the last fallback when AI is
switched off.

## 6. The session planner (code)

- **Budget:** the existing daily revision time (default 30 min) plans the session; the weekly overtime allowance still
  limits what Blueprint *schedules*. Voluntary "keep going" time is unlimited and never moves planned study.
- **Choosing:** overdue first, then weak concepts, then due today; topics are interleaved (questions alternate between
  topics) rather than one topic at a time.
- **Set size per topic:** about 2 questions per concept in cycle 1, then by concept state: struggling concepts 2,
  recalled 1, strong concepts share one level-5/6 question; capped at 5 questions per topic per session.
- **Time estimates (including feedback):** multiple choice 1 min, direct recall 2, explain / predict / scenario 4,
  debug / compare 6, judge / apply 8. Sessions are filled to about 85 % of the budget; the rest is buffer.
- **Early revision** ("keep going" on topics due tomorrow) counts, but the next interval grows less than for a review
  on its due day.
- **Prepared ahead:** while you read feedback, the next question is already loaded; open answers are the only thing
  that waits for the AI.

## 7. AI use and limits

| Step | AI? | Calls |
|---|---|---|
| Build a pack | Yes, once per topic | 1 + one per concept (about 4–11) |
| Multiple choice | No | 0 |
| Check an open answer | Yes | 1 (Gemma 4, as today) |
| Hint | No (stored); checking the answer to it: yes | 0–1 |
| Extra questions for a level that ran out | Yes, background | 1 per concept |

A typical 25-minute session: about 4–6 AI calls. Per-account limits as for city creation; the shared GWDG limits stay.
Models: pack generation on Qwen 3.5 397B (fallback Mistral Large 4), answer checking on Gemma 4 (fallback Qwen 3.8).

## 8. Data

New tables (additive):

| Table | Holds |
|---|---|
| `RevisionMaterial` | Per topic: the extracted text of what you studied, file names, sizes, pages (never the files) |
| `RevisionPack` | Per topic: version, model, prompt version, status (building, ready, failed) |
| `RevisionConcept` | Per pack: title, summary, sub-topic, key points, misconceptions, removed flag |
| `RevisionItem` | Per concept: level, kind, situation, code, question, answer size, expected points, model answer, hints, options with explanations, source (AI, edited by you), removed flag |
| `RevisionTrack` | Per topic: current cycle (1–6), next due date, state (needs material, active, retained), maintenance on/off |
| `RevisionSession` | Per day: planned budget, topics, start and end, kept-going time |
| `RevisionResponse` | Per question answered: cycle, confidence, answer, mode, AI evaluation, hints used, model answer shown, suggested and final result, time |
| `ConceptResult` | Per concept and cycle: the rolled-up result |
| `RevisionReport` | Out of syllabus, unclear, unfair check; with the question and your note |

**Existing data:** `RevisionSchedule`, `RevisionAttempt`, `RevisionEvaluation`, `RevisionPrompt` and
`LearningCheckpoint` stay as they are and remain visible in history. Existing sub-topic schedules stop creating new
revision tasks once a topic moves to v2 (each topic moves on its first v2 revision); nothing is deleted. The
migration is additive, rehearsed on a restored backup, and applied only after a fresh backup and your approval.

## 9. Privacy and consent

- Revision material is new data sent to GWDG. The AI notice for revision (`AI_PROCESSING`) gets a new version that
  names it, so consent is asked once more.
- Only text is stored; you can delete a topic's material and pack at any time (questions and your past answers can be
  kept or deleted with it, your choice); everything is in the data export and deleted with the city.

## 10. Screens and components

A **revision workspace** (full screen, not a modal over the dashboard): on laptops the question on the right and the
topic's concepts and progress on the left (like city creation); on phones one column. Built from the existing flow kit
(segmented control, grouped rows, sheets, pills) plus: a question card, a multiple-choice list with per-option
feedback, a code box (monospace, syntax colouring), point cards with highlighted quotes, a read-aloud player (play,
pause, stop, speed), and the completion and history views.

## 11. Phases

| Phase | Work | Done when |
|---|---|---|
| **0. Quick fixes** (in today's dialog) | Read-aloud player; the Method dropdown removed; "Mastered" → "Strong recall"; "Draw" asks for a text description; Report button | Shipped, tests pass |
| **1. Material and pack** | Material step with uploads (text, Markdown, PDF, HTML, Word; images after §12), concepts and items, generation, validation, concept review screen, edit and remove; migration (backup, approval) | A real RxJS and a German pack pass the checks; questions stay inside the material |
| **2. Session and cycles** | Revision home, session planner, topic sets, the workspace, multiple choice in code, open answers via the AI check, confidence, relearn-before-you-leave, completion card, cycles 1–6 and their dates, keep going | A full session runs end to end; intervals follow §4.2 |
| **3. Tutoring and history** | Hint ladder, misconceptions, model answer layers, code comparison, per-concept history table, report handling into the benchmark | Gaps are corrected without waiting on the AI for hints |
| **4. Later** | FSRS-style scheduling from your data, maintenance checks, voice conversation mode (useful for German), code execution (needs a sandbox), diagram activities | Decided separately |

## 12. Testing and evaluation

- **Unit:** planner (budget, set sizes, interleaving, early revision), cycle rules, level adaptation, multiple-choice
  checking, pack validation (answer leaks, option rules).
- **Integration:** material upload, pack building with the fake provider, a whole session, history, reports, migration
  on a disposable database.
- **AI evaluation set** (`eval/`): sample materials (RxJS notes, a German grammar sheet, a NestJS PDF) → measure that
  concepts come only from the material, every level has questions, multiple choice is correct (spot-checked by hand),
  and no question reveals its answer. The existing 96-case answer-checker benchmark is extended with reported "unfair
  check" cases.
- **Images:** a small test with your own photographed notes and screenshots before images are enabled.
- **Browser:** the workspace at laptop and phone widths.

## 13. How we will know it works

Not questions answered or minutes spent, but: fewer hints needed for the same concept over cycles; concepts reaching
Recalled or better in a later cycle without help; repeated misconceptions disappearing; open answers that the AI and
you score the same way.

## 14. Decisions (approved with the recommended answers, 20 Nov 2026)

1. **Images:** check GWDG's image models with your notes first (recommended), or leave images out for now?
2. **Word files:** add a small library to read `.docx` (recommended), or ask to save as PDF?
3. **The unit of revision:** the topic with concepts inside (recommended, as you described it), replacing separate
   sub-topic schedules for new revisions?
4. **After cycle 6:** retained with optional maintenance checks off by default (recommended), or on by default?
5. **Your material:** keep the extracted text so the pack can be refreshed (recommended), or keep only the pack?
6. **Consent:** a new `AI_PROCESSING` version that names revision material (needed if material is sent to GWDG).
