# Deploying the backend to Render

The backend runs on Render as a Docker web service with a Render Postgres database, both in Frankfurt.
`render.yaml` at the repository root describes them; you can also create them by hand with the same settings.

## 1. Database

New → PostgreSQL: region **Frankfurt**, Postgres **17**. Copy its **Internal Database URL** for `DATABASE_URL`.
Render's free Postgres has limits and an expiry; check the current terms before keeping real data there.

## 2. Backend web service

| Setting | Value |
|---|---|
| Source | the repository, branch `main` |
| Language / runtime | Docker |
| Region | Frankfurt (the database's region) |
| Root Directory | `backend` (only changes there redeploy it) |
| Dockerfile path / build context | `./backend/Dockerfile` / `./backend` (the defaults once the root directory is `backend`) |
| Health Check Path | `/api/health` |

Do not set `PORT`: Render sets it and the server reads it. Each start applies pending migrations (never resetting
data), seeds the built-in Engineering City, then starts the API.

### Environment variables

Required:

| Key | Value |
|---|---|
| `DATABASE_URL` | the database's Internal Database URL |
| `APP_ENV` | `production` |
| `PUBLIC_URL` | the frontend's https address, without a trailing `/` |
| `COOKIE_SECURE` | `true` |
| `TZ` | `Europe/Berlin` |
| `TRUST_PROXY` | `1` (see below) |

E-mail: `MAIL_TRANSPORT=brevo`, `BREVO_API_KEY`, `MAIL_FROM` (for example `Blueprint <you@gmail.com>`) and
`REQUIRE_EMAIL_VERIFICATION=true`. Render's free web services cannot send on the SMTP ports ("Free web services can't
send outbound network traffic on ports 25, 465, or 587", render.com/docs/free), so the start-up check logs
`Mail server check failed … ETIMEDOUT` with SMTP and no mail leaves. Brevo sends over HTTPS instead:

1. Create a free Brevo account, then add and confirm your sender address in its **Senders** settings (a Gmail
   address works; Brevo sends a confirmation e-mail to it).
2. Create an **API key** in Brevo's settings and set it as `BREVO_API_KEY` (a secret: never in Git or chat).
3. Set `MAIL_FROM` to that confirmed sender. The `SMTP_` variables are then unused and can be removed.
4. Turn off Brevo's IP blocking for API keys: in Brevo, **Security → Authorised IPs**, choose **Deactivate blocking**
   for API keys. Brevo blocks API calls from addresses it has not seen, and Render's outbound addresses are shared
   and change, so without this every send fails with `Mail delivery failed … unauthorized` (Brevo's own reply says
   the IP address is unrecognised) even though the key is right.
5. Redeploy and look for `Mail server reachable and login accepted` in the log (the start-up check reads the Brevo
   account, which confirms the key without sending anything). Then sign up with a test address to see a mail arrive:
   the start-up check alone does not prove that sending is allowed.

On a paid instance SMTP works too (`MAIL_TRANSPORT=smtp` with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`).

AI: `AI_ENABLED=true`, `SAIA_API_KEY`, and the providers and models from the local `.env`
(`AI_EVALUATION_PROVIDER`, `AI_EVALUATION_MODEL`, `AI_EVALUATION_FALLBACK_MODEL`, `AI_TRANSCRIPTION_PROVIDER`,
`AI_TRANSCRIPTION_MODEL`, `AI_TRANSCRIPTION_FALLBACK_MODEL`, `AI_REQUEST_TIMEOUT_MS`, `AI_DAILY_REQUEST_LIMIT`;
`GEMINI_API_KEY` if Gemini is used). Every other variable has a working default (`backend/src/config.ts`,
`backend/src/modules/ai/config.ts`). Never set `APP_TODAY` or `AI_FAKE_TRANSCRIPT` here: they are for tests.

Pasting the local `.env` with "Add from .env" works, but remove any leading spaces before the keys first.

## 3. How the frontend reaches the API

The frontend calls the API at `/api/...` on its own domain. On Render it is a Static Site whose rewrite rule sends
`/api/*` to `https://<backend>.onrender.com/api/*`. Two things in the backend make that work:

- **The request guard** refuses state-changing requests whose `Origin` is not the API's own host. Through the rewrite
  the API sees its own `Host` but the page's `Origin`, so it also accepts exactly the origin of `PUBLIC_URL`
  (`backend/src/lib/guard.ts`). Set `PUBLIC_URL` to the frontend's address or every sign-in and change gets a 403.
- **The session cookie** is set without a domain, so it belongs to the frontend's domain and goes along with every
  `/api` request through the rewrite.

## 4. Client addresses (`TRUST_PROXY`)

Sign-up and sign-in are limited per client address, read from `X-Forwarded-For` only as far as `TRUST_PROXY` proxies
go. Too low and every visitor shares one limit (they all look like the proxy); too high and a client can choose
its own address. Browsers calling the backend directly should pass only Render's load balancer (`1`); requests
proxied by the frontend's static site likely pass one more hop. Check rather than assume. To check after deploying: set `LOG_CLIENT_IP=true`, sign in once, and
look at the service's logs. Each request line then shows `ip` (what the limits use) and `forwardedFor` (the whole
chain). `ip` should be your own public address; if it is a Render address, raise `TRUST_PROXY` by one. Then remove
`LOG_CLIENT_IP`: addresses are personal data and are not logged otherwise.

## 5. Free instance

A free web service sleeps when idle, so the first request after a pause takes about a minute; a recall that was
being graded when it stopped is graded again on the next start. It has no persistent disk, which the backend does
not need (mail goes out through Brevo; uploaded plan files and recordings are never stored as files).
