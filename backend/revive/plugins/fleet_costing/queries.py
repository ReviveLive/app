"""Fleet fuel-costing: the SQL layer. Read-only, parameterized, range-scoped.

Each function takes a live cursor and returns plain Python rows for the pure core
in service.py to work on. The SQL mirrors the patterns already proven in api.py:
  - the delta-of-a-cumulative-counter shape (min/max per bucket) from /api/usage
    and /api/sustainability, except we return cmin/cmax and let service.py do the
    reset-aware delta rather than flooring it at zero in SQL.
  - the last-known-state LEFT JOIN LATERAL (... ts <= r.ts ORDER BY ts DESC
    LIMIT 1) from /api/sustainability and /api/rpm, to tag each fuel-rate sample
    working vs off-task.

The one thing that is new here versus the rest of the API: a date-range filter
(start/end, inclusive, in the vehicle's local time), so the Costing tab can scope
to a chosen period. As everywhere in this API, only server-defined parameter
constants ever reach the query; nothing free-form from the client does.
"""
from __future__ import annotations

from ...config import CUSTOMER_ID, VISIBLE_VEHICLES

# Server-side parameter allowlist. Each is a [demo-fleet name, real trial
# vehicle name] pair (widened 2026-09-12, mirroring api.py's FUEL_RATE_NAMES/
# TOTAL_FUEL_NAMES/PTO_NAMES/PTO_MINUTES_NAMES/VAC_NAMES) - a given vehicle
# only ever reports under one of the two, so matching either is unambiguous.
# Duplicated rather than imported from api.py to avoid a circular import
# (api.py imports this package), same as _visible_ids below.
FUEL_RATE_NAMES = ["Fuel Rate (l/h)", "scania_fuelrate_revlive"]  # instantaneous burn, l/h
TOTAL_FUEL_NAMES = ["Total Fuel Used (l)", "scania_total_fuel_used_revlive"]  # cumulative counter, litres
PTO_MINUTES_NAMES = ["PTO Run Minute (min)", "pto_active_minutes_revlive"]  # cumulative counter
PTO_NAMES = ["PTO Active", "pto_on_revlive"]  # 0/1 working signal
VAC_NAMES = ["Vac Pump Run", "vac_pump_on_revlive"]  # 0/1 always-present pump-on signal


def _visible_ids(cur):
    """Same resolution as api.py's _visible_vehicle_ids: None = unrestricted
    (every ingested vehicle - the local dev default, no config needed), a
    list = scoped to that customer/allow-list (possibly empty - e.g. a
    customer with zero vehicles assigned). Duplicated rather than imported
    to avoid a circular import (api.py imports this package)."""
    if CUSTOMER_ID:
        cur.execute("SELECT vehicle_id FROM vehicles WHERE customer_id = %s", (CUSTOMER_ID,))
        return [r[0] for r in cur.fetchall()]
    if VISIBLE_VEHICLES:
        return list(VISIBLE_VEHICLES)
    return None


def resolve_vehicles(cur, ids=None):
    """Identity (vehicle_id, name, timezone) for the requested trucks, oldest
    first. With no ids, returns every vehicle visible to this deployment
    (see _visible_ids). Ids that do not exist, or aren't visible on this
    deployment, are simply absent from the result; the caller decides how to
    handle an empty list. Mirrors _resolve_vehicle in api.py, kept here to
    avoid importing from api.py (which imports this package)."""
    visible = _visible_ids(cur)  # None = unrestricted, list = scoped (maybe empty)
    if ids is not None:
        ids = [i for i in ids if visible is None or i in visible]
    else:
        ids = None if visible is None else visible

    if ids is None:
        cur.execute("SELECT vehicle_id, name, timezone FROM vehicles ORDER BY created_at")
    else:
        cur.execute(
            """
            SELECT vehicle_id, name, timezone FROM vehicles
            WHERE vehicle_id = ANY(%s) ORDER BY created_at
            """,
            (ids,),
        )
    return [{"vehicle_id": r[0], "name": r[1], "timezone": r[2]}
            for r in cur.fetchall()]


