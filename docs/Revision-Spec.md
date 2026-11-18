---
title: "Blueprint — Revision and Active Recall Business Logic Specification"
subtitle: "Learning checkpoints, active recall, revision attempts, adaptive scheduling and revision progress"
version: "1.0"
date: "18 November 2026"
---

> **Status:** Accepted and implemented on 18 November 2026 (phases 1–7). This is the business-logic source; the requirements derived from it are in `SRS.md` §3.9, the design in `HLD.md` §4–§7 and `LLD.md` §2.4 and §12.5. Where the specification leaves a choice open, the decision taken is recorded in SRS §3.9 and LLD §12.5. The text below is the specification as provided by the product owner; some bullet lists are run together into sentences for layout, with no change of content.

# 1. Purpose

This document defines how Blueprint handles active recall and spaced revision throughout the learner's nine-month engineering curriculum.

The objective is to make learning more durable by incorporating retrieval practice into initial study sessions and scheduling subsequent retrieval attempts based on the learner's demonstrated recall performance.

The system must:

1. Encourage understanding before memorisation.
2. Integrate active recall into initial learning.
3. Support multiple retrieval methods appropriate to the subject.
4. Track recall performance over time.
5. Schedule subsequent revisions adaptively.
6. Prioritise weak or overdue knowledge.
7. Keep learning, revision and practical demonstration distinct.
8. Preserve the existing curriculum, daily planner and Sunday rest policy.

## 1.1 Design decisions

| Area | Decision |
|---|---|
| Question creation | Hybrid: curriculum-provided, template-based and learner-authored |
| Retrieval methods | Mixed: conceptual, verbal, written, visual and practical |
| Revision scheduling | Adaptive: future dates depend on previous performance |
| Revision granularity | Both sub-topic and topic |
| Assessment | Four-level recall assessment |
| Revision history | Preserve individual attempts |
| Scheduling calendar | Monday–Saturday for planned work; Sunday optional |
| AI integration | Excluded from this version |

# 2. Learning model

Blueprint uses three related but independently tracked dimensions.

## 2.1 Understanding

Understanding means constructing a meaningful mental model of a concept.

The learner should be able to:

- Explain a concept in their own words.
- Describe why it exists.
- Explain how it works.
- Connect it to related concepts.
- Identify where and when it is useful.

For example, learning PostgreSQL indexes should involve understanding what an index does, why it improves certain queries, and what trade-offs it introduces.

Simply reading the documentation does not establish understanding.

## 2.2 Remembering

Remembering means retrieving previously learned knowledge without immediately consulting notes, documentation or tutorials.

Examples:

- Explaining dependency injection without opening documentation.
- Recalling the purpose of a database transaction.
- Describing the differences between authentication and authorisation.
- Reconstructing a concept map from memory.
- Answering questions about a previously studied topic.

## 2.3 Applying

Applying means independently using the knowledge to solve a problem or implement something.

Examples:

- Implementing a NestJS guard.
- Designing a relational database schema.
- Writing a SQL query involving joins and aggregation.
- Implementing an API endpoint.
- Diagnosing a performance problem.

These dimensions must remain distinct.

A successful retrieval attempt does not automatically demonstrate practical competence. Likewise, completing a practical exercise does not automatically prove that all related concepts can be recalled later.

# 3. Curriculum and revision granularity

The existing curriculum remains the source of truth.

Blueprint already organises learning into:

**District → Topic → Sub-topic**

Revision must operate on these same units.

## 3.1 Sub-topic revision

Sub-topic revision tests an individual concept or skill.

Example:

Topic: TypeScript

- Generics
- Utility types
- Type narrowing
- Discriminated unions

Each sub-topic can have its own retrieval prompts, revision history and next revision date.

The purpose is to identify specific weaknesses instead of forcing the learner to revise an entire topic unnecessarily.

## 3.2 Topic-level revision

Topic-level revision evaluates the learner's ability to connect and use multiple sub-topics.

For example, a TypeScript topic-level revision might ask the learner to:

- Explain how generics and constraints work together.
- Design a typed function using generics.
- Explain how narrowing affects the function's return type.
- Solve a problem involving multiple TypeScript concepts.

Topic-level revision should test integration, not simply repeat all the sub-topic questions.

## 3.3 Eligibility rules

