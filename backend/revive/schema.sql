-- Step 3 — Schema. Single tenant. Two tables, nothing more.
-- Safe to run more than once (IF NOT EXISTS everywhere).

-- TimescaleDB extension (the image ships with it; this just switches it on).
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- One row per truck. Identity comes from the file's Info sheet.
CREATE TABLE IF NOT EXISTS vehicles (
    vehicle_id  TEXT PRIMARY KEY,      -- e.g. '003011FD7C6A'
    name        TEXT,                  -- e.g. 'Warrior No.66'
    timezone    TEXT,                  -- e.g. 'Europe/Dublin'
    source      TEXT NOT NULL DEFAULT 'live', -- 'live' (real telemetry) — see DATA_SOURCE in config.py
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Re-running this file against a DB created before `source` existed.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'live';

-- One row per individual measurement (the parser's long format).
CREATE TABLE IF NOT EXISTS readings (
    vehicle_id  TEXT        NOT NULL REFERENCES vehicles(vehicle_id),
    ts          TIMESTAMPTZ NOT NULL,  -- stored in UTC
    parameter   TEXT        NOT NULL,  -- e.g. 'Water Level Volume (m3)'
    value       DOUBLE PRECISION NOT NULL,
    -- Same vehicle + time + parameter can only exist once. This single line
    -- is what makes re-ingesting the same file harmless (step 4 relies on it).
    PRIMARY KEY (vehicle_id, ts, parameter)
);

-- Turn `readings` into a TimescaleDB hypertable (optimised for time-series).
SELECT create_hypertable('readings', 'ts', if_not_exists => TRUE);

-- Helps the dashboard's "last known value per parameter" lookups.
CREATE INDEX IF NOT EXISTS readings_vehicle_param_ts_idx
    ON readings (vehicle_id, parameter, ts DESC);

-- Customers — added ahead of onboarding a second customer (2026-09-12).
-- config.py's CUSTOMER_ID env var (per deployment) now drives which
-- vehicles are visible - api.py's _visible_vehicle_ids resolves it to
-- `SELECT vehicle_id FROM vehicles WHERE customer_id = %s`, so onboarding a
-- vehicle for an existing customer is a database UPDATE, not a redeploy.
-- VISIBLE_VEHICLES (a static id list) is kept only as a legacy fallback.
-- With NEITHER configured, this deployment shows no vehicles at all - fails
-- closed, never open (Joe, 2026-09-12). Each customer still gets their own
-- deployed instance for now - this is not shared-instance multi-tenancy,
-- which needs real per-user auth first (deliberately deferred; see
-- CLAUDE.md's branch note for the Keycloak-vs-per-deployment discussion).
CREATE TABLE IF NOT EXISTS customers (
    customer_id TEXT PRIMARY KEY,      -- short slug, e.g. 'veolia'
    name        TEXT NOT NULL,         -- display name, e.g. 'Veolia' - sourced by /api/customer for the sidebar tag
    region      TEXT,                  -- free-text location, e.g. 'Ireland' - display only, nothing queries on it yet
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Re-running this file against a customers table created before `region` existed.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS region TEXT;

-- Nullable: a vehicle with no customer_id simply isn't visible from any
-- CUSTOMER_ID-scoped deployment (fails closed, per the note above) - it
-- still shows up fine from a deployment using the legacy VISIBLE_VEHICLES
-- list instead, or with neither set (e.g. local dev against a fresh demo
-- DB, once that's configured with its own CUSTOMER_ID too). A single FK
-- column, not a link table - a vehicle here is one physical truck, never
-- shared between customers, so there's no many-to-many case to model.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS customer_id TEXT REFERENCES customers(customer_id);
CREATE INDEX IF NOT EXISTS vehicles_customer_id_idx ON vehicles (customer_id);

-- Applied 2026-09-12 (Railway `timescaledb`, manual backup taken first):
-- customers 'veolia'/'simulator' inserted; Warrior-No.75-Veolia -> 'veolia',
-- Warrior-75-Demo (a WarriorSimulator test fixture, not a real customer's
-- vehicle - so 'simulator', not a generic 'internal') -> 'simulator', its
-- also-unset timezone fixed to Europe/Dublin. Cityflex-10-0-071 left
-- unassigned - its owning customer is still unconfirmed - but its missing
-- timezone was fixed to Europe/Stockholm (Sweden-based per eCatcher;
-- unrelated one-off data fix, not part of the customers work). This is a
-- richer customers table (location, etc.) - deliberately deferred (Joe,
-- 2026-09-12) until actually needed - not a priority right now. One-time
-- data fixes, not reproduced here - this file stays schema-only.
