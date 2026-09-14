"""Single database connection helper. One database for the whole pilot.

Pooled (2026-09-12): every request used to open a brand-new TCP+TLS+auth
connection to Postgres and throw it away at the end - fine against a
localhost DB, but each one costs roughly 1-1.5s round-tripping to a remote/
hosted database, which dominated every request's latency regardless of
query complexity (confirmed: even a trivial single-row lookup took ~1.5s,
same as a multi-join query). A small pool of already-established
connections is reused across requests instead - callers are unaffected,
`with connect() as conn, conn.cursor() as cur:` still works exactly as
before everywhere it's used (api.py, ingest.py, diagnose.py, the
fleet_costing plugin).
"""
from psycopg_pool import ConnectionPool

from .config import DATABASE_URL

# min_size=4: matches a single page's typical concurrent fan-out (e.g. the
# Fleet page fires 4 requests per vehicle) - confirmed 2026-09-12 that a
# "cold" pool still pays full connection-setup cost for the 2nd/3rd/4th
# connection the first time a burst like that arrives, so pre-warming this
# many at startup keeps even the very first load fast, not just later ones.
# max_size=10: comfortably covers a couple of vehicles' worth of concurrent
# requests without over-provisioning against Postgres's own connection
# limit. open=True establishes min_size connections immediately at import
# time (app startup) instead of lazily on the first request.
_pool = ConnectionPool(DATABASE_URL, min_size=4, max_size=10, open=True)


def connect():
    """Borrow a pooled connection - used exactly like the old
    psycopg.connect() return value."""
    return _pool.connection()