1. A sub-topic becomes eligible for scheduled revision after it is explicitly marked as learned.
2. A topic-level revision becomes eligible when the topic has at least two learned sub-topics.
3. Topic-level revision may be offered earlier when the learner has already demonstrated the relevant knowledge.
4. A revision attempt must never automatically mark a sub-topic as learned.
5. A revision attempt must never automatically mark a topic as demonstrated.
6. A revision attempt must not change district progression or move the car.

# 4. Question creation: hybrid approach

The question system combines three sources.

## 4.1 Curriculum-provided prompts

Prompts are supplied with the curriculum and mapped to specific topics or sub-topics.

Examples:

- What problem does dependency injection solve?
- What is the purpose of a database index?
- Explain the difference between an interface and a type alias.
- What happens when a database transaction is rolled back?

These prompts provide a reliable baseline for revision.

## 4.2 Template-based prompts

Blueprint provides reusable prompt structures that can be adapted to different curriculum topics.

| Template | Example |
|---|---|
| Explain | Explain this concept in your own words. |
| Compare | Compare this concept with a related concept. |
| Why | Why is this technique necessary? |
| How | Describe how this mechanism works internally. |
| Scenario | Given this situation, what would you do and why? |
| Debug | Identify the problem in this implementation. |
| Design | Design a solution using the concepts you have learned. |

Templates allow question coverage to expand without requiring manually written questions for every small curriculum item.

## 4.3 Learner-authored prompts

The learner can create and save their own questions.

For example, after learning NestJS dependency injection, the learner might write:

"How does NestJS resolve a dependency when multiple providers are registered?"

The prompt should be associated with its relevant curriculum unit.

## 4.4 Prompt requirements

Every prompt should have:

- A prompt title or question.
- Its associated topic.
- Its associated sub-topic, if applicable.
- Retrieval method.
- Expected answer or evaluation criteria.
- Difficulty, if useful.
- Source: curriculum, template or learner-authored.
- Active/inactive status.

A prompt should test a meaningful learning objective, not an arbitrary sentence from documentation.

## 4.5 Prompt quantity

Blueprint should not encourage creating hundreds of flashcards.

The objective is meaningful retrieval, not maintaining a large question collection.

Prompts should focus on:

- Important concepts.
- Common misunderstandings.
- Relationships between concepts.
- Important technical mechanisms.
- Knowledge needed for practical implementation.

A single well-designed prompt can test several related concepts.

# 5. Retrieval methods: mixed approach

The system must support different retrieval formats because engineering knowledge is not exclusively factual knowledge.

## 5.1 Conceptual retrieval

The learner explains a concept without consulting notes.

Examples:

- Explain dependency injection.
- Describe how an HTTP request reaches an Express controller.
- Explain the difference between a process and a thread.

## 5.2 Question and answer retrieval

The learner answers a predefined question. Answers can be provided verbally or in writing.

Examples:

- What is a database foreign key?
- What is the difference between PUT and PATCH?
- Why should database transactions be used?

## 5.3 Visual retrieval

The learner reconstructs information visually.

Examples:

- Draw a database relationship diagram.
- Reconstruct a request lifecycle.
- Draw an event-driven architecture.
- Create a concept map from memory.

## 5.4 Practical retrieval

The learner demonstrates knowledge through implementation.

Examples:

- Write a SQL query without referring to notes.
- Implement a NestJS service.
- Build a small API endpoint.
- Solve a programming problem.
- Debug a broken implementation.

## 5.5 Comparison and scenario retrieval

The learner applies knowledge to a situation or compares alternative approaches.

Examples:

- Compare PostgreSQL and MongoDB for a particular application.
- Explain when caching is useful.
- Decide whether a system should use synchronous or asynchronous communication.
- Identify an appropriate database indexing strategy.

## 5.6 Retrieval method selection

The method should be selected according to the learning objective.

| Knowledge type | Preferred retrieval |
|---|---|
| Conceptual | Explain, question and answer |
| Syntax and APIs | Write from memory |
| Problem-solving | Solve a new problem |
| Architecture | Diagram and explanation |
| Database | SQL exercises and schema design |
| Practical engineering | Independent implementation |
| Comparative knowledge | Compare and justify |

The learner may change the suggested method.

The system must not force every topic into flashcards or question-and-answer format.

# 6. Active recall during initial learning

Active recall is not restricted to revision sessions. It should be incorporated into the initial study process.

## 6.1 Learning checkpoint workflow

The recommended sequence is:

1. Study a small section of the material.
2. Stop consuming information.
3. Close the documentation or learning resource.
4. Retrieve the key ideas from memory.
5. Explain the concept or answer a question.
6. Compare the response against the source material.
7. Identify missing or incorrect information.
8. Correct the misunderstanding.
9. Continue learning.

