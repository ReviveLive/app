[![Revive Group](https://img.shields.io/badge/Revive_Group-1d1d1d?style=flat&labelColor=ffffff&logo=data:image%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyOTYiIGhlaWdodD0iMjk3IiB2aWV3Qm94PSIwIDAgMjk2IDI5NyI%2BDQogIDwhLS0gVG9wIHNlZ21lbnQgLS0%2BDQogIDxwYXRoDQogICAgZD0iTTczIDI5DQogICAgICAgQTE0NCAxNDQgMCAwIDEgMjkxIDEyNg0KICAgICAgIEw3MyAyOSBaIg0KICAgIGZpbGw9IiMxZDFkMWQiDQogICAgc3Ryb2tlPSIjMWQxZDFkIg0KICAgIHN0cm9rZS13aWR0aD0iMC42Ig0KICAvPg0KDQogIDwhLS0gR3JlZW4gY2VudGVyIHNlZ21lbnQgLS0%2BDQogIDxwYXRoDQogICAgZD0iTTM5IDYzDQogICAgICAgQTE0NCAxNDQgMCAwIDAgMzkgMjM0DQogICAgICAgTDIzNCAxNDgNCiAgICAgICBaIg0KICAgIGZpbGw9IiMxMTlmNDMiDQogIC8%2BDQoNCiAgPCEtLSBCb3R0b20gc2VnbWVudCAtLT4NCiAgPHBhdGgNCiAgICBkPSJNNzMgMjY5DQogICAgICAgQTE0NCAxNDQgMCAwIDAgMjkxIDE1OA0KICAgICAgIEw3MyAyNjkgWiINCiAgICBmaWxsPSIjMWQxZDFkIg0KICAgIHN0cm9rZT0iIzFkMWQxZCINCiAgICBzdHJva2Utd2lkdGg9IjAuNiINCiAgLz4NCjwvc3ZnPg0K)](https://rei-limited.com/)

[![Python](https://img.shields.io/badge/Python-3.12-009C43?logo=python&logoColor=white&labelColor=1d1d1d)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Read--only-009C43?logo=fastapi&logoColor=white&labelColor=1d1d1d)](https://fastapi.tiangolo.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![TimescaleDB](https://img.shields.io/badge/TimescaleDB-Hypertable-FDB515?logo=timescale&logoColor=black)](https://www.timescale.com/)
[![React](https://img.shields.io/badge/React-18.3-009C43?logo=react&logoColor=white&labelColor=1d1d1d)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5.4-009C43?logo=vite&logoColor=white&labelColor=1d1d1d)](https://vitejs.dev/)
[![Docker](https://img.shields.io/badge/Docker-Containerised-2496ED?logo=docker&logoColor=white)](https://docker.com)
[![Caddy](https://img.shields.io/badge/Caddy-Enabled-419E3D?logo=caddy&logoColor=white)](https://caddyserver.com/)

![Production](https://img.shields.io/badge/status-production-009C43?labelColor=1d1d1d)

---

# Revive Live — Production deployment

This is the production Revive Live platform: a password-protected `https://`
dashboard showing real vehicle telemetry to real customers. See
[CLAUDE.md](CLAUDE.md) for what this project is, its non-negotiables, and
where it's headed (Keycloak-based per-user auth).

The app source ([backend/](backend/README.md), [ingest/](ingest/README.md),
[frontend/](frontend/README.md)) lives at the root alongside these deployment
files.

## What's here

| File | What it does |
|------|--------------|
| `docker-compose.yml` | Runs `db` + `api` + `web` (Caddy) together — for local smoke-testing the whole stack on one machine |
| `backend.Dockerfile` | Packages the FastAPI backend |
| `frontend.Dockerfile` | Builds the React app and bundles it with Caddy |
| `Caddyfile` | The web server in front of the built frontend: password gate + reverse-proxy to the API |
| `.env.example` | Template for local settings/secrets (copy to `.env`) |
| `ingest/` | A separate service (own Dockerfile inside that folder) — deploy it independently, it is not part of `docker-compose.yml` |

> **Known gap, needs a decision before relying on `docker-compose.yml`:**
> `Caddyfile` here is written for a **split-service** deployment (each piece
> as its own independently-hosted service, e.g. Railway/Render) — it expects
> `$PORT` and `$API_ORIGIN` and does not perform its own TLS (`auto_https
> off`). `docker-compose.yml` and `.env.example`, by contrast, are still
> written for the older **single-server** style (one Caddy instance doing its
> own ACME TLS from a `DOMAIN`, all three containers on one Docker network).
> These two no longer agree — `docker compose up -d --build` as this repo
> stands today would hand `frontend.Dockerfile`'s Caddy a `Caddyfile` it can't
> satisfy (no `$PORT`/`$API_ORIGIN` provided, `$DOMAIN` never read). This
> matches how `demo/` actually evolved (from a single-VPS deploy to Railway's
> split-service model) without the compose file being updated to match. Fix
> before trusting local `docker compose` smoke-tests, or deploy split-service
> (below) and treat `docker-compose.yml` as legacy until then.

## How it fits together (split-service deployment, e.g. Railway)

```
  browser
        │  https://your-app-domain   (password prompt)
        ▼
   ┌──────────┐
   │ frontend  │  Caddy: password + serves the built React app
   │ (Caddy)   │   ├── /            → the dashboard
   └────┬─────┘    └── /api, /health → backend, via $API_ORIGIN
        │
   ┌────┴────┐
   │ backend  │  FastAPI (read-only)   ── private, no public port
   └────┬────┘
        │
   ┌────┴────┐         ┌──────────┐
   │    db    │◄────────┤  ingest   │  Flexy push receiver + Netbiter poller
   └─────────┘         └──────────┘   (its own service, own public URL)
```

Only `frontend` (and `ingest`, since real vehicles push to it over the
internet) need public URLs. `backend` and `db` stay private, reachable only
by the platform's internal network.

## Deploying (Railway or similar split-service platform)

1. **Database** — provision a PostgreSQL/TimescaleDB instance. Run
   `backend/revive/schema.sql` against it once.
2. **backend service** — build from `backend.Dockerfile`. Set `DATABASE_URL`
   pointing at the database, and `CUSTOMER_ID` (or `VISIBLE_VEHICLES`) per
   deployment — see CLAUDE.md non-negotiable #4. No public URL needed.
3. **ingest service(s)** — build from `ingest/Dockerfile`. Needs its own
   public URL (real vehicles push to it directly) and `INGEST_TOKEN`. See
   [ingest/README.md](ingest/README.md).
4. **frontend service** — build from `frontend.Dockerfile`. Set
   `BASIC_AUTH_USER`/`BASIC_AUTH_HASH` (see below) and `API_ORIGIN` to the
   `backend` service's **internal** hostname (check that service's own
   networking settings — don't assume it matches the display name).
5. **Generate the Basic Auth hash**:
   ```bash
   python -c "import bcrypt; print(bcrypt.hashpw(b'your-strong-password', bcrypt.gensalt(12)).decode().replace('$','$$'))"
   ```
   The `$` → `$$` doubling is required wherever the platform's variable system
   treats a single `$` specially (Railway does).
6. **Open it**: visit the frontend's public URL, enter the login from step 5.

## Local dev (no deployment)

**Against a real Railway database (recommended — no local Postgres needed):**
```powershell
.\dev-start-railway.ps1
```
First run creates `.env.railway` and asks you to fill in
`RAILWAY_DATABASE_URL` (Railway dashboard → the Postgres service → Connect →
the public connection string), then re-run. It sets up the backend venv and
frontend `node_modules` if they don't exist yet, then launches both against
that database — read-only, so this carries no write risk. The vehicle
dropdown starts empty until you set `$env:VISIBLE_VEHICLES` or
`$env:CUSTOMER_ID` (the script prints the exact syntax) — the API fails
closed with neither set, per CLAUDE.md non-negotiable #4.

**Against a local Postgres instead:**
```bash
# backend, from backend/ with a venv active and requirements installed:
uvicorn revive.api:app --reload
# frontend, from frontend/:
npm install && npm run dev
```

Frontend opens on http://localhost:5173, proxies `/api` to the backend on
`127.0.0.1:8000` (see `frontend/vite.config.js`). Use `127.0.0.1`, not
`localhost`, per CLAUDE.md's Windows-networking note.

Ingest a real file for local testing: drop it into `backend/incoming/`
(gitignored, create it locally) and run `python -m revive.ingest` from
`backend/`. Successful files move to `backend/processed/`; re-running never
duplicates data.

## Security notes (why it's built this way)

- **HTTPS + password are mandatory**, not optional — the map is personal
  location data.
- **The database is never exposed.** No public port; only `backend` and
  `ingest` can reach it. Still set a strong password.
- **`.env` holds secrets** — never commit it.