def fuel_date_range(cur, vehicle_id, tz):
    """The first and last local calendar day this truck has any fuel data, as
    ISO date strings (or (None, None) if it has none). The Costing tab uses this
    to default its period to the truck's full fuel history when the client does
    not pass an explicit start/end."""
    cur.execute(
        """
        SELECT min((ts AT TIME ZONE %s)::date), max((ts AT TIME ZONE %s)::date)
        FROM readings
        WHERE vehicle_id = %s AND parameter = ANY(%s)
        """,
        (tz, tz, vehicle_id, FUEL_RATE_NAMES + TOTAL_FUEL_NAMES),
    )
    lo, hi = cur.fetchone()
    return (lo.isoformat() if lo else None, hi.isoformat() if hi else None)


def has_fuel_data(cur, vehicle_id):
    """Real capability check: does this truck carry a Fuel Rate channel at all
    (either name - see FUEL_RATE_NAMES).

    There is no per-vehicle schema table in this repo, so a channel's presence is
    emergent: it exists if any reading for it exists. This is what keeps a
    fuel-less truck showing a clear "no fuel data" state instead of a fake zero.
    """
    cur.execute(
        "SELECT EXISTS(SELECT 1 FROM readings WHERE vehicle_id = %s AND parameter = ANY(%s))",
        (vehicle_id, FUEL_RATE_NAMES),
    )
    return bool(cur.fetchone()[0])


def _counter_buckets(cur, vehicle_id, tz, start, end, params):
    """Per-day min/max of a cumulative counter within [start, end] (inclusive),
    bucketed in the vehicle's local time. service.py turns these into reset-aware
    deltas. Same CTE-free shape as the /api/usage delta source. `params` is a
    [demo name, real name] pair - a vehicle only ever reports under one."""
    cur.execute(
        """
        SELECT date_trunc('day', ts AT TIME ZONE %s) AS bucket,
               min(value) AS cmin, max(value) AS cmax
        FROM readings
        WHERE vehicle_id = %s AND parameter = ANY(%s)
          AND (ts AT TIME ZONE %s)::date >= %s::date
          AND (ts AT TIME ZONE %s)::date <= %s::date
        GROUP BY 1 ORDER BY 1
        """,
        (tz, vehicle_id, params, tz, start, tz, end),
    )
    return [{"bucket": b.date().isoformat(),
             "cmin": float(cmin), "cmax": float(cmax)}
            for b, cmin, cmax in cur.fetchall()]


def fuel_counter_buckets(cur, vehicle_id, tz, start, end):
    """Per-day Total Fuel Used counter min/max over the range. Feeds
    service.bucket_litres. Empty for a vehicle with no cumulative fuel
    counter at all (rate-only, e.g. Warrior 75) - see fuel_integrated_buckets
    below for that case."""
    return _counter_buckets(cur, vehicle_id, tz, start, end, TOTAL_FUEL_NAMES)


def pto_counter_buckets(cur, vehicle_id, tz, start, end):
    """Per-day PTO run-minute counter min/max over the range. Feeds
    service.working_hours."""
    return _counter_buckets(cur, vehicle_id, tz, start, end, PTO_MINUTES_NAMES)


def fuel_integrated_buckets(cur, vehicle_id, tz, start, end):
    """Per-day litres integrated from Fuel Rate samples (rate * dt_h, gap-capped
    at 30 min) - for a vehicle with no cumulative Total Fuel Used counter to
    take a delta of, only a rate (Warrior 75 today). Same technique as
    api.py's /api/sustainability and /api/trend fuel_used fallback. Returns
    [{"bucket", "litres"}] directly (already a per-day delta, not a raw
    counter, so there's no reset/rollover concept here - service.py's
    reset-aware _clean_deltas doesn't apply to this path)."""
    cur.execute(
        """
        WITH ordered AS (
            SELECT ts, value,
                   LEAD(ts) OVER (ORDER BY ts) AS next_ts
            FROM readings
            WHERE vehicle_id = %s AND parameter = ANY(%s)
              AND (ts AT TIME ZONE %s)::date >= %s::date
              AND (ts AT TIME ZONE %s)::date <= %s::date
        )
        SELECT date_trunc('day', ts AT TIME ZONE %s) AS bucket,
               sum(value * LEAST(
                   EXTRACT(EPOCH FROM (COALESCE(next_ts, ts + interval '10 minutes') - ts)) / 3600.0,
                   0.5
               )) AS litres
        FROM ordered
        WHERE value > 0
        GROUP BY 1 ORDER BY 1
        """,
        (vehicle_id, FUEL_RATE_NAMES, tz, start, tz, end, tz),
    )
    return [{"bucket": b.date().isoformat(), "litres": float(litres)}
            for b, litres in cur.fetchall() if litres is not None]