Example: the learner studies TypeScript generics. Instead of reading the entire chapter and moving on, Blueprint encourages the learner to pause and answer: What are generics? What problem do they solve? How do generic constraints work? Can you write a generic function independently? The learner then checks the answers and corrects mistakes.

## 6.2 Learning checkpoint behaviour

Learning checkpoints are part of a study activity. They are not automatically separate calendar tasks.

A checkpoint may record:

- The learning unit.
- The checkpoint prompt.
- The learner's response or result.
- Whether the learner needed assistance.
- Identified knowledge gaps.
- Completion timestamp.

The learner's explicit learned/unlearned status remains authoritative. Completing a checkpoint alone must not mark a sub-topic as learned.

## 6.3 Difference between checkpoints and revision

| Learning checkpoint | Scheduled revision |
|---|---|
| Occurs during initial learning | Occurs after learning |
| Checks immediate understanding and recall | Checks retained knowledge |
| Usually part of a study session | Can become a separate task |
| Helps correct misunderstandings early | Helps identify forgetting over time |
| Does not independently create a revision schedule | Creates or updates the next revision date |

# 7. Revision assessment system

Every completed revision attempt must receive an assessment. Blueprint uses a four-level scale.

| Score | Label | Assessment criteria |
|---|---|---|
| 0 | Forgot | Unable to retrieve the concept or provide a meaningful answer. |
| 1 | Struggled | Retrieves fragments but needs substantial hints, notes or assistance. |
| 2 | Recalled | Retrieves the main concept correctly, with some hesitation or minor mistakes. |
| 3 | Mastered this attempt | Independently retrieves the relevant knowledge accurately and satisfies the prompt's evaluation criteria. |

The wording "Mastered this attempt" is deliberate. A single successful attempt does not establish permanent mastery.

## 7.1 Assessment requirements

The score must reflect the actual retrieval task. A conceptual explanation is assessed on accuracy and completeness; a coding exercise on correctness and independence; an architecture question on reasoning and completeness; a diagram on the accuracy of its relationships and structure. A conceptual question must not require code simply to receive a score of 3.

## 7.2 Assessment metadata

Each revision attempt should record: score (0–3); retrieval method; attempt date and time; duration, if recorded; whether hints were used; whether notes or documentation were consulted; mistakes or missing concepts; correction completed; optional learner comment.

The attempt history must be preserved. A later successful attempt must not overwrite an earlier failure.

## 7.3 Correction requirement

When an attempt reveals incorrect or incomplete knowledge:

1. Identify the gap.
2. Consult the relevant learning material.
3. Correct the misunderstanding.
4. Confirm the correct explanation or implementation.
5. Schedule a subsequent retrieval attempt.

A failed retrieval should not be treated as a completed learning outcome simply because the assessment was recorded.

# 8. Adaptive revision scheduling

Revision scheduling is based on the learner's previous performance. Blueprint should not use a completely fixed revision timetable.

The next revision date should depend on: the previous assessment score; the number of successful consecutive attempts; the previous revision interval; whether the learner needed hints or notes; whether the knowledge gap was corrected; the number of days since the last retrieval.

The system should prioritise weak knowledge and allow stronger knowledge to be reviewed less frequently.

## 8.1 Initial scheduling policy

The following intervals are proposed as initial product rules, not scientifically optimal or universally applicable intervals.

| Assessment | Initial next revision |
|---|---|
| 0: Forgot | Next study day after correction |
| 1: Struggled | Approximately 1 day |
| 2: Recalled | Approximately 3 days |
| 3: Mastered this attempt | Approximately 7 days |

Subsequent successful attempts can gradually extend the interval:

| Consecutive successful attempts | Suggested interval |
|---|---|
| First successful attempt | 7 days |
| Second successful attempt | 14 days |
| Third successful attempt | 30 days |
| Further successful attempts | Extend cautiously, subject to performance |

These intervals are configurable policy defaults. They should be evaluated against actual usage rather than treated as a proven universal formula.

## 8.2 Adaptive interval rules

**Rule A: Poor recall.** If the score is 0 or 1: reset the successful-attempt sequence; require correction of the knowledge gap; schedule another attempt at a short interval; do not extend the interval.

**Rule B: Partial recall.** If the score is 2: preserve the successful retrieval history; use a moderate interval; do not extend as aggressively as after a score of 3.

