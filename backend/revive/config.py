"""Minimal config: load the few values the pilot needs from the environment.

Loads the project-root .env explicitly (by its real path) so it works no
matter which folder you run a command from.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

# backend/revive/config.py -> parents[2] is the project root (revive-live-pilot/)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")

# Build the default URL from the POSTGRES_* vars so local dev and Docker both
# work without needing a separate DATABASE_URL entry in .env.
# Use 127.0.0.1 (not "localhost"): on Windows "localhost" can try IPv6 first
# and stall for a long time before falling back. 127.0.0.1 connects straight away.
# connect_timeout=5 means a genuinely unreachable DB fails in seconds, never hangs.
_pg_user = os.environ.get("POSTGRES_USER", "revive")
_pg_pass = os.environ.get("POSTGRES_PASSWORD", "changeme")
_pg_db   = os.environ.get("POSTGRES_DB",   "revive_pilot")
# Host-side port for the native (non-Docker) API to reach the db container -
# see docker-compose.override.yml's "127.0.0.1:5433:5432" mapping. Inside
# Docker (backend.Dockerfile's own DATABASE_URL) this is irrelevant since
# that path never falls through to this default.
_pg_port = os.environ.get("POSTGRES_PORT", "5432")
_default_url = f"postgresql://{_pg_user}:{_pg_pass}@127.0.0.1:{_pg_port}/{_pg_db}?connect_timeout=5"
DATABASE_URL = os.environ.get("DATABASE_URL", _default_url)
# Tags every vehicle ingested by this instance in the `vehicles.source`
# column. app/ only ever ingests real telemetry, so this always defaults to
# 'live' - there is no synthetic/demo fleet here to distinguish it from.
DATA_SOURCE = os.environ.get("DATA_SOURCE", "live")

# Which customer this deployment serves, e.g. "veolia" - a row in the
# `customers` table (see schema.sql). Preferred over VISIBLE_VEHICLES below:
# the set of visible vehicles becomes a DB lookup (vehicles.customer_id = %s)
# instead of a hand-maintained id list, so onboarding a vehicle for an
# existing customer is a database UPDATE, not a redeploy. See api.py's
# _visible_vehicle_ids for how this and VISIBLE_VEHICLES combine.
CUSTOMER_ID = os.environ.get("CUSTOMER_ID", "").strip()

# Legacy comma-separated allow-list of vehicle_ids this deployment may ever
# show, e.g. "Warrior-No.75-Veolia" - superseded by CUSTOMER_ID above but
# still honoured if that's unset. IMPORTANT (Joe, 2026-09-12): unlike before,
# leaving BOTH of these unset does NOT mean unrestricted/show-everything
# anymore - a customer-facing deployment must fail closed, never open, so
# with neither configured this deployment shows no vehicles at all. See
# api.py's _visible_vehicle_ids, which is what every vehicle-listing
# endpoint actually calls now.
VISIBLE_VEHICLES = [
    v.strip() for v in os.environ.get("VISIBLE_VEHICLES", "").split(",") if v.strip()
]


INCOMING_DIR = os.environ.get("INCOMING_DIR", str(PROJECT_ROOT / "incoming"))
# After a file ingests successfully it is moved here, into a per-vehicle subfolder.
PROCESSED_DIR = os.environ.get("PROCESSED_DIR", str(PROJECT_ROOT / "processed"))
