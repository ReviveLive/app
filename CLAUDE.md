# CLAUDE.md — Revive Live (Production)

Read this before doing anything. It defines what this project is, how to run and
deploy it, and the lines it must not cross. This is a **standalone** doc — it
does not rely on any other CLAUDE.md, including `demo/`'s.

## What this is

**The production Revive Live platform.** A password-protected (for now — see
"Auth" below) `https://` dashboard showing real vehicle telemetry to real
paying customers. Every number on it is either a genuine reading or a genuine
calculation derived from one. There is no sample fleet, no simulated data, and
no illustrative/mocked figures anywhere in this codebase.

This repo was forked from `C:\ReviveLive\demo`'s codebase (translation branch,
commit `45963ab`, 2026-09-14) — that repo is the sales-demo pitch tool and the
Veolia trial pilot; this one picks up from its current feature set as the
permanent, multi-tenant, multi-customer platform. `demo/` keeps evolving the
trial independently; changes here don't flow back there and vice versa unless
someone deliberately ports them.

The UI is a flat, sidebar-navigated SaaS platform. The pages (see
`frontend/src/App.jsx`'s `NAV` and `frontend/src/pages/*Page.jsx`) are:

- **Overview** — one vehicle: last-known location + route history on the map,
  tank levels, Current Status (Live/Offline, Travelling/Idle/Working), and
  pump-usage/weather panels.
- **Fleet** — every vehicle visible to the logged-in deployment/customer at a
  glance; selecting one jumps to Overview.
- **Trends**, **Sustainability**, **Health** (machine health), **Alerts**,
  **Costing** (fuel costing), **Pumps**, **Routes** — the analytical/reporting
  pages.

Cross-cutting: a printable PDF report, dark mode, multi-vehicle switching, and
full i18n (`react-i18next`) — English, French, Irish, Danish, Swedish, and
German are live in the language switcher today.

## How to orient yourself first

Before proposing changes, read: this file, [README.md](README.md) (the deploy
guide), `backend/revive/*.py`, `backend/revive/schema.sql`, `ingest/README.md`,
and `frontend/src/**`. Then summarise the project back to the owner to confirm
you understand it.

## Repository layout

Flat: everything lives at the repo root.

```
.
├── backend/                  the revive Python package (read-only API + file ingestion)
├── ingest/                   independent service: Flexy HTTP push receiver + Netbiter GPS poller
├── frontend/                 the React (Vite) app
├── docker-compose.yml        runs db + api + web (Caddy)
├── backend.Dockerfile        (+ .dockerignore)
├── frontend.Dockerfile       (+ .dockerignore)
├── Caddyfile                 TLS + password + routing
├── .env.example              copy to .env (gitignored) and fill in
├── README.md                 step-by-step deploy guide
└── CLAUDE.md                 this file
```

`ingest/` is deployed as its own Railway service(s), independent of `backend/`
— it receives the Flexy 205's direct HTTP push (`program.bas`'s `DoSync`) and
separately polls Netbiter's cloud API for GPS on vehicles whose location comes
from a Netbiter-connected unit rather than the Flexy. See
[ingest/README.md](ingest/README.md).

## Stack

- `backend/` — one Python package (`revive`): Excel/CSV parser, idempotent
  ingestion, and a **thin, read-only** FastAPI API.
- `ingest/` — a second FastAPI service: the Flexy push receiver (`/ingest`,
  `/tagmap`) and the Netbiter GPS poller, sharing the same Postgres.
- PostgreSQL + TimescaleDB.
- `frontend/` — one React app (Vite): Leaflet map, Recharts charts, SVG gauges,
  i18next.
- **Deployment** — Docker Compose runs three services: `db`, `api`, and `web`
  (Caddy). Caddy is the only thing exposed; it provides automatic HTTPS and a
  site password, serves the built frontend, and reverse-proxies the API.
  (Railway hosts each piece as its own service in the actual live deployment —
  see [README.md](README.md).)

## How to run it