**Rule C: Strong recall.** If the score is 3: increment the consecutive successful-attempt count; extend the next interval; avoid repeatedly testing knowledge that is already being retrieved reliably.

**Rule D: Repeated failure.** If the learner repeatedly scores 0 or 1: keep the revision interval short; flag the learning unit as weak; encourage revisiting the original learning material; do not endlessly generate new questions without correcting the underlying misunderstanding.

## 8.3 Adaptive scheduling pseudocode

```ts
type RecallScore = 0 | 1 | 2 | 3;

interface RevisionState {
  previousIntervalDays: number;
  consecutiveSuccessfulAttempts: number;
}

function calculateNextInterval(score: RecallScore, state: RevisionState): number {
  if (score === 0) return 1;
  if (score === 1) return 1;
  if (score === 2) return 3;
  if (state.consecutiveSuccessfulAttempts === 0) return 7;
  if (state.consecutiveSuccessfulAttempts === 1) return 14;
  return Math.min(state.previousIntervalDays * 2, 60);
}
```

This is an initial scheduling policy, not the final implementation contract. The implementation must also account for correction status, study-day rules, existing overdue work and scheduling capacity. A score of 0 should not result in a new revision being scheduled before the learner has corrected the misunderstanding.

## 8.4 Scheduling date calculation

The interval is calculated in calendar days. However, the scheduler should avoid creating mandatory Sunday tasks.

- Monday–Saturday: schedule normally.
- Sunday: revision is optional.
- A revision that falls due on Sunday remains eligible for optional completion.
- If not completed on Sunday, it remains due and can be included in the next available study-day schedule.
- Overdue status must not disappear merely because the task is moved.

The original calculated due date and the actual scheduled date should remain distinguishable.

## 8.5 Capacity handling

Revision tasks must fit into the existing daily planning system. Blueprint must not blindly add every due revision to an already full day. When revision workload exceeds available capacity:

1. Prioritise overdue weak knowledge.
2. Prioritise items with the oldest due dates.
3. Consider the assessment score and time since the last attempt.
4. Distribute remaining revisions across available study days.
5. Preserve their due dates and overdue status.

Revision scheduling must not silently displace the entire planned learning curriculum. The learner should be able to see when revision workload is competing with new learning.

# 9. Revision workflow

```text
Sub-topic marked as learned → Revision becomes eligible → Prompt selected → Learner attempts retrieval
→ Answer checked and assessed → Score and attempt history recorded → Knowledge gap?
   yes → Correct gap → Short interval ┐
   no  → Calculate next interval ─────┴→ Next revision scheduled
```

## 9.1 Starting a revision

Display the question or challenge and the retrieval method. Hide the expected answer or solution. Do not expose explanatory material before the learner attempts retrieval. The learner should be able to complete the task without seeing the answer first.

## 9.2 Submitting an attempt

1. Reveal the expected answer or evaluation criteria.
2. Allow the learner to compare their response.
3. Record the assessment.
4. Record mistakes and missing knowledge.
5. Require correction when necessary.
6. Calculate the next revision date.

## 9.3 Revision completion

A revision task can be marked complete only after the attempt has been assessed and recorded. Completing the revision task must not: mark a sub-topic as learned; mark a topic as demonstrated; increase district completion directly; move the car; change the original curriculum estimate.

# 10. Sunday policy

Sunday remains a rest day and backlog recovery day. Revision is optional. The Sunday interface may offer due revisions, overdue revisions, weak knowledge units and optional weekly consolidation.

Sunday must have zero mandatory learning target, no revision target, no daily shortfall and no penalty for not completing revisions. A revision due on Sunday remains visible, but it must not become a compulsory Sunday assignment. The system must not automatically move every Sunday revision to Monday if doing so creates an unreasonable workload spike.

# 11. Interleaved revision

Blueprint should support interleaving across related learning units. Instead of revising one topic repeatedly in isolation, the learner can alternate between several previously learned concepts (for example TypeScript generics, type narrowing, utility types, dependency injection, SQL relationships) to practise distinguishing between them.

Interleaving must respect prerequisites: Blueprint should not schedule retrieval of a concept that has not yet been meaningfully introduced. The scheduler should prioritise due and weak knowledge, but it may mix different topics when selecting the next revision.

# 12. Data and domain requirements

The existing application already has `Task`, `StudySession`, `Topic`, `SubTopic`, topic learning status, `needsReview` and `TaskKind` including `REVISION`. The revision system should extend these models where practical rather than create an unrelated parallel system.

