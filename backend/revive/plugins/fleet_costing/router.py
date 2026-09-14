"""Fleet fuel-costing: the HTTP layer (Phase 3).

A `create_router(get_conn)` factory that api.py mounts with app.include_router.
It owns no business logic: it fetches rows with queries.py and runs them through
the pure core in service.py, then rounds for presentation at this boundary.

Design mirrors the rest of api.py deliberately:
  - one read-only GET, `connect()` opened per-request as a context manager;
  - vehicle resolved the same way (requested one, else the oldest), 404 on a bad
    id; a single vehicle per call, like every other endpoint (the header
    switcher drives which one);
  - only server-defined parameter constants ever reach SQL — the client supplies
    a vehicle id and a date range, never a channel name.

What the endpoint returns is TELEMETRY-DERIVED ONLY: litres burned, working
hours, and working-vs-off-task fuel-rate bands over the chosen period. It does
NOT compute a job quote — that depends on user-supplied price and labour rates,
so the frontend mirrors service.job_quote / service.quote_band in JavaScript and
recomputes the low-high range live as those inputs change. Keeping the money
maths client-side also keeps this endpoint currency-agnostic.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ...db import connect
from . import queries, service

# Per-day sanity ceilings for the reset-aware counter deltas (see
# service._clean_deltas). These only discard corrupt spikes; a legitimate day
# never approaches them.
#   - Fuel: even a hard-working vac/recycler tanker burns a few hundred litres a
#     day, so 2000 L/day is comfortably above real use but catches a garbled
#     reading.
#   - Run-minutes: a day has 1440 minutes; allow a little counter jitter/overlap
#     and reject anything past ~1600.
MAX_FUEL_L_PER_DAY = 2000.0
MAX_PTO_MIN_PER_DAY = 1600.0

_DATE = r"^\d{4}-\d{2}-\d{2}$"


def _round(x, n):
    """Round for presentation, passing None straight through (a truck with no
    data must never have a None turn into 0)."""
    return None if x is None else round(x, n)


def _round_stats(s):
    """Round a service.rate_stats dict for the wire, keeping None as None."""
    return {
        "avg": _round(s["avg"], 2),
        "p25": _round(s["p25"], 2),
        "p75": _round(s["p75"], 2),
        "band": [_round(s["band"][0], 2), _round(s["band"][1], 2)],
    }


def _resolve(cur, vehicle):
    """The vehicle to serve: the requested one, else the oldest. 404 on an id
    that does not exist. Reuses queries.resolve_vehicles so this package never
    imports from api.py (which imports this package)."""
    if vehicle:
        rows = queries.resolve_vehicles(cur, [vehicle])
        if not rows:
            raise HTTPException(404, f"No such vehicle: {vehicle}")
        return rows[0]
    rows = queries.resolve_vehicles(cur)
    if not rows:
        raise HTTPException(404, "No vehicle ingested yet.")
    return rows[0]


def create_router(get_conn=connect):
    """Build the costing APIRouter. `get_conn` is a callable returning a
    connection usable as a context manager (defaults to the real db.connect);
    injectable so a test can hand in a fake."""
    router = APIRouter(tags=["costing"])

    @router.get("/api/costing")
    def costing(
        vehicle: str | None = Query(None),
        start: str | None = Query(None, pattern=_DATE),
        end: str | None = Query(None, pattern=_DATE),
    ):
        """Fuel-costing figures for one vehicle over [start, end] (inclusive,
        vehicle-local). With no start/end, defaults to the truck's full fuel
        history. A truck with no fuel channel returns has_fuel_data=false and a
        clean empty state — never a fabricated zero cost.
        """
        with get_conn() as conn, conn.cursor() as cur:
            v = _resolve(cur, vehicle)
            vid = v["vehicle_id"]
            tz = v["timezone"] or "UTC"

            empty_rates = {"working": _round_stats(service.rate_stats([])),
                           "offtask": _round_stats(service.rate_stats([]))}

            if not queries.has_fuel_data(cur, vid):
                return {
                    "vehicle": v,
                    "has_fuel_data": False,
                    "range": {"start": None, "end": None},
                    "samples": 0,
                    "offtask_includes_idle": True,
                    "litres": {"litres": 0.0, "buckets": [], "rejects": []},
                    "working_hours": 0.0,
                    "rates": empty_rates,
                }

            # Default the period to the truck's whole fuel history.
            lo, hi = queries.fuel_date_range(cur, vid, tz)
            start = start or lo
            end = end or hi
            if start and end and start > end:
                raise HTTPException(400, "start must be on or before end.")

            # A vehicle with no cumulative Total Fuel Used counter (rate-only,
            # e.g. Warrior 75) falls back to integrating the Fuel Rate
            # samples instead - same technique /api/sustainability and
            # /api/trend's fuel_used already use. The integrated path is
            # already a per-day delta (not a raw counter), so it skips
            # service.bucket_litres' reset-aware handling, which doesn't
            # apply to it.
            fuel_pts = queries.fuel_counter_buckets(cur, vid, tz, start, end)
            if fuel_pts:
                litres = service.bucket_litres(fuel_pts, max_delta=MAX_FUEL_L_PER_DAY)
            else:
                integrated = queries.fuel_integrated_buckets(cur, vid, tz, start, end)
                litres = {
                    "buckets": integrated,
                    "litres": sum(b["litres"] for b in integrated),
                    "rejects": [],
                }

            pto_pts = queries.pto_counter_buckets(cur, vid, tz, start, end)
            hours = service.working_hours(pto_pts, max_delta=MAX_PTO_MIN_PER_DAY)

            samples = queries.fuel_rate_samples(cur, vid, tz, start, end)
            rates = service.split_rate_stats(samples)

        return {
            "vehicle": v,
            "has_fuel_data": True,
            "range": {"start": start, "end": end},
            "samples": len(samples),
            # Off-task is travel + idle for now; no speed signal to split them.
            "offtask_includes_idle": True,
            "litres": {
                "litres": _round(litres["litres"], 1),
                "buckets": [{"bucket": b["bucket"], "litres": _round(b["litres"], 1)}
                            for b in litres["buckets"]],
                "rejects": [{**r, "delta": _round(r["delta"], 1)}
                            for r in litres["rejects"]],
            },
            "working_hours": _round(hours, 1),
            "rates": {"working": _round_stats(rates["working"]),
                      "offtask": _round_stats(rates["offtask"])},
        }

    return router
