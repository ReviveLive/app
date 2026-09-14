-- Live-ingest schema. Self-contained on purpose (no dependency on
-- demo/backend/revive/schema.sql) so this service can point at a totally
-- fresh database and run standalone, in or out of this repo.
-- Safe to run more than once (IF NOT EXISTS everywhere).

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Same shape as the sales-demo's vehicles table. Identity here comes from
-- the device's `NM` (warrior.cfg), not a spreadsheet Info sheet.
CREATE TABLE IF NOT EXISTS vehicles (
    vehicle_id  TEXT PRIMARY KEY,      -- the device's NM, e.g. 'Warrior-91'
    name        TEXT,
    timezone    TEXT,
    source      TEXT NOT NULL DEFAULT 'live',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Same shape/PK as the sales-demo's readings table — this is what makes a
-- re-sent or overlapping push harmless (see revive-live-demo's non-negotiable
-- #2). Long/narrow: one row per parameter reading.
CREATE TABLE IF NOT EXISTS readings (
    vehicle_id  TEXT        NOT NULL REFERENCES vehicles(vehicle_id),
    ts          TIMESTAMPTZ NOT NULL,
    parameter   TEXT        NOT NULL,
    value       DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (vehicle_id, ts, parameter)
);
SELECT create_hypertable('readings', 'ts', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS readings_vehicle_param_ts_idx
    ON readings (vehicle_id, parameter, ts DESC);

-- Every raw push body, kept regardless of whether it parsed cleanly. The
-- combined multi-tag wire format was never confirmed from a real capture —
-- this table is how that gets confirmed the moment a real device pushes,
-- and is the safety net if the best-effort parser in app/parser.py misreads
-- something. Never deleted automatically; prune manually once trusted.
CREATE TABLE IF NOT EXISTS raw_pushes (
    id           BIGSERIAL PRIMARY KEY,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    endpoint     TEXT NOT NULL,   -- 'ingest' or 'tagmap'
    device       TEXT,            -- the ?device= query param, if present
    rows_written INTEGER,          -- readings successfully parsed+written (ingest only)
    rows_skipped INTEGER,          -- lines seen but not attributable to a tag (ingest only)
    body         TEXT NOT NULL     -- the raw POST body, verbatim
);
CREATE INDEX IF NOT EXISTS raw_pushes_received_at_idx ON raw_pushes (received_at DESC);

-- Numeric TagId -> parameter name, per vehicle. The eWON's historical-log
-- export (/ingest) references tags by number only, to keep the repeated
-- push small; the full name catalog arrives separately via /tagmap (the
-- eWON's own tag-config export) and is upserted here so /ingest can resolve
-- each TagId to the name /api reads (e.g. 47 -> 'pto_on_revlive'). Confirmed
-- from a real push 2026-09-04 - see raw_pushes for the actual wire format.
CREATE TABLE IF NOT EXISTS tag_map (
    vehicle_id  TEXT        NOT NULL REFERENCES vehicles(vehicle_id),
    tag_id      INTEGER     NOT NULL,
    name        TEXT        NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vehicle_id, tag_id)
);

-- Raw catalog of every Netbiter system on the account (from Netbiter's own
-- `GET /system` — see app/load_netbiter_catalog.py). Reference/lookup only:
-- Netbiter's `name` here ("20160054", "Danish Flexline 08-1-040", ...) does
-- NOT reliably match a Flexy's NM/vehicle_id (e.g. "Cityflex-10-0-071") —
-- the two are independently maintained naming schemes, so this table exists
-- to make matching easier by eye/query, not to auto-derive the mapping below.
CREATE TABLE IF NOT EXISTS netbiter_systems_catalog (
    netbiter_system_id TEXT PRIMARY KEY,
    name         TEXT,
    project_name TEXT,
    activated    BOOLEAN,
    timezone     TEXT,
    loaded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The actual, human-confirmed mapping app/poll_netbiter.py polls from. One
-- row per vehicle you've verified corresponds to a given Netbiter system —
-- see README.md's Netbiter GPS section for how to confirm a match before
-- adding it here (getting this wrong misattributes real location data).
CREATE TABLE IF NOT EXISTS netbiter_systems (
    vehicle_id        TEXT NOT NULL REFERENCES vehicles(vehicle_id),
    netbiter_system_id TEXT NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (vehicle_id)
);