## 12.1 Proposed domain entities

**RevisionPrompt**: id, topicId, subTopicId (optional), title, content, retrievalMethod, expectedAnswer, source (curriculum, template or learner-authored), isActive.

**RevisionSchedule**: id, topicId, subTopicId (optional), nextDueAt, lastAttemptAt, previousIntervalDays, consecutiveSuccessfulAttempts, status (scheduled, due, overdue, suspended). A schedule is associated with a specific revision unit. Topic-level and sub-topic-level schedules must not accidentally overwrite each other.

**RevisionAttempt**: id, revisionScheduleId, promptId, score (0–3), retrievalMethod, attemptedAt, durationMinutes (optional), usedHints, usedNotes, mistakes, correctionCompleted, comment. Revision attempts are historical records and must be immutable after submission, except for explicitly supported administrative corrections.

**LearningCheckpoint**: id, topicId, subTopicId, promptId (optional), result, mistakes, completedAt.

These are conceptual domain requirements. The final database schema should be reconciled with the existing Prisma models before implementation.

## 12.2 Relationship overview

```text
District
  └─ Topic
       ├─ SubTopic
       ├─ RevisionPrompt
       ├─ RevisionSchedule
       │    └─ RevisionAttempt
       └─ LearningCheckpoint
Task ── TaskKind.REVISION ── RevisionSchedule (optional link)
```

# 13. Integration with the existing planner

Revision must integrate into the current task system. It must not create a separate calendar or planner.

## 13.1 Revision tasks

The existing `TaskKind.REVISION` value should be used for scheduled revision activities. Revision tasks should link to the relevant topic or sub-topic and to the associated revision schedule; have an estimated duration, an original due date and a scheduled date; support completion and rescheduling; preserve overdue status; and have a corresponding revision attempt when completed. A revision task should not be generated for every prompt independently. Multiple prompts can be part of one revision session for the same learning unit.

## 13.2 Planner responsibilities

1. Retrieve due and overdue revision schedules.
2. Prioritise weak and overdue knowledge.
3. Determine which revision units should be selected.
4. Estimate revision workload.
5. Allocate work within available capacity.
6. Preserve existing study tasks and curriculum sequencing.
7. Create revision tasks without duplicating existing active tasks.

The initial curriculum planner and adaptive revision scheduler should remain logically separate. The curriculum planner determines what the learner needs to learn. The revision scheduler determines what previously learned knowledge needs to be retrieved again.

# 14. User interface requirements

The revision system should extend existing screens. It should not introduce a large new navigation section unless implementation demonstrates a genuine need.

- **Topic panel:** learning status, learned sub-topics, revision status, last and next revision date, latest recall score, revision history, weak sub-topics; the learner can start a revision from the topic panel.
- **Today view:** scheduled learning tasks, practical tasks, due and overdue revisions, revision priority indicators; revision tasks visually distinguishable from study and practice tasks.
- **Week view:** planned and completed revision workload, due and overdue revision counts, revision distribution across study days. Sunday remains optional and must not affect the weekly target.
- **Progress view (may show):** total revision attempts, successful retrieval attempts, weak learning units, overdue revisions, revision performance over time, distribution of recall scores. These metrics describe learning behaviour; they must not become XP, streaks or gamification.

# 15. Business rules

| ID | Rule |
|---|---|
| REV-01 | Revision operates on the existing topic and sub-topic curriculum. |
| REV-02 | A sub-topic becomes revision-eligible only after it is explicitly marked learned. |
| REV-03 | Topic-level revision evaluates integration across relevant learned sub-topics. |
| REV-04 | Initial learning may include embedded retrieval checkpoints. |
| REV-05 | Learning checkpoints do not automatically mark sub-topics learned. |
| REV-06 | Revision attempts require an assessment score from 0 to 3. |
| REV-07 | Every submitted revision attempt is retained in historical records. |
| REV-08 | A failed retrieval requires correction before another short-interval attempt is considered complete. |
| REV-09 | The next revision interval depends on the latest assessment and previous performance. |
| REV-10 | A score of 0 or 1 resets the consecutive successful-attempt sequence. |
| REV-11 | A score of 3 extends the interval according to the configured scheduling policy. |
| REV-12 | A score of 2 uses a moderate interval and does not receive the strongest interval extension. |
| REV-13 | Revision scheduling must not create duplicate active tasks for the same revision unit and due cycle. |
| REV-14 | Revision tasks use the existing `TaskKind.REVISION`. |
| REV-15 | Revision does not automatically mark a topic demonstrated. |
| REV-16 | Revision does not directly change topic progress, district progress or car position. |
| REV-17 | Sunday revisions are optional and do not contribute to a target or shortfall. |
| REV-18 | Overdue revisions retain their original due date when rescheduled. |
| REV-19 | The scheduler must account for available daily capacity. |
| REV-20 | The application must operate without external AI or runtime network dependencies. |