def fuel_rate_samples(cur, vehicle_id, tz, start, end):
    """Every fuel-rate sample in the range, each tagged working vs off-task.

    working = the last-known PTO or vacuum-pump state at that sample was engaged
    (value 1). When both states are unknown/off the sample is off-task (travel
    plus idle). Returns a list of (rate, working) pairs for
    service.split_rate_stats.

    Rewritten 2026-09-12 from a LEFT JOIN LATERAL (... parameter = ANY(2-name
    array) ... ORDER BY ts DESC LIMIT 1) - the exact pattern already found and
    fixed once in api.py's /api/sustainability: `parameter = ANY(array)`
    inside a correlated lateral makes Postgres pick a catastrophic plan (a
    single exact-match parameter = 'x' in a lateral is fine at this scale;
    a 2-element ANY() is not). Confirmed hanging (30s+) against the real
    Warrior 75 data before this rewrite, sub-second after.

    Same window-function "generation counter" technique as the sustainability
    fix: union fuel/pto/vac into one stream, a running count of each signal's
    own rows becomes a join key back to that signal's latest value as of each
    row. The CTEs are forced MATERIALIZED - without it, this exact shape (the
    final kind/value filter combined with the two joins) sent the planner
    into the same kind of bad plan the LATERAL version had, even though
    dropping any one piece (the filter, either join, or the date range) ran
    in ~200ms - confirmed by direct EXPLAIN ANALYZE testing, not assumed.
    """
    cur.execute(
        """
        WITH src AS MATERIALIZED (
            SELECT ts, value,
                   CASE WHEN parameter = ANY(%s) THEN 'fuel'
                        WHEN parameter = ANY(%s) THEN 'pto'
                        WHEN parameter = ANY(%s) THEN 'vac' END AS kind
            FROM readings
            WHERE vehicle_id = %s AND parameter = ANY(%s)
              AND (ts AT TIME ZONE %s)::date >= %s::date
              AND (ts AT TIME ZONE %s)::date <= %s::date
        ),
        grouped AS MATERIALIZED (
            SELECT ts, value, kind,
                   count(*) FILTER (WHERE kind = 'pto') OVER (ORDER BY ts) AS pto_grp,
                   count(*) FILTER (WHERE kind = 'vac') OVER (ORDER BY ts) AS vac_grp
            FROM src
        ),
        pto_vals AS MATERIALIZED (
            SELECT pto_grp AS grp, value AS pto_value FROM grouped WHERE kind = 'pto'
        ),
        vac_vals AS MATERIALIZED (
            SELECT vac_grp AS grp, value AS vac_value FROM grouped WHERE kind = 'vac'
        )
        SELECT g.value AS rate,
               (pv.pto_value = 1 OR vv.vac_value = 1) AS working
        FROM grouped g
        LEFT JOIN pto_vals pv ON pv.grp = g.pto_grp AND g.pto_grp > 0
        LEFT JOIN vac_vals vv ON vv.grp = g.vac_grp AND g.vac_grp > 0
        WHERE g.kind = 'fuel' AND g.value > 0
        """,
        (FUEL_RATE_NAMES, PTO_NAMES, VAC_NAMES, vehicle_id,
         FUEL_RATE_NAMES + PTO_NAMES + VAC_NAMES, tz, start, tz, end),
    )
    # bool(None) is False, so a sample with both states unknown counts as off-task.
    return [(float(rate), bool(working)) for rate, working in cur.fetchall()]
