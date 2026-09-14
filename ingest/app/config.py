"""Minimal config: load the few values this service needs from the environment.

Loads the project-root .env explicitly (by its real path) so it works no
matter which folder you run a command from.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

# app/config.py -> parents[1] is demo/ingest/
PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

# Use 127.0.0.1 (not "localhost") on Windows dev — see demo/CLAUDE.md's
# "Environment gotchas" for why. connect_timeout=5 so an unreachable DB
# fails fast instead of hanging.
_pg_user = os.environ.get("POSTGRES_USER", "revive")
_pg_pass = os.environ.get("POSTGRES_PASSWORD", "changeme")
_pg_db = os.environ.get("POSTGRES_DB", "revive_ingest")
_pg_host = os.environ.get("POSTGRES_HOST", "127.0.0.1")
_pg_port = os.environ.get("POSTGRES_PORT", "5432")
_default_url = (
    f"postgresql://{_pg_user}:{_pg_pass}@{_pg_host}:{_pg_port}/{_pg_db}"
    "?connect_timeout=5"
)
# RAILWAY_DB_URL (set in .env) is a standing alternative to DATABASE_URL for
# one-off scripts (load_netbiter_catalog.py, inspect_netbiter_system.py, ...)
# that need to point at the real Railway database without setting an env var
# by hand in every shell session. DATABASE_URL still wins if it's ever set
# directly (e.g. Railway itself injects that name for a linked Postgres).
DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("RAILWAY_DB_URL") or _default_url

# Shared bearer token every unit's warrior.cfg INGEST_HDR must present
# (INGEST_HDR=Authorization=Bearer <this value>). One shared secret across
# the fleet is enough for testing; move to a per-device token lookup in
# `vehicles` later if that's ever needed.
INGEST_TOKEN = os.environ.get("INGEST_TOKEN", "")

# GPS comes from a separate Netbiter-connected device, not the Flexy 205 —
# see app/poll_netbiter.py and README.md's Netbiter GPS section.
NETBITER_ACCESS_KEY = os.environ.get("NETBITER_ACCESS_KEY", "")
NETBITER_BASE_URL = os.environ.get(
    "NETBITER_BASE_URL", "https://api.netbiter.net/operation/v1/rest/json"
)
# The STANDARD poll interval - used while a vehicle is stationary (engine on
# or state unknown; a confirmed-off vehicle isn't polled at all). While
# actually moving, poll_netbiter.py switches to a faster, rate-limit-aware
# interval instead - see its module docstring for the full movement-aware
# design (Joe, 2026-09-11). 5 minutes is comfortably inside Netbiter's
# per-system hourly token bucket (apidocs.netbiter.net's bucket-info page)
# even on the smallest account tier.
NETBITER_POLL_INTERVAL_SECONDS = int(os.environ.get("NETBITER_POLL_INTERVAL_SECONDS", "300"))
