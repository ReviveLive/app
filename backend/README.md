[![Revive Group](https://img.shields.io/badge/Revive_Group-009C43?style=flat&labelColor=ffffff&logo=data:image%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyOTYiIGhlaWdodD0iMjk3IiB2aWV3Qm94PSIwIDAgMjk2IDI5NyI%2BDQogIDwhLS0gVG9wIHNlZ21lbnQgLS0%2BDQogIDxwYXRoDQogICAgZD0iTTczIDI5DQogICAgICAgQTE0NCAxNDQgMCAwIDEgMjkxIDEyNg0KICAgICAgIEw3MyAyOSBaIg0KICAgIGZpbGw9IiMxZDFkMWQiDQogICAgc3Ryb2tlPSIjMWQxZDFkIg0KICAgIHN0cm9rZS13aWR0aD0iMC42Ig0KICAvPg0KDQogIDwhLS0gR3JlZW4gY2VudGVyIHNlZ21lbnQgLS0%2BDQogIDxwYXRoDQogICAgZD0iTTM5IDYzDQogICAgICAgQTE0NCAxNDQgMCAwIDAgMzkgMjM0DQogICAgICAgTDIzNCAxNDgNCiAgICAgICBaIg0KICAgIGZpbGw9IiMxMTlmNDMiDQogIC8%2BDQoNCiAgPCEtLSBCb3R0b20gc2VnbWVudCAtLT4NCiAgPHBhdGgNCiAgICBkPSJNNzMgMjY5DQogICAgICAgQTE0NCAxNDQgMCAwIDAgMjkxIDE1OA0KICAgICAgIEw3MyAyNjkgWiINCiAgICBmaWxsPSIjMWQxZDFkIg0KICAgIHN0cm9rZT0iIzFkMWQxZCINCiAgICBzdHJva2Utd2lkdGg9IjAuNiINCiAgLz4NCjwvc3ZnPg0K)](https://rei-limited.com/)

[![Python](https://img.shields.io/badge/Python-3.12-009C43?logo=python&logoColor=white&labelColor=1d1d1d)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Read--only-009C43?logo=fastapi&logoColor=white&labelColor=1d1d1d)](https://fastapi.tiangolo.com/)
[![Uvicorn](https://img.shields.io/badge/Uvicorn-standard-009C43?logo=gunicorn&logoColor=white&labelColor=1d1d1d)](https://www.uvicorn.dev/)
[![psycopg](https://img.shields.io/badge/psycopg-binary-009C43?labelColor=1d1d1d)](https://github.com/psycopg/psycopg/)
[![pandas](https://img.shields.io/badge/pandas-Parsing-009C43?logo=pandas&logoColor=white&labelColor=1d1d1d)](https://pandas.pydata.org/)
[![openpyxl](https://img.shields.io/badge/openpyxl-.xlsx-009C43?labelColor=1d1d1d)](https://openpyxl.readthedocs.io/)

[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![TimescaleDB](https://img.shields.io/badge/TimescaleDB-Hypertable-FDB515?logo=timescale&logoColor=black)](https://www.timescale.com/)
[![Docker](https://img.shields.io/badge/Docker-Containerised-2496ED?logo=docker&logoColor=white)](https://docker.com)

![Production](https://img.shields.io/badge/status-production-009C43?labelColor=1d1d1d)

---

# Revive Live — Backend

The `revive` Python package: an Excel/CSV parser, idempotent ingestion into
PostgreSQL/TimescaleDB, and a **thin, read-only** FastAPI API. There are no
write endpoints — the API only ever runs `SELECT`s against data another
process (this package's own `ingest.py`, or the separate `ingest/` service)
put there.

See the root [`CLAUDE.md`](../CLAUDE.md) for what this project is and its
non-negotiables, and the root [`README.md`](../README.md) for how to deploy.

## Modules

| Module | What it does |
|--------|----------------|
| `revive/parser.py` | Normalises a periodic telemetry file (`.xlsx` with an `Info` sheet, or the fuller `.csv` layout) into long-format records: `(vehicle_id, ts, parameter, value)`. Takes every value column generically, so a fuller file needs no parser change |
| `revive/ingest.py` | Writes parsed records into the database. Idempotent: the readings primary key `(vehicle_id, ts, parameter)` + `ON CONFLICT DO NOTHING` means re-ingesting a file never duplicates data |
| `revive/db.py` | One `connect()` helper |
| `revive/config.py` | Loads the project-root `.env`; builds `DATABASE_URL` from the `POSTGRES_*` vars if not set explicitly; also `CUSTOMER_ID`/`VISIBLE_VEHICLES` (which vehicles this deployment can see) and `DATA_SOURCE` (always `'live'` here — see CLAUDE.md) |
| `revive/api.py` | The read-only FastAPI app — every endpoint the frontend calls |
| `revive/schema.sql` | `vehicles`, `readings` (a TimescaleDB hypertable), and `customers` (multi-tenant vehicle visibility) |
| `revive/diagnose.py` | Read-only diagnostic: reports telemetry sampling cadence per parameter, to sanity-check "last known" freshness |
| `revive/plugins/fleet_costing/` | The fuel-costing feature as a self-contained module: a pure calculation core (`service.py`, unit-tested) plus a `create_router()` that `api.py` mounts — not a plugin engine, just an explicitly-imported, bounded feature |

## API endpoints

All `GET`, all read-only. Every data endpoint takes an optional
`?vehicle=<id>`; when omitted, the oldest-visible vehicle is used.
`_visible_vehicle_ids()` in `api.py` scopes every one of these to the
vehicles the current deployment's `CUSTOMER_ID`/`VISIBLE_VEHICLES` can see —
with neither set, a deployment sees nothing (fails closed).

| Endpoint | What it returns |
|----------|------------------|
| `/health` | Liveness check |
| `/api/vehicles` | Every vehicle visible to this deployment (drives the header switcher) |
| `/api/vehicle` | One vehicle's identity |
| `/api/customer` | The current deployment's customer (name/region, for the sidebar tag) |
| `/api/last-known` | Newest value + timestamp for every parameter |
| `/api/usage` | Daily/weekly usage of a cumulative run-minute counter (delta of the counter) |
| `/api/pto-working` | PTO-on-and-working time breakdown |
| `/api/pto-timeline` | Timeline of PTO/pump state through a day |
| `/api/cycle-counts` | Piston/cassette/rear-cover cycle counts |
| `/api/route` | One day's GPS track + the list of days that have GPS |
| `/api/truck-stops` | Detected stop locations |
| `/api/work-locations` | Detected working locations |
| `/api/pump-activations` | Pump on/off activation log |
| `/api/fuel-day` | One day's fuel figures |
| `/api/activity-day` | One day's activity/status breakdown |
| `/api/alerts` | Fault/emergency-stop events, newest first |
| `/api/rpm` | Daily/weekly/monthly average engine RPM, overall and while PTO active |
| `/api/trend` | Daily/weekly/monthly trend for one allowlisted metric |
| `/api/sustainability` | Energy/water-saving summary figures over the window — see [sustainability.md](sustainability.md) for exactly what's real vs. calculated |
| `/api/costing` | Fuel-costing figures over a period (`fleet_costing` plugin) |

## Running it locally

```bash
python -m venv venv
venv\Scripts\Activate.ps1   # Windows PowerShell
# or: source venv/bin/activate   # Linux / macOS

pip install -r requirements.txt
uvicorn revive.api:app --reload
```

Serves on **http://127.0.0.1:8000**. Use `127.0.0.1`, not `localhost` — see
the Windows-networking note in the root `CLAUDE.md`. It expects PostgreSQL
reachable at the `DATABASE_URL` built from `.env`'s `POSTGRES_*` values (or
`.env`'s `DATABASE_URL` directly).

## Loading data

There is no sample-data generator here — only real telemetry:

```bash
cp /path/to/your-file.xlsx ./incoming/    # create incoming/ locally, gitignored
python -m revive.ingest
```

Successful files move to `processed/`; re-running never duplicates data (the
`readings` primary key guarantees it).

## Tests

```bash
pytest
```

`tests/test_parser.py` covers the parser against `tests/fixtures/sample_wide.csv`.
`revive/plugins/fleet_costing/tests/test_service.py` covers the costing
calculation core in isolation (it imports nothing from FastAPI or the DB).

## Structure

```
backend/
├── revive/
│   ├── api.py                  - the read-only FastAPI app
│   ├── parser.py               - file -> long-format records
│   ├── ingest.py               - records -> database (idempotent)
│   ├── db.py                   - connect()
│   ├── config.py               - env/.env loading
│   ├── schema.sql              - vehicles + readings (hypertable) + customers
│   ├── diagnose.py             - read-only cadence diagnostic
│   └── plugins/fleet_costing/  - bounded feature: service + router + tests
├── tests/                      - parser tests + fixtures
└── requirements.txt
```

## Notes

- No write endpoints, no sample data, no synthetic fleet — see CLAUDE.md's
  non-negotiables before adding anything that fabricates a figure.
- Never expose this API or the database directly to the internet — in the
  deployed stack, Caddy (the `frontend` service) is the only public-facing
  piece.
- Take a fresh manual database backup before any schema change, in addition
  to whatever automatic backup schedule the hosting platform provides.