- **Local dev:** start the DB, run the API
  (`.venv\Scripts\python.exe -m uvicorn revive.api:app --reload` from
  `backend/`), and the frontend (`npm run dev` from `frontend/`, opens
  http://localhost:5173).
- **Deploy:** follow [README.md](README.md).
- **Ingest a real file:** drop it into `incoming/` (gitignored, create it
  locally) and run `python -m revive.ingest` from `backend/`. There is no
  sample-data generator here — if you don't have a real file, there's nothing
  to ingest.

## NON-NEGOTIABLES

1. **Location data is personal data.** Any instance reachable by anyone other
   than you MUST be behind **authentication AND TLS**. Caddy enforces both on
   every request today (Basic Auth); the database has **no public port** and
   must never get one. This does not bend, and does not weaken once real
   per-user auth (Keycloak) replaces Basic Auth — see "Auth" below.
2. **Idempotent ingestion.** The readings primary key
   `(vehicle_id, ts, parameter)` plus `ON CONFLICT DO NOTHING` guarantees a
   re-sent file or push can't duplicate or corrupt data. Keep it, everywhere
   telemetry is written (`backend/revive/ingest.py` and `ingest/app/main.py`
   both rely on it).
3. **Never show a fabricated number.** If there's no real datapoint, and no
   valid calculation derived from one, show a genuine empty/no-data state —
   never a placeholder value, labelled or not. There is no "sample data"
   escape hatch here; that only ever applied to `demo/`.
4. **Customer data isolation is enforced server-side.** One customer must
   never see another's vehicles. Today that's the `customers`/`customer_id`
   model — `config.py`'s `CUSTOMER_ID` env var per deployment resolves to
   `_visible_vehicle_ids()` in `api.py`, and with neither `CUSTOMER_ID` nor
   `VISIBLE_VEHICLES` set, a deployment shows **no vehicles at all** (fails
   closed, never open). When Keycloak lands, the same enforcement point moves
   server-side from an env var to a JWT claim — the frontend hiding a panel is
   never the security boundary, only the backend refusing the query is.
5. **Secrets never get committed.** `.env` holds passwords and DB credentials;
   it must be gitignored, along with `incoming/`, `processed/`, `pgdata/`,
   `node_modules/`, `.venv/`, and `__pycache__/`.

## Auth — current state and where it's going

Basic Auth (Caddy, one shared username/password per deployment) is the
stopgap in place today — the same pattern `demo/`'s Veolia trial used. It does
not scale past "one login shared by everyone at one customer." Real per-user,
per-role login (Keycloak) is this repo's job, not `demo/`'s. When it lands:

- **Data isolation** (which vehicles/customers a user can see) stays enforced
  server-side, driven by a JWT claim instead of the `CUSTOMER_ID` env var —
  same `_visible_vehicle_ids()` mechanism, different source of truth.
- **Feature/panel visibility** (which UI sections a role sees) is a UX
  concern, fine to do client-side based on realm/client roles decoded from the
  token — but the backend must independently reject an unauthorized request
  to a hidden endpoint regardless of what the frontend chose to render.
- One dashboard, one deployment, role/claim-driven rendering — not a separate
  dashboard build per role or per customer. Keeping N builds in sync is a
  maintenance trap for no security benefit, since the real boundary is always
  server-side.

## Data realities (learned from the real files and the live fleet)

- Vehicle identity (System id, name, timezone) lives in the spreadsheet's
  `Info` sheet, NOT in the data rows, for file-based ingestion. The parser
  reads it from there and stamps it on. Flexy pushes and Netbiter polls carry
  identity differently — see `ingest/README.md`.
- Data is sparse / event-style: most cells/pushes are empty; only actual
  readings are stored. "Last known" = the newest timestamp present, not the
  filename or push-receipt date.
- Pump on/off states (`Vac Pump Run`, etc.) are 0/1. Run-minute columns are
  cumulative lifetime counters; **daily/weekly usage = the delta of those
  counters**.
- GPS does not always come from the same source as the rest of a vehicle's
  telemetry: some vehicles' GPS is on a separate Netbiter-connected unit,
  polled independently from the Flexy-pushed parameters. See
  `ingest/netbiter-gps.md`.
- The parser takes new columns generically — a fuller telemetry file needs no
  parser change.
- Multiple vehicles and multiple customers are both supported today: a
  top-bar dropdown (and the Fleet page) switch between every vehicle visible
  to the current deployment; `customers`/`customer_id` scopes which vehicles
  that is.

## Environment gotchas (Windows dev)

- Use `127.0.0.1`, never `localhost`, in the local DB URL — on Windows
  `localhost` can take an IPv6 detour and stall for minutes.
- Keep the working copy OUT of OneDrive-synced folders — syncing
  `node_modules` makes the dev server crawl.

## Audience note

The owner has a Spring Boot/Java engineering background and is comfortable
with software development generally, but is newer to FastAPI/Python and this
project's specific stack — anchor explanations in Java/Spring equivalents
where that helps (e.g. a Spring `@PreAuthorize` on a controller is the
equivalent of a FastAPI dependency enforcing auth on a route). Confirm before
moving on for anything that deploys, exposes data, or is hard to reverse.
