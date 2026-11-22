# Google Calendar sync: MVP plan

Status: plan for review (22 Nov 2026). Nothing is built yet.

## 1. What the MVP does

Your study plan shows up in Google Calendar, kept up to date as the plan changes. When you move a study block in
Google Calendar, Blueprint follows.

- **Connect once.** You connect Google from a Calendar page. Blueprint makes its own calendar called "Blueprint" in
  your Google account, and touches nothing else.
- **Out (Blueprint → Google).** Each study day in the next 14 days becomes one event, for example
  "Engineering City · 3 h 45 min", with the day's tasks listed in the description. Re-plans, finished tasks and
  changes to your hours update those events within about a minute. Your page never waits on Google.
- **In (Google → Blueprint).**
  - Drag a block to another time on the same day: the new time is kept from then on.
  - Drag it to another day: that day's open tasks move there and are pinned, as if you moved them by hand.
  - Delete a block: it's hidden for that day; the plan doesn't change (see question 4).
- **Disconnect** stops syncing and revokes Blueprint's access. The Blueprint calendar stays in your Google account
  unless you tick "Remove the Blueprint calendar too".

## 2. How the pasted architecture maps onto Blueprint

| The pasted design | In Blueprint's MVP | Why |
| --- | --- | --- |
| OAuth with offline access, encrypted token vault | Same: `access_type=offline`, `prompt=consent`, refresh token encrypted with AES-256-GCM, key from `CALENDAR_TOKEN_KEY` | As designed |
| Scope `calendar.events` | `calendar.app.created`: Blueprint may only make its own calendars and change events on them | The narrowest scope that does the job; Blueprint can't read or change your other events |
| Local mirror table | `CalendarEvent`: one row per city and day, with `googleEventId`, `etag`, a content hash, sync status | So no page ever calls Google |
| BullMQ / RabbitMQ worker | A job table in Postgres (`CalendarJob`) and an in-process worker using `FOR UPDATE SKIP LOCKED` | No Redis on Render's free plan or in Docker; Postgres already does the locking (as the re-plan lock does) |
| Initial full sync, then `syncToken` | Same, on the Blueprint calendar only | As designed |
| Webhooks (`events.watch`) | Only where the API has a public https address (Render). Locally, the same sync runs when you open the app, on "Sync now", and every 15 minutes | Google can't reach `localhost`; the sync job is the same either way |
| Channel renewal cron every 12 h | An in-process timer every 12 h, plus a check on start-up | Render's free plan sleeps, so there's no reliable cron; a sleeping server catches up on its next request |
| Echo-loop prevention by `etag` | Same: an incoming event whose `etag` matches the mirror is dropped | As designed |
| `If-Match` and 412 | Same; on 412 the remote time wins, Blueprint's title and description win | Time is the only thing you edit in Google |
| 410 Gone | Wipe the `syncToken`, full sync again | As designed |
| 403/429 rate limits | Exponential backoff with jitter, up to 8 tries; then the page shows "Sync paused" and a retry button | As designed |
| `extendedProperties.private` | `bpCity` and `bpDay` on every event Blueprint makes; events without them are left alone | Lets Blueprint find its own events and ignore anything you add by hand |
| Recurring events | Not used: Blueprint makes single events only | Days differ, so a rule wouldn't fit |
| SSE / WebSockets for live UI | Not in the MVP; pages already refetch when they get focus | Can come later |

## 3. The design in Blueprint's terms

- **Tasks have dates, not clock times.** So the MVP adds one setting: the time a study block starts, one value for
  all days (for example 18:00, in the city's time zone). The block lasts the day's planned minutes. A time you
  drag in Google overrides it for that day.
- **One block per city per day,** not one event per task. A re-plan can move hundreds of tasks; per-task events
  would mean hundreds of Google calls per re-plan and run into rate limits. Day blocks change far less often.
- **A rolling 14-day window.** Days further out aren't on the calendar yet; past days are left as they were.
- **What triggers a push:** any re-plan (the existing `PlanChange` points), finishing or adding a task, and a new
  day. These enqueue one push job per user, merged if one is already waiting.
- **The push job** works out the blocks that should exist, compares them with the mirror by content hash, and
  makes only the inserts, patches and deletes that differ.
- **Tokens:** refreshed under a per-user Postgres advisory lock, so two jobs never refresh at once. Tokens never
  appear in logs, errors or API responses.
- **Sign-in safety:** a `state` value tied to your session, so another site can't attach its own Google account
  to you. The callback goes through the frontend's address, so your session cookie stays first-party.
- **Webhook safety:** each channel gets a random token; a notification is accepted only if its channel ID,
  resource ID and token all match. The receiver answers 200 at once and enqueues the sync.
- **Tests:** a fake Google client (like the fake AI provider), so no test calls Google. Integration tests on the
  test database cover the full sync, incremental sync, 410, 412, echo drops, backoff and the token lock.

## 4. Steps (each its own branch and PR)

1. **Foundations:** additive migration (`GoogleConnection`, `CalendarEvent`, `CalendarJob`, `CalendarChannel`),
   token encryption, config, the job worker with backoff, the fake Google client. No visible change.
2. **Connect and disconnect:** the OAuth routes, creating the Blueprint calendar, and a Calendar page
   (`#/calendar`, a routed page) with connect, status, start time and disconnect.
3. **Out:** day blocks for the next 14 days, kept in step with re-plans.
4. **In:** incremental sync with `syncToken`, on open, on "Sync now" and every 15 minutes; time moves, day moves
   (tasks pinned), deletions; echo drops; 410 handling.
5. **Webhooks (Render only):** `events.watch`, the receiver, renewal. Checked on Render, since it needs https.

The migration only adds tables, so it can't touch existing data. I'd still back up before deploying, as usual.

## 5. What you need to do in Google Cloud (I can't do this for you)

1. Create a Google Cloud project and enable the Google Calendar API.
2. Set up the OAuth consent screen: External, app name "Blueprint", your e-mail, the scope
   `https://www.googleapis.com/auth/calendar.app.created`, and yourself as a test user.
3. Create an OAuth client of type "Web application" with these redirect URIs:
   - `http://localhost/api/calendar/google/callback` (local Docker)
   - `http://localhost:5173/api/calendar/google/callback` (dev)
   - `https://blueprint-client.onrender.com/api/calendar/google/callback` (Render)
4. Put the client ID and secret in `backend/.env` and in Render's environment (never in Git), along with a
   `CALENDAR_TOKEN_KEY` I'll generate for you.

**One catch:** while the app is in "Testing", Google expires refresh tokens after 7 days, so you'd reconnect weekly.
Publishing it ("In production") removes that, but Google shows an "unverified app" warning until it's verified,
and verification is required for sensitive scopes if other people use it. For just you, Testing is fine to start.

## 6. Questions for you

1. **What goes on the calendar:** one block per study day (suggested), or one event per task?
2. **Which calendar:** a separate "Blueprint" calendar (suggested), or your main calendar? The main calendar needs
   a broader scope that can see and change all your events.
3. **Start time:** what time should study blocks start by default? (You can change it on the Calendar page.)
4. **Deleting a block in Google:** hide it and leave the plan alone (suggested for the MVP), or treat that day as a
   rest day and move its tasks on? The second needs date-specific days off, which Blueprint doesn't have yet.
5. **Cities:** all your cities on the one Blueprint calendar (suggested), or one Google calendar per city?
