# Engineering City

A local-first, single-user learning system for the nine-month software-engineering journey, from **17 Nov 2026 to 17 Aug 2027**. It keeps the original isometric city and makes it functional:

- **Today** (Mission Control): today's Berlin date, where you are, today's assignments, the 4-hour target, the time logged, and carried-over work.
- **Week**: planned vs actual hours per day, completed and remaining assignments, upcoming milestones. Sunday is rest.
- **City**: the map. Each learned sub-topic adds a floor. A roof goes on only after you **demonstrate** the skill. The car moves with demonstrated core progress, never with the calendar.
- **Progress**: hours (total, weekly, monthly), learned vs demonstrated per district, recall and revision, and the stage timeline with delays.
- **Revision**: recall checks while you study, then spaced revision of every learned sub-topic and topic, with intervals that adapt to how well you remembered. The Revision tab lists what is due, overdue, weak and coming up, starts a session, and keeps the history and recall analytics. See [section 6.1](#61-revision-and-active-recall).

The stack is React + TypeScript (Vite), Node.js + Express, PostgreSQL + Prisma, Docker Compose. The design documents are in [`docs/`](docs): [SRS](docs/SRS.md), [HLD](docs/HLD.md), [LLD](docs/LLD.md), with a PDF of each, and the [revision specification](docs/Revision-Spec.md).

---

## 1. Start

**Prerequisites:** Docker Desktop (with Compose v2) and free port 80. Nothing else is needed on the host.

```bash
docker compose up --build
```

Open **http://localhost**. The first start builds the images, applies the database migrations, loads the curriculum and generates the plan (542 tasks, 679 h). Later starts reuse everything.

To run in the background, add `-d`: `docker compose up --build -d`.

> Configuration is optional. To change the database password, port or clock, copy `.env.example` to `.env` and edit it. Without `.env`, safe local defaults are used.

## 2. Stop, logs and status

| Task | Command |
|---|---|
| Stop (data is kept) | `docker compose down` |
| Status and health | `docker compose ps` |
| Follow all logs | `docker compose logs -f` |
| Backend logs only | `docker compose logs -f backend` |
| Restart after changing code | `docker compose up --build -d` |

## 3. Data persistence

All data lives in PostgreSQL on the named Docker volume **`engineering-city_pgdata`**.

- `docker compose down` → `up`: **data kept**.
- Rebuilding images: **data kept**. Migrations only ever add changes, and the seed never overwrites your progress or tasks.
- `docker compose down -v`: **all data deleted**. This is how you reset.

### Reset to a fresh plan

This permanently deletes all progress, tasks and logged time:

```bash
docker compose down -v
docker compose up --build
```

## 4. Backup and restore

The commands work in PowerShell and in Git Bash. In Git Bash, prefix them with `MSYS_NO_PATHCONV=1` so that `/tmp` paths are not rewritten.

**Back up** (safe while the app is running):

```bash
docker compose exec -T db pg_dump -U engineering_city -d engineering_city -Fc -f /tmp/backup.dump
docker compose cp db:/tmp/backup.dump ./backups/engineering-city-YYYYMMDD.dump
```

**Restore** (replaces the current data with the backup):

```bash
docker compose cp ./backups/engineering-city-YYYYMMDD.dump db:/tmp/restore.dump
docker compose exec -T db pg_restore -U engineering_city -d engineering_city --clean --if-exists /tmp/restore.dump
```

**Check a backup without touching your data** by restoring it into a scratch database:

```bash
docker compose exec -T db createdb -U engineering_city restore_check
docker compose exec -T db pg_restore -U engineering_city -d restore_check /tmp/restore.dump
docker compose exec -T db dropdb -U engineering_city restore_check
```

Back up weekly, after the Saturday review, and keep the last four. `backups/*.dump` is git-ignored. If you changed `POSTGRES_USER` or `POSTGRES_DB` in `.env`, use your values in place of `engineering_city`.

## 5. Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `engineering_city` / `engineering_city_local` / `engineering_city` | Database credentials. Use URL-safe characters in the password. |
| `HTTP_PORT` | `80` | Host port, always bound to `127.0.0.1`. |
| `APP_TODAY` | *(empty)* | Pins "today" (`YYYY-MM-DD`) for demos or for testing deadlines. Leave it empty in normal use. |
| `AI_ENABLED`, `GEMINI_API_KEY`, … | off | Optional AI check of revision answers; see §6.2 and `.env.example`. |

Only the web server is published, and only on `127.0.0.1`. The API and the database are not reachable from your network.

## 6. How the plan works

| Stage | Dates | Days |
|---|---|---|
| Frontend Engineering | 17 Nov – 31 Dec 2026 | Mon–Sat (Mon–Fri from 1 Dec) |
| Architecture coursework (parallel) | 1 Dec 2026 – 31 Mar 2027 | Saturdays |
| Backend + Database (interleaved) | 1 Jan – 31 Mar 2027 | Mon–Fri |
| Architecture consolidation | 1 Apr – 15 May 2027 | Mon–Sat |
| Cloud Engineering | 16 May – 19 Jun 2027 | Mon–Sat |
| Applied AI Engineering | 20 Jun – 24 Jul 2027 | Mon–Sat |
| Engineering Consolidation | 25 Jul – 17 Aug 2027 | Mon–Sat |

- Core and important topics are planned in 30-minute units: about 70% study (split across sub-topics) and 30% practice (the topic's exercise). Tasks are at most 2 h, and days at most 4 h. Optional topics are not planned; add them from the topic panel if you want them.
- Each stage ends with **buffer days**, which absorb delays.
- When you fall behind, tasks appear under **Carried over**. **Move all forward** places them on the next study days that have room. Nothing is ever marked done for you, and every task keeps its original date.
- A stage whose end date passes with unfinished tasks shows **Delayed by N days**. The car does not move because of dates.

### 6.1 Revision and active recall

Three things are tracked separately: **learned** (you ticked the sub-topics), **demonstrated** (you did the exercise on your own) and **remembered** (you can still retrieve it). Revision only ever changes the third.

- **While studying**, press **Check** next to a sub-topic in the topic panel: answer from memory, reveal what a full answer covers, note the gaps. Nothing is scheduled and the sub-topic stays unticked until you tick it.
- **After you tick a sub-topic**, its first revision is due the next day. A topic gets its own revision (how the parts fit together) once two sub-topics are learned or it is demonstrated.
- **Revising**: open the **Revision** tab (its badge counts what is due; accent means something is overdue) and press **Start session**, or use **Revise** on a task in Today. Answer first, then reveal and score yourself: 0 Forgot, 1 Struggled, 2 Recalled, 3 Mastered this attempt. A 0 or 1 needs a note of what was missing, and a confirmed correction before the next attempt.
- **Next date**: 0–1 → 1 day; 2 → 3 days; 3 → 7, 14, 30 days, then doubling up to 60. A 3 with hints or notes counts as 2. Two failures in a row mark the unit **weak**, and weak overdue units go first.
- **Capacity**: revision counts in the planned day and week (10 min per sub-topic, 20 per topic). It uses free time first; only what doesn't fit goes over a 4 h day, at most **30 minutes a day and 2 hours a week**. Today and Week show the over-target time. Learning tasks are never moved. Change both values in the Revision tab (0 and 0 = strict 4 h days).
- **Session**: three steps, Retrieve → Compare → Assess. Nothing is scored for you: pick the score yourself. One attempt per unit per day.
- **Sunday** stays a rest day: revisions due that day are listed as optional and planned for Monday.
- **Questions**: every topic has a curriculum question with evaluation criteria, every unit has eight templates (Explain, Why, How, Compare, Scenario, Debug, Design, Write from memory), and you can add your own under **Questions** in the topic panel.

### 6.2 AI check and voice answers (optional)

Off by default. When on, a revision answer can be spoken (transcribed, then editable) and checked against the question's own expected points. The AI only **suggests**: you choose your own score first, see which points were covered with quotes from your answer, answer at most one follow-up question, and then save **your** score. It never changes learned, demonstrated, tasks or schedules. Design: `docs/AI-Voice-Design.md`.

1. Create a free API key in Google AI Studio and note your project's daily request limit there.
2. In `.env`: `AI_ENABLED=true`, `GEMINI_API_KEY=…`, and `AI_DAILY_REQUEST_LIMIT` a little below that limit. Optionally pin `AI_EVALUATION_MODEL` / `AI_TRANSCRIPTION_MODEL` to the exact model you benchmarked.
3. `docker compose up --build -d`, open a revision, read and accept the notice.

**Privacy:** on the free tier Google may keep what you send and people may review it; Blueprint never stores recordings and sends no notes, history or other topics. The paid alternative for checking is Claude Haiku 5.5 (`AI_EVALUATION_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`); transcription stays on Gemini.

**Model and limits:** `gemini-3.8-flash` was chosen after the benchmark (no false passes). The free tier allows about 20 requests a day per model, resetting at 09:00 Berlin; set `AI_DAILY_REQUEST_LIMIT=18` so the app stops just before Google refuses. A voice revision uses two requests (transcription and check), a typed one uses one.

**Benchmark the answer checker** (96 constructed cases, 12 questions × 8 variants; results in `backend/eval/results/`, git-ignored). On the free tier run it in parts, one question per day or so:

```bash
cd backend
npx tsx --env-file=../.env eval/run.ts --only idx --runs 2 --delay 7000    # one question's 8 cases, twice
npx tsx eval/report.ts gemini-3.8-flash                                     # merge every saved run, no new calls
```

**Test speech recognition on your microphones:** read the 12 sentences in `backend/eval/speech-terms.json` aloud and save them as `01.wav` … `12.wav` (or `.mp3` / `.flac`, for example with Windows Sound Recorder) in one folder per microphone, then:

```bash
cd backend
npx tsx --env-file=../.env eval/speech.ts --dir ../recordings/laptop --device laptop --delay 7000
```

It reports how many of the 60 curriculum terms were spelled correctly (gate 95 %) and the word error rate. Blueprint never stores the recordings in its database, and `recordings/` is git-ignored so they are never committed. Each one is sent once to Google for transcription (12 requests per microphone); on the free tier Google may keep it and people at Google may review it. The benchmark and this test share the daily quota with your real revisions, so run them on days you revise less.

## 7. Development without Docker

You need Node.js 22+ and a PostgreSQL database.

```bash
# backend (http://127.0.0.1:3000)
cd backend
npm install
set DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/engineering_city   # PowerShell: $env:DATABASE_URL="..."
npx prisma migrate deploy
npm run db:seed
npm run dev

# frontend (http://127.0.0.1:5173, proxies /api to API_PROXY or :3000)
cd frontend
npm install
npm run dev
```

## 8. Tests

```bash
# Backend unit tests (domain logic: dates, planner, progress, rescheduling, revision, curriculum)
cd backend && npm run test:unit

# Backend API integration tests (need a disposable PostgreSQL; each run uses its own schema)
docker run -d --name ec-test-db -e POSTGRES_USER=ec -e POSTGRES_PASSWORD=ec_test -e POSTGRES_DB=ec_test -p 127.0.0.1:55432:5432 postgres:17-alpine
TEST_DATABASE_URL=postgresql://ec:ec_test@127.0.0.1:55432/ec_test npm run test:integration   # PowerShell: $env:TEST_DATABASE_URL="..."; npm run test:integration

# AI evaluator benchmark and speech-term test (call the real provider; not part of npm test; see §6.2)
npx tsx --env-file=../.env eval/run.ts --only idx --runs 2 --delay 7000   # or AI_EVALUATION_PROVIDER=fake npm run eval:ai for a dry run
npx tsx eval/report.ts                                                     # re-report saved results

# Frontend tests (map geometry, renderer, formatting, Mission Control, recall dialog, AI check)
cd frontend && npm test
```

## 9. Project structure

```text
engineering-city/
├── docker-compose.yml        # db + backend + frontend, 127.0.0.1 only
├── .env.example
├── docs/                     # SRS / HLD / LLD / Revision-Spec (Markdown source + PDF), tools/ = PDF build
├── backups/                  # pg_dump files (git-ignored)
├── backend/
│   ├── prisma/               # schema.prisma, migrations/, seed.ts
│   ├── src/
│   │   ├── curriculum/       # the researched curriculum (7 districts, 83 topics), stages, revision prompts
│   │   ├── domain/           # pure logic: dates, progress, planner, reschedule, revision
│   │   ├── modules/          # REST routes + services: curriculum, tasks, sessions, summary, schedule, revision
│   │   └── lib/              # clock, validation, errors
│   └── tests/                # unit + integration
└── frontend/
    ├── nginx.conf            # static files + /api reverse proxy + security headers
    └── src/
        ├── map/              # isometric engine (ported from the original page)
        ├── components/       # Sidebar, CityMap, TopicPanel, RevisionBox, RecallDialog, TodayView, WeekView, ProgressView
        ├── state/AppData.tsx # shared data context
        └── api/              # typed REST client
```

## 10. Troubleshooting

- **Port 80 is in use or forbidden** ("bind: An attempt was made to access a socket…"): set `HTTP_PORT=8088` (or any free port) in `.env` and open `http://localhost:8088`.
- **"Engineering City can't reach its server"**: run `docker compose ps`. The backend waits for the database to become healthy. Check `docker compose logs backend`.
- **Wrong date**: "today" is the server's clock in Europe/Berlin. Check that `APP_TODAY` is empty in `.env`.

## 11. Editing the curriculum

The curriculum is in `backend/src/curriculum/*.ts`. Rebuilding with `docker compose up --build` re-applies the text. Topic slugs are permanent, so never rename one. Add new sub-topics at the end of their list. The plan is generated only once, so new topics are not added to it automatically. Schedule them from the topic panel (**Add to a day…**). Revision prompts are in `backend/src/curriculum/prompts.ts` (one per topic); a unit test checks that every topic has one.