# 16. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-REV-01 | Revision scheduling logic must be deterministic for identical inputs and policy settings. |
| NFR-REV-02 | Revision attempts must be persisted reliably. |
| NFR-REV-03 | Multi-record scheduling updates must use database transactions where required. |
| NFR-REV-04 | Scheduling calculations must use the existing `Europe/Berlin` time zone. |
| NFR-REV-05 | The revision engine must be testable independently of the React interface. |
| NFR-REV-06 | No external LLM, cloud service or third-party API is required. |
| NFR-REV-07 | Revision functionality must reuse existing application infrastructure and remain compatible with local-first operation. |

# 17. Acceptance criteria

- **Scenario A — Initial learning.** The learner studies a sub-topic; a retrieval checkpoint becomes available; the learner attempts recall without notes, checks and corrects the response; the checkpoint is recorded; the sub-topic's learned status changes only through the explicit learner action.
- **Scenario B — First revision.** The learner marks a sub-topic as learned; a revision schedule is created; the learner receives a relevant prompt and completes a retrieval attempt; the system records the assessment and calculates the next revision date.
- **Scenario C — Poor recall.** The learner scores 0; the system identifies the knowledge gap; the learner corrects the misunderstanding; the next attempt is scheduled at a short interval; the successful-attempt sequence is reset.
- **Scenario D — Strong recall.** The learner scores 3; the successful attempt is recorded; the consecutive successful-attempt count increases; the next interval is extended; the revision history remains available.
- **Scenario E — Sunday.** A revision becomes due on Sunday; the learner sees it as optional; no mandatory target or shortfall appears; if skipped, the revision remains due.
- **Scenario F — Workload capacity.** Several revisions become due on the same day; the system prioritises overdue and weak learning units; remaining revisions are distributed across available study days; existing learning tasks are not silently deleted or marked complete.
- **Scenario G — Progress integrity.** The learner completes a revision; the revision history and retention indicators update; the topic's learning status does not change automatically; the district progress and car position do not change.

# 18. Implementation phases

| Phase | Scope | Priority |
|---|---|---|
| 1 | Revision prompts, retrieval methods and initial learning checkpoints | Must |
| 2 | Revision attempts and four-level assessment | Must |
| 3 | Revision history and next-due scheduling | Must |
| 4 | Adaptive scheduling policy | Must |
| 5 | Integration with Today and Week planner | Must |
| 6 | Topic-level revision and interleaving | Should |
| 7 | Revision analytics and weak-area indicators | Should |
| 8 | More sophisticated scheduling based on accumulated usage data | Future |

Do not implement advanced scheduling algorithms before the basic system has been used enough to generate meaningful performance data.

# 19. Explicit exclusions

AI-generated questions or answers; LLM integration; external flashcard services; automatic scraping of documentation; a standalone flashcard application; social or collaborative revision; leaderboards, XP, streaks or gamification; complex machine-learning-based scheduling; automatic claims of permanent mastery; mandatory Sunday revision; a separate revision calendar.

# 20. Final design principles

1. **Understand before memorising.** Learning begins with a mental model, not a collection of disconnected facts.
2. **Retrieve during learning.** Active recall is part of initial learning, not something postponed until revision.
3. **Retrieve after learning.** Previously learned knowledge must be revisited over time.
4. **Correct mistakes.** A failed retrieval is useful only when the learner identifies and corrects the gap.
5. **Adapt to performance.** Strong recall should gradually reduce revision frequency; weak recall should increase attention.
6. **Focus on weaknesses.** The scheduler should not repeatedly prioritise knowledge the learner already retrieves reliably.
7. **Interleave intelligently.** Different concepts can be alternated, provided their prerequisites have been introduced.
8. **Preserve learning evidence.** Understanding, recall and practical demonstration remain separate.
9. **Respect capacity.** Revision must fit into the existing learning plan rather than overwhelm it.
10. **Protect rest.** Sunday remains optional and free of performance penalties.

The intended outcome is a learning system that continuously identifies what the learner knows, what they are forgetting and what they still need to practise, without turning the act of studying into another administrative job.
