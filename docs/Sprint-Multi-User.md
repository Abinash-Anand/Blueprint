---
title: "Blueprint — Multi-user sprint log"
subtitle: "Plan, migration strategy, progress and decisions"
version: "0.1"
date: "18 November 2026"
---

# 1. Starting point (inspected 18 Nov 2026)

| Area | State before the sprint |
|---|---|
| Users and auth | None. Single learner, local only. A request guard (same-origin `Origin` + `X-Blueprint: 1` header on writes) protects against cross-site requests. |
| Curriculum | One built-in curriculum (7 districts, 83 topics) seeded from `backend/src/curriculum/*.ts`. Global string primary keys (`District.id = "fe"`, `Topic.id = "fe.ts"`, `Stage.id`), `District.position` and `Stage.position` globally unique. |
| Settings | Singleton row `Settings.id = 1` (journey dates, time zone, revision allowances, AI consent) and global `WeeklyTarget` rows. |
| Data scoping | None: every query reads the whole database (about 140 query sites in 10 modules). |
| Presentation | Backend semantic presentation (`domain/presentation.ts`) and frontend tokens (styles.css Part 3). |
| AI | Optional Gemini check and voice (paused this sprint; kept working, not extended). |
| Live data | 83 topics, 549 tasks, 4 learned sub-topics, 2 recall attempts, 7 study sessions. Backup: `backups/engineering-city-20261118-pre-multiuser.dump` (18 tables, verified). |

# 2. Plan (work units, each tested before the next)

1. Palette preview → contrast check → apply (tokens only).
2. One additive migration: users, sessions, tokens, consents, cities, curriculum versions; `cityId` on every city-owned table, backfilled to the existing Engineering City.
3. Authentication: registration, verification, login, logout, sessions, reset, rate limits.
4. City context and ownership: every service scoped by `cityId`, ownership checked on every ID.
5. City management API and UI, city switcher.
6. Creation workflow (identity → requirements → constraints → curriculum → review) with a validated curriculum contract; versioning.
7. GDPR: consent records, export, deletion, documentation.
8. Onboarding, account and application settings.
9. Cloud-readiness review and deployment guide.
10. Final review and report.

# 3. Migration strategy (non-destructive)

The migration only **adds** tables and columns and backfills them; it drops no table, column or row, and is rehearsed on a restored copy of the backup before it is committed. It is never applied to the live database in this sprint (no deploy); it runs only when the app is next rebuilt, after approval.

1. Create `User`, `Session`, `AuthToken`, `ConsentRecord`, `City`, `CurriculumVersion`.
2. Insert one `City` row for the existing curriculum: id `engineering`, name "Engineering City", status ACTIVE, `ownerId` NULL (unclaimed).
3. Add `cityId` (nullable) to District, Stage, Settings, WeeklyTarget and the denormalised scoping tables (Topic, Task, StudySession, RevisionPrompt, RevisionSchedule, LearningCheckpoint, RevisionAttempt, RevisionEvaluation); backfill every existing row with `engineering`; then make it NOT NULL with a foreign key and indexes.
4. Replace the global unique constraints `District.position`, `Stage.position` by `(cityId, position)`; `Settings` gets `cityId` unique; `WeeklyTarget` gets a composite key `(cityId, weekday)`.
5. Keep existing string IDs unchanged. New cities use IDs prefixed with their city key (e.g. `c7k2.fe.ts`), so no existing primary key changes.

**Legacy ownership.** The existing Engineering City has no owner until one account claims it: the first verified account claims unowned cities, or, if `LEGACY_OWNER_EMAIL` is set, only that address does. Requires approval (see §6).

**Rollback.** Restore the backup (`pg_restore --clean`) and deploy the previous image; the migration has a documented down script in `prisma/migrations/<name>/down.sql` for the new columns and tables.

# 4. Progress

| Unit | State | Evidence |
|---|---|---|
| Palette preview → apply | Done | `frontend/palette-preview.html` (dev only); every tone ≥ 5.6:1 text, ≥ 3.5:1 icons; `__tests__/palette.test.ts` guards it. |
| Migration `20261118200000_multi_user` | Done, rehearsed | Restored copy of the live backup: identical row counts and content hashes before/after; schema matches; also clean on an empty database. |
| City isolation | Done | `lib/cityScope.ts` scopes every city-owned query; `cityId` defaults to `""` (fails the foreign key) so an unscoped create cannot succeed. All 151 existing tests pass through it. |
| Authentication | Backend done | Argon2id, hashed session and e-mail tokens, HttpOnly SameSite=Lax cookie, rate limits, enumeration-safe responses. |
| City management + curriculum contract | Done | Lifecycle, guarded delete, proposals, approval, versioning with removal protection; backend tests in `tests/integration/multiuser.test.ts`. |
| Frontend | Done, browser-checked | Sign-up/verify/sign-in/reset, onboarding, city switcher, city manager, 5-step creation wizard (template or contract file; AI step marked unavailable), account settings, privacy (consents, export, deletion). Checked end to end on a throwaway stack (port 8089), then removed. |
| Tests | Backend 179/179 (16 files), frontend 46/46; typechecks pass | New: auth (11), multi-user isolation/versioning/GDPR (11), contract (6), presentation for cities, palette contrast. |

# 5. Remaining work

- Not committed, not deployed. The live app still runs the previous build; deploying runs the migration (backup taken: `backups/engineering-city-20261118-pre-multiuser.dump`).
- Docs not yet written: deployment guide, data inventory, retention policy, processor list, outstanding GDPR decisions, rollback `down.sql` (§3 promises it), README/LLD updates.
- No frontend tests yet for the new screens (only backend tests and a browser walkthrough).
- E-mail address change is not implemented; German UI text does not exist (language setting stored only).
- Rate limits are in memory (one instance only); header still shows "Europe/Berlin" instead of the city's time zone.
- New topics added by a later curriculum version are not planned automatically (same as before for new curriculum topics).

# 6. Decisions requiring approval

1. Running migration `20261118200000_multi_user` on the live database (non-destructive, rehearsed on a copy).
2. Legacy ownership: the first verified account claims the existing Engineering City, unless `LEGACY_OWNER_EMAIL` is set (recommended: set it to your address before deploying).
3. Sign-in becomes required for the live app; local e-mails go to `./mail-outbox` unless SMTP is configured.
4. AI consent moves from the old settings row to per-user consent records; the previous acceptance is carried over at claim time as "pre-accounts".
5. New dependencies: `@node-rs/argon2`, `nodemailer`.
