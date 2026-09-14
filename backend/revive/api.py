"""Step 5 (part 1) — Thin, READ-ONLY API.

Serves the dashboard. Every endpoint only reads; there are no write paths.
Multi-vehicle: several vehicles may be ingested. Every data endpoint takes an
optional ?vehicle=<id>; when it's omitted the oldest-ingested vehicle is used.

Endpoints:
  GET /health           liveness check
  GET /api/vehicles     all vehicles visible to this deployment (drives the header switcher)
  GET /api/vehicle      one vehicle's identity (?vehicle=, else the oldest)
  GET /api/customer     this deployment's own customer (sidebar branding), or null if unscoped
  GET /api/last-known   newest value + timestamp for every parameter
  GET /api/usage        daily/weekly usage of a cumulative run-minute counter
  GET /api/route        one day's GPS track + the list of days that have GPS
  GET /api/rpm          daily/weekly/monthly average engine RPM, overall and while PTO active
  GET /api/cycle-counts lifetime-to-date piston/cassette/rear-cover cycle counts (real vehicle)
  GET /api/alerts       emergency stops + overrides (real for the trial vehicle, simulated for the demo fleet), faults (real only), newest first
  GET /api/trend        daily/weekly/monthly trend for one allowlisted metric
  GET /api/sustainability  energy/water-saving summary figures over the window
  GET /api/costing      fuel-costing figures over a period (fleet_costing plugin)
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import CUSTOMER_ID, VISIBLE_VEHICLES
from .db import connect
from .plugins.fleet_costing import create_router as create_costing_router

app = FastAPI(title="Revive Live — Pilot (read-only)",
              summary="Read-only API for the Revive Live pilot",
              description=__doc__, version="0.1.0")

# Allow the local React dev server to call the API during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# Bounded feature modules mount their own routers here (see plugins/). This is
# just app.include_router, not a plugin engine — the module is imported and
# mounted explicitly, like any other part of the app.
app.include_router(create_costing_router())

# Usage charts only make sense for cumulative counters. Restrict to those.
USAGE_PARAMS = [
    "PTO Run Minute (min)",
    # PTO-on time with no pump engaged (idling). A clean either/or partition of
    # PTO time vs the pumps, so it can be summed with productive time honestly.
    "PTO Idle Run Minute (min)",
    "Vacuum Pump Run Minute (min)",
    "Jet Pump Run Minute (min)",
    "Recycle Pump Run Minute (min)",
    # The real trial vehicle's equivalent cumulative counters (confirmed
    # 2026-09-08). No real equivalent exists yet for "PTO Idle" specifically —
    # see /api/pto-working, which derives idle from the on/off state signals
    # instead of a counter that doesn't exist.
    "pto_active_minutes_revlive",
    "vacuum_pump_active_minutes_revlive",
    "jetting_active_minutes_revlive",
    "recycling_pump_active_minutes_revlive",
]


def _visible_vehicle_ids(cur) -> list[str] | None:
    """The vehicle_ids this deployment may ever show, or None for
    unrestricted (every ingested vehicle - the original, pre-2026-09-12
    default, restored 2026-09-12 for anywhere neither CUSTOMER_ID nor
    VISIBLE_VEHICLES is configured - local dev has neither by default and
    must keep working without extra setup).

    CUSTOMER_ID (a `customers` row, e.g. "veolia") is preferred and DB-driven
    - the visible set is whichever vehicles that customer currently owns, so
    onboarding one is a database UPDATE, not a redeploy - set on the actual
    Railway deployment. VISIBLE_VEHICLES (a static id list) is the legacy
    fallback, still honoured if CUSTOMER_ID isn't set. Configuring either one
    DOES fail closed on its own terms - e.g. a customer with zero vehicles
    assigned yet correctly returns an empty list, not "show everything" -
    unrestricted only applies when NEITHER is set at all."""
    if CUSTOMER_ID:
        cur.execute("SELECT vehicle_id FROM vehicles WHERE customer_id = %s", (CUSTOMER_ID,))
        return [r[0] for r in cur.fetchall()]
    if VISIBLE_VEHICLES:
        return list(VISIBLE_VEHICLES)
    return None


def _resolve_vehicle(cur, vehicle_id: str | None = None):
    """The vehicle to serve: the requested one, else the default (back-compat
    for callers that don't pass ?vehicle=) - alphabetically last by name,
    matching the switcher's own default-selection rule (see App.jsx's
    chooseVehicle/localStorage - this is only the fallback for when nothing's
    been explicitly picked, or the request bypasses the frontend entirely).
    A requested id outside this deployment's visible set is rejected exactly
    like a nonexistent one, so this deployment never reveals a vehicle by
    name - see _visible_vehicle_ids."""
    visible = _visible_vehicle_ids(cur)  # None = unrestricted, list = scoped (maybe empty)
    if vehicle_id:
        if visible is not None and vehicle_id not in visible:
            raise HTTPException(404, f"No such vehicle: {vehicle_id}")
        cur.execute(
            "SELECT vehicle_id, name, timezone, source, customer_id FROM vehicles WHERE vehicle_id = %s",
            (vehicle_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, f"No such vehicle: {vehicle_id}")
    elif visible is None:
        cur.execute(
            "SELECT vehicle_id, name, timezone, source, customer_id FROM vehicles "
            "ORDER BY name DESC LIMIT 1"
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "No vehicle ingested yet.")
    else:
        if not visible:
            raise HTTPException(404, "No vehicle configured for this deployment.")
        cur.execute(
            "SELECT vehicle_id, name, timezone, source, customer_id FROM vehicles "
            "WHERE vehicle_id = ANY(%s) ORDER BY name DESC LIMIT 1",
            (visible,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "No vehicle configured for this deployment.")
    return {"vehicle_id": row[0], "name": row[1], "timezone": row[2], "source": row[3],
            "customer_id": row[4]}


@app.get("/health")
def health():
    """Liveness check. Returns 200 OK if the API is up and running."""
    return {"status": "ok"}


@app.get("/api/vehicles")
def vehicles():
    """All visible vehicles, alphabetically DESCENDING by name (the
    switcher's own list order and its default-selection fallback - see
    App.jsx's chooseVehicle/localStorage for the "remember what was actually
    picked" behaviour this only backs up). See _visible_vehicle_ids for how
    this deployment may be scoped down - with nothing configured (the local
    dev default), every ingested vehicle is visible, unchanged from before
    CUSTOMER_ID existed.

    `last_seen` (newest reading timestamp across every parameter, per
    vehicle) lets the switcher show each vehicle's own online/offline dot -
    the same "newest reading vs now" definition App.jsx already uses for the
    currently-selected vehicle, just computed here for all of them at once.

    `customer_id` is included so an unrestricted (local/master) view can
    still group by customer client-side - e.g. the Fleet page scopes its
    comparison to whichever customer the currently-selected vehicle belongs
    to (Joe, 2026-09-12: Warrior 75 selected -> Fleet shows only Veolia's
    trucks, not every ingested vehicle), without needing its own endpoint.
    """
    with connect() as conn, conn.cursor() as cur:
        visible = _visible_vehicle_ids(cur)  # None = unrestricted, list = scoped (maybe empty)
        if visible is not None and not visible:
            return []
        query = """
            SELECT v.vehicle_id, v.name, v.timezone, v.source, v.customer_id, r.last_seen
            FROM vehicles v
            LEFT JOIN (
                SELECT vehicle_id, MAX(ts) AS last_seen FROM readings GROUP BY vehicle_id
            ) r ON r.vehicle_id = v.vehicle_id
        """
        order = " ORDER BY v.name DESC"
        if visible is None:
            cur.execute(query + order)
        else:
            cur.execute(query + " WHERE v.vehicle_id = ANY(%s)" + order, (visible,))
        return [
            {"vehicle_id": r[0], "name": r[1], "timezone": r[2], "source": r[3],
             "customer_id": r[4], "last_seen": r[5].isoformat() if r[5] else None}
            for r in cur.fetchall()
        ]


@app.get("/api/vehicle")
def vehicle(vehicle: str | None = Query(None)):
    with connect() as conn, conn.cursor() as cur:
        return _resolve_vehicle(cur, vehicle)


@app.get("/api/customer")
def customer():
    """This deployment's own customer, for the sidebar branding tag (was a
    hardcoded "Veolia" string in App.jsx until 2026-09-12 - now sourced from
    the `customers` table so it isn't wrong the moment a second customer
    exists). Returns null when this deployment isn't scoped to a specific
    customer (CUSTOMER_ID unset, e.g. the sales demo) - the frontend shows no
    tag in that case, same as before this existed."""
    if not CUSTOMER_ID:
        return None
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT customer_id, name, region FROM customers WHERE customer_id = %s",
            (CUSTOMER_ID,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return {"customer_id": row[0], "name": row[1], "region": row[2]}


@app.get("/api/last-known")
def last_known(vehicle: str | None = Query(None)):
    """Newest reading per parameter — the basis for map, tank and health."""
    with connect() as conn, conn.cursor() as cur:
        v = _resolve_vehicle(cur, vehicle)
        cur.execute(
            """
            SELECT DISTINCT ON (parameter) parameter, value, ts
            FROM readings WHERE vehicle_id = %s
            ORDER BY parameter, ts DESC
            """,
            (v["vehicle_id"],),
        )
        readings = {
            p: {"value": val, "ts": ts.isoformat()} for p, val, ts in cur.fetchall()
        }
    return {"vehicle": v, "readings": readings}


@app.get("/api/usage")
def usage(
    parameter: str = Query(..., description="A cumulative run-minute counter"),
    grain: str = Query("day", pattern="^(day|week|month)$"),
    vehicle: str | None = Query(None),
):
    """Usage per day/week/month = delta of the cumulative counter, in local time."""
    if parameter not in USAGE_PARAMS:
        raise HTTPException(
            400, f"Usage only available for: {USAGE_PARAMS}"
        )
    with connect() as conn, conn.cursor() as cur:
        v = _resolve_vehicle(cur, vehicle)
        cur.execute(
            """
            WITH b AS (
                SELECT date_trunc(%s, ts AT TIME ZONE %s) AS bucket,
                       min(value) AS cmin, max(value) AS cmax
                FROM readings
                WHERE vehicle_id = %s AND parameter = %s
                GROUP BY 1
            )
            SELECT bucket,
                   GREATEST(cmax - COALESCE(lag(cmax) OVER (ORDER BY bucket), cmin), 0)
            FROM b ORDER BY bucket
            """,
            (grain, v["timezone"] or "UTC", v["vehicle_id"], parameter),
        )
        buckets = [
            {"bucket": b.date().isoformat(), "minutes": float(u)}
            for b, u in cur.fetchall()
        ]
    return {"parameter": parameter, "grain": grain, "buckets": buckets}


@app.get("/api/pto-working")
def pto_working(
    grain: str = Query("day", pattern="^(day|week|month)$"),
    vehicle: str | None = Query(None),
):
    """Per-period PTO WORKING minutes (≥1 pump on while PTO is on), derived
    from the on/off state signals rather than a counter — there is no real
    "PTO idle" counter to swap in the way the other pump metrics can be (see
    USAGE_PARAMS). Callers get idle by subtracting this from the real PTO
    total counter's usage (pumps.js does this), floored at 0.

    Overlap-safe by construction: a stretch where multiple pumps are on at
    once still only counts once toward working, since each interval asks one
    yes/no question (is *any* pump on), never sums per-pump durations.
    """
    with connect() as conn, conn.cursor() as cur:
        v = _resolve_vehicle(cur, vehicle)
        tz = v["timezone"] or "UTC"
        cur.execute(
            """
            WITH ticks AS (
                SELECT DISTINCT ts FROM readings
                WHERE vehicle_id = %s AND parameter = ANY(%s)
            ),
            state AS (
                SELECT t.ts, pto.value AS pto, vac.value AS vac, jet.value AS jet, rec.value AS rec
                FROM ticks t
                LEFT JOIN LATERAL (
                    SELECT value FROM readings
                    WHERE vehicle_id = %s AND parameter = %s AND ts <= t.ts
                    ORDER BY ts DESC LIMIT 1
                ) pto ON true
                LEFT JOIN LATERAL (
                    SELECT value FROM readings
                    WHERE vehicle_id = %s AND parameter = %s AND ts <= t.ts
                    ORDER BY ts DESC LIMIT 1
                ) vac ON true
                LEFT JOIN LATERAL (
                    SELECT value FROM readings
                    WHERE vehicle_id = %s AND parameter = %s AND ts <= t.ts
                    ORDER BY ts DESC LIMIT 1
                ) jet ON true
                LEFT JOIN LATERAL (
                    SELECT value FROM readings
                    WHERE vehicle_id = %s AND parameter = %s AND ts <= t.ts
                    ORDER BY ts DESC LIMIT 1
                ) rec ON true
            ),
            intervals AS (
                SELECT ts, LEAD(ts) OVER (ORDER BY ts) AS next_ts, pto, vac, jet, rec
                FROM state
            )
            SELECT date_trunc(%s, ts AT TIME ZONE %s) AS bucket,
                   SUM(
                       CASE WHEN next_ts IS NOT NULL AND pto = 1 AND (vac = 1 OR jet = 1 OR rec = 1)
                            THEN EXTRACT(EPOCH FROM (next_ts - ts)) / 60.0
                            ELSE 0 END
                   ) AS working_minutes
            FROM intervals
            GROUP BY 1 ORDER BY 1
            """,
            (
                v["vehicle_id"], [PTO_ON, VAC_ON, JET_ON, REC_ON],
                v["vehicle_id"], PTO_ON,
                v["vehicle_id"], VAC_ON,
                v["vehicle_id"], JET_ON,
                v["vehicle_id"], REC_ON,
                grain, tz,
            ),
        )
        buckets = [
            {"bucket": b.date().isoformat(), "minutes": float(m or 0)}
            for b, m in cur.fetchall()
        ]
    return {"grain": grain, "buckets": buckets}


@app.get("/api/pto-timeline")
def pto_timeline(
    day: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    vehicle: str | None = Query(None),
):
    """One day's raw PTO/pump on-off state, unaggregated — the exact moments
    each signal changed, for the "Pumps" page's timeline chart. Real trial
    vehicle only; the demo fleet has no per-pump on/off channels to show this
    way (only aggregate run-minute counters)."""
    sigs = [PTO_ON, VAC_ON, JET_ON, REC_ON]
    with connect() as conn, conn.cursor() as cur:
        v = _resolve_vehicle(cur, vehicle)
        tz = v["timezone"] or "UTC"

        cur.execute(
            """
            SELECT DISTINCT (ts AT TIME ZONE %s)::date AS d
            FROM readings
            WHERE vehicle_id = %s AND parameter = ANY(%s)
            ORDER BY d
            """,
            (tz, v["vehicle_id"], sigs),
        )
        days = [d.isoformat() for (d,) in cur.fetchall()]
        if not days:
            return {"vehicle": v, "day": None, "days": [], "points": []}
        if day not in days:
            day = days[-1]

        cur.execute(
            """
            WITH ticks AS (
                SELECT DISTINCT ts FROM readings
                WHERE vehicle_id = %s AND parameter = ANY(%s)
                  AND (ts AT TIME ZONE %s)::date = %s::date
            )
            SELECT t.ts, pto.value AS pto, vac.value AS vac, jet.value AS jet, rec.value AS rec
            FROM ticks t
            LEFT JOIN LATERAL (
                SELECT value FROM readings
                WHERE vehicle_id = %s AND parameter = %s AND ts <= t.ts
                ORDER BY ts DESC LIMIT 1
            ) pto ON true
            LEFT JOIN LATERAL (
                SELECT value FROM readings
                WHERE vehicle_id = %s AND parameter = %s AND ts <= t.ts
                ORDER BY ts DESC LIMIT 1
            ) vac ON true
            LEFT JOIN LATERAL (
                SELECT value FROM readings
                WHERE vehicle_id = %s AND parameter = %s AND ts <= t.ts
                ORDER BY ts DESC LIMIT 1
            ) jet ON true
            LEFT JOIN LATERAL (
                SELECT value FROM readings
                WHERE vehicle_id = %s AND parameter = %s AND ts <= t.ts
                ORDER BY ts DESC LIMIT 1
            ) rec ON true
            ORDER BY t.ts
            """,
            (
                v["vehicle_id"], sigs, tz, day,
                v["vehicle_id"], PTO_ON,
                v["vehicle_id"], VAC_ON,
                v["vehicle_id"], JET_ON,
                v["vehicle_id"], REC_ON,
            ),
        )
        points = [
            {
                "ts": ts.isoformat(),
                "pto": int(pto) if pto is not None else None,
                "vac": int(vac) if vac is not None else None,
                "jet": int(jet) if jet is not None else None,
                "rec": int(rec) if rec is not None else None,
            }
            for ts, pto, vac, jet, rec in cur.fetchall()
        ]
    return {"vehicle": v, "day": day, "days": days, "points": points}


@app.get("/api/cycle-counts")
def cycle_counts(
    start: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    vehicle: str | None = Query(None),
):
    """Health page's period-scoped cycle counts (piston moves, rear cover
    openings, cassette movements) - see CYCLE_COUNT_PARAMS. `start`/`end` are
    inclusive vehicle-local calendar dates (the Health page's period picker);
    omit both for the vehicle's full history.

    The edge detection (LAG) always runs over the full history so a window
    that starts mid-"already on" doesn't miscount - only the final count is
    restricted to edges landing inside the window.
    """
    all_params = [p for ps in CYCLE_COUNT_PARAMS.values() for p in ps]
    with connect() as conn, conn.cursor() as cur:
        v = _resolve_vehicle(cur, vehicle)
        tz = v["timezone"] or "UTC"
        cur.execute(
            """
            WITH edges AS (
                SELECT parameter, ts, value,
                       LAG(value) OVER (PARTITION BY parameter ORDER BY ts) AS prev
                FROM readings
                WHERE vehicle_id = %s AND parameter = ANY(%s)
            )
            SELECT parameter, COUNT(*) FILTER (
                WHERE value = 1 AND prev IS DISTINCT FROM 1
                  AND (%s::date IS NULL OR ts >= (%s::date AT TIME ZONE %s))
                  AND (%s::date IS NULL OR ts < ((%s::date + 1) AT TIME ZONE %s))
            )
            FROM edges
            GROUP BY parameter
            """,
            (v["vehicle_id"], all_params, start, start, tz, end, end, tz),
        )
        per_param = {p: int(c) for p, c in cur.fetchall()}
    return {
        key: sum(per_param.get(p, 0) for p in params)
        for key, params in CYCLE_COUNT_PARAMS.items()
    }


# GPS arrives as two rows (lat, lng) per timestamp; pairing them by ts gives points.
# Two possible names per axis: the original demo fleet's channel, and the real
# trial vehicle's actual tag (confirmed 2026-09-08). A given vehicle only ever
# reports under one or the other, so matching either is unambiguous.
LAT_NAMES = ["Latitude Decimal Degrees", "gps_lat_revlive"]
LNG_NAMES = ["Longitude Decimal Degrees", "gps_lon_revlive"]
PTO = "PTO Active"  # 0/1, event-style — between events the last value still applies
RPM = "RPM (rpm)"
# Sustainability inputs (recycled water is a SIMULATED demo channel only -
# fuel is real for the trial vehicle, see below).
FUEL_RATE = "Fuel Rate (l/h)"
# Real trial vehicle's equivalents (confirmed 2026-09-08). Matching either
# name is unambiguous - a given vehicle only ever reports under one. Used
# anywhere PTO state or fuel rate feeds an Overview panel (Route history,
# Fuel), and /api/sustainability's fuel figures - the latter integrates
# these rate samples (rate * dt_h) for a vehicle with no cumulative Total
# Fuel Used counter, same technique /api/fuel-day already used (2026-09-11).
# The fleet_costing plugin still only checks the demo-fleet names, so
# Costing remains unfixed for the real vehicle - a separate gap.
PTO_NAMES = [PTO, "pto_on_revlive"]
FUEL_RATE_NAMES = [FUEL_RATE, "scania_fuelrate_revlive"]
VAC_RUN = "Vac Pump Run"          # 0/1 — the always-present pump-on signal
TOTAL_WATER = "Total Water Used (m3)"
TOTAL_RECYCLED = "Total Recycled Water (m3)"
# Real trial vehicle's on/off state signals (confirmed 2026-09-08), used only
# by /api/pto-working — there is no equivalent "PTO idle" counter to swap in
# the way the other pump metrics can be, so working time is derived from
# these instead. No demo-fleet equivalent; that fleet's idle already comes
# from a real counter ("PTO Idle Run Minute (min)" in USAGE_PARAMS).
PTO_ON = "pto_on_revlive"
VAC_ON = "vac_pump_on_revlive"
JET_ON = "jetting_pump_on_revlive"
REC_ON = "recycling_on_revlive"
# Maps each on/off signal to the same field name pumps.js's REAL_PUMPS uses
# for its lifetime-minute counters, so /api/pump-activations rows line up
# with the rest of the Pumps page without the frontend re-deriving labels.
PUMP_ON_FIELDS = {VAC_ON: "vacuum", JET_ON: "jet", REC_ON: "recycle"}
# Matches either the demo fleet's or the real vehicle's vacuum-pump-on signal
# - used by /api/sustainability's "working" definition, same pairing pattern
# as PTO_NAMES/FUEL_RATE_NAMES above.
VAC_NAMES = [VAC_RUN, VAC_ON]
# Real trial vehicle's recycle-pump lifetime run-minutes counter (already
# used by pumps.js/maintenance.js elsewhere) - no real water-VOLUME tag
# exists (see sustainability.md), but /api/sustainability derives
# water_recycled_litres from this instead: minutes * RECYCLE_FLOW_LPM, the
# recycling piston's known flow rate (Joe, 2026-09-11, confirmed with the
# machine spec - not derived from telemetry).
RECYCLE_PUMP_MINUTES = "recycling_pump_active_minutes_revlive"
RECYCLE_FLOW_LPM = 350
# recycling_rate_pct is redefined (Joe, 2026-09-11) as a minutes ratio -
# recycle-pump minutes / PTO-active minutes over the period - rather than a
# volume ratio, since there's no water-collected volume to divide by. Same
# lifetime-counter convention as RECYCLE_PUMP_MINUTES above.
PTO_ACTIVE_MINUTES = "pto_active_minutes_revlive"
# Matches either the demo fleet's or the real vehicle's lifetime PTO
# run-minutes counter - used by the Trends tab's "Operating hours" (2026-09-11).
PTO_MINUTES_NAMES = ["PTO Run Minute (min)", PTO_ACTIVE_MINUTES]
TOTAL_FUEL = "Total Fuel Used (l)"
# Some real-tag-convention vehicles (e.g. Warrior-75-Demo's rehearsal seed
# data) DO have a genuine cumulative counter under this name, unlike
# Warrior-No.75-Veolia which only has the rate - try this before falling
# back to integrating FUEL_RATE_NAMES (2026-09-11).
TOTAL_FUEL_NAMES = [TOTAL_FUEL, "scania_total_fuel_used_revlive"]
# Health page's period-scoped cycle counters (Veolia trial spec section 3):
# these arrive as 0/1 activation booleans, not counters, so the count is
# derived by counting each 0->1 (or first-ever 1) edge. Real trial vehicle
# only - the demo fleet has these pre-aggregated as lifetime counters
# already ("Piston Moves Completed (times)" etc. in maintenance.js).
CYCLE_COUNT_PARAMS = {
    "piston_moves": ["piston_move_forward_selected_revlive", "piston_move_back_selected_revlive"],
    "rear_cover_openings": ["rear_fully_open_revlive"],
    "cassette_movements": ["cassette_up_revlive", "cassette_down_revlive"],
}
# Standard diesel emission factor (kg CO2e per litre), UK DEFRA-style. Used only
# for the sustainability estimate; the underlying fuel is a SIMULATED channel.
DIESEL_KG_CO2_PER_L = 2.68


@app.get("/api/route")
def route(
    day: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    vehicle: str | None = Query(None),
):
    """One day's GPS track, plus the list of days (vehicle-local) that have GPS."""
    with connect() as conn, conn.cursor() as cur:
        v = _resolve_vehicle(cur, vehicle)
        tz = v["timezone"] or "UTC"

        # Which local calendar days have at least one GPS fix? Oldest first.
        cur.execute(
            """
            SELECT DISTINCT (ts AT TIME ZONE %s)::date AS d
            FROM readings
            WHERE vehicle_id = %s AND parameter = ANY(%s)
            ORDER BY d
            """,
            (tz, v["vehicle_id"], LAT_NAMES + LNG_NAMES),
        )
        days = [d.isoformat() for (d,) in cur.fetchall()]
        if not days:
            return {"vehicle": v, "day": None, "days": [], "points": []}

        # Unknown or missing ?day= falls back to the newest day with data.
        if day not in days:
            day = days[-1]

        # That day's points: pivot the lat/lng row pairs by timestamp, drop
        # any timestamp missing one coordinate, oldest first. Each point also
        # carries the PTO state last known at (or before) its timestamp.
        cur.execute(
            """
            WITH pts AS (
                SELECT ts,
                       max(value) FILTER (WHERE parameter = ANY(%s)) AS lat,
                       max(value) FILTER (WHERE parameter = ANY(%s)) AS lng
                FROM readings
                WHERE vehicle_id = %s
                  AND parameter = ANY(%s)
                  AND (ts AT TIME ZONE %s)::date = %s::date
                GROUP BY ts
                HAVING max(value) FILTER (WHERE parameter = ANY(%s)) IS NOT NULL
                   AND max(value) FILTER (WHERE parameter = ANY(%s)) IS NOT NULL
            )
            SELECT p.ts, p.lat, p.lng, s.value AS pto
            FROM pts p
            LEFT JOIN LATERAL (
                SELECT value FROM readings
                WHERE vehicle_id = %s AND parameter = ANY(%s) AND ts <= p.ts
                ORDER BY ts DESC LIMIT 1
            ) s ON true
            ORDER BY p.ts
            """,
            (LAT_NAMES, LNG_NAMES, v["vehicle_id"], LAT_NAMES + LNG_NAMES, tz, day,
             LAT_NAMES, LNG_NAMES, v["vehicle_id"], PTO_NAMES),
        )
        points = [
            {
                "ts": ts.isoformat(),
                "lat": float(lat),
                "lng": float(lng),
                "pto": int(pto) if pto is not None else None,
            }
            for ts, lat, lng, pto in cur.fetchall()
        ]
    return {"vehicle": v, "day": day, "days": days, "points": points}


@app.get("/api/truck-stops")
def truck_stops(vehicle: str | None = Query(None)):
    """Every GPS fix across the vehicle's full history, with PTO's last-known
    state carried along - the general "everywhere the truck has stopped
    moving" counterpart to /api/work-locations below (which narrows to
    PTO+pump-active stops only). A stop here is pure stillness (distance +
    dwell time, same groupStops() Route History already uses) - PTO is only
    carried along so the frontend can badge a stop as "working" vs a plain
    rest/parking stop, not to decide whether it counts as a stop at all
    (Joe, 2026-09-11). The frontend clusters and keeps the last 5.
    """
    with connect() as conn, conn.cursor() as cur:
        v = _resolve_vehicle(cur, vehicle)
        vid = v["vehicle_id"]
        cur.execute(
            """
            WITH pts AS (
                SELECT ts,
                       max(value) FILTER (WHERE parameter = ANY(%s)) AS lat,
                       max(value) FILTER (WHERE parameter = ANY(%s)) AS lng
                FROM readings
                WHERE vehicle_id = %s AND parameter = ANY(%s)
                GROUP BY ts
                HAVING max(value) FILTER (WHERE parameter = ANY(%s)) IS NOT NULL
                   AND max(value) FILTER (WHERE parameter = ANY(%s)) IS NOT NULL
            )
            SELECT p.ts, p.lat, p.lng, s.value AS pto
            FROM pts p
            LEFT JOIN LATERAL (
                SELECT value FROM readings
                WHERE vehicle_id = %s AND parameter = ANY(%s) AND ts <= p.ts
                ORDER BY ts DESC LIMIT 1
            ) s ON true
            ORDER BY p.ts
            """,
            (LAT_NAMES, LNG_NAMES, vid, LAT_NAMES + LNG_NAMES,
             LAT_NAMES, LNG_NAMES,
             vid, PTO_NAMES),
        )
        points = [
            {
                "ts": ts.isoformat(),
                "lat": float(lat),
                "lng": float(lng),
                "pto": int(pto) if pto is not None else None,
            }
            for ts, lat, lng, pto in cur.fetchall()
        ]
    return {"vehicle": v, "points": points}


@app.get("/api/work-locations")
def work_locations(vehicle: str | None = Query(None)):
    """GPS fixes anywhere PTO and at least one pump were active at the same
    time - Joe's supervisor's definition of a "work location" (2026-09-11) -
    across the vehicle's full history, not scoped to one day. Real trial
    vehicle only; the demo fleet has no per-pump on/off channels to check
    this against (see /api/pto-timeline's own note). The frontend clusters
    these into stops with the same groupStops() used for Route History/
    Overview activity, then keeps only the last 5 - a first cut, expand
    later (e.g. pagination) if the list needs to go further back.
    """
    with connect() as conn, conn.cursor() as cur:
        v = _resolve_vehicle(cur, vehicle)
        vid = v["vehicle_id"]
        cur.execute(
            """
            WITH pts AS (
                SELECT ts,
                       max(value) FILTER (WHERE parameter = ANY(%s)) AS lat,
                       max(value) FILTER (WHERE parameter = ANY(%s)) AS lng
                FROM readings
                WHERE vehicle_id = %s AND parameter = ANY(%s)
                GROUP BY ts
                HAVING max(value) FILTER (WHERE parameter = ANY(%s)) IS NOT NULL
                   AND max(value) FILTER (WHERE parameter = ANY(%s)) IS NOT NULL
            )
            SELECT p.ts, p.lat, p.lng
            FROM pts p
            LEFT JOIN LATERAL (
                SELECT value FROM readings
                WHERE vehicle_id = %s AND parameter = %s AND ts <= p.ts
                ORDER BY ts DESC LIMIT 1
            ) pto ON true
            LEFT JOIN LATERAL (
                SELECT value FROM readings
                WHERE vehicle_id = %s AND parameter = %s AND ts <= p.ts
                ORDER BY ts DESC LIMIT 1
            ) vac ON true
            LEFT JOIN LATERAL (
                SELECT value FROM readings
                WHERE vehicle_id = %s AND parameter = %s AND ts <= p.ts
                ORDER BY ts DESC LIMIT 1
            ) jet ON true
            LEFT JOIN LATERAL (
                SELECT value FROM readings
                WHERE vehicle_id = %s AND parameter = %s AND ts <= p.ts
                ORDER BY ts DESC LIMIT 1
            ) rec ON true
            WHERE pto.value = 1 AND (vac.value = 1 OR jet.value = 1 OR rec.value = 1)
            ORDER BY p.ts
            """,
            (
                LAT_NAMES, LNG_NAMES, vid, LAT_NAMES + LNG_NAMES,
                LAT_NAMES, LNG_NAMES,
                vid, PTO_ON,
                vid, VAC_ON,
                vid, JET_ON,
                vid, REC_ON,
            ),
        )
        points = [
            {"ts": ts.isoformat(), "lat": float(lat), "lng": float(lng), "pto": 1}
            for ts, lat, lng in cur.fetchall()
        ]
    return {"vehicle": v, "points": points}


@app.get("/api/pump-activations")
def pump_activations(vehicle: str | None = Query(None)):
    """Discrete on/off cycles for each pump (vacuum, jet, recycle), newest
    first - the "Pump Activation Log" on the Pumps page. Real trial vehicle
    only; the demo fleet has no per-pump on/off channels, only aggregate
    lifetime run-minute counters (same gap noted on /api/pto-timeline).

    Pairs each 0->1 edge with the next 1->0 edge for the same signal by
    matching row-number within each signal's own edge sequence (edges always
    alternate start/stop, so the nth start pairs with the nth stop). Edges
    require an actual prior reading (`prev = 0`/`prev = 1`, not just
    "distinct from") so a parameter's very first row - whose true prior
    state is unknown - never counts as a false transition; without that, the
    first row's implicit edge shifts every later start/stop pairing by one
    and end_ts comes back earlier than start_ts. A cycle still running when
    the query runs has `end_ts: None` - the frontend shows that as "ongoing"
    rather than a fabricated duration.
    """
    params = list(PUMP_ON_FIELDS)
    with connect() as conn, conn.cursor() as cur:
        v = _resolve_vehicle(cur, vehicle)
        vid = v["vehicle_id"]
        cur.execute(
            """
            WITH edges AS (
                SELECT parameter, ts, value,
                       LAG(value) OVER (PARTITION BY parameter ORDER BY ts) AS prev
                FROM readings
                WHERE vehicle_id = %s AND parameter = ANY(%s)
            ),
            starts AS (
                SELECT parameter, ts AS start_ts,
                       ROW_NUMBER() OVER (PARTITION BY parameter ORDER BY ts) AS rn
                FROM edges WHERE value = 1 AND prev = 0
            ),
            stops AS (
                SELECT parameter, ts AS end_ts,
                       ROW_NUMBER() OVER (PARTITION BY parameter ORDER BY ts) AS rn
                FROM edges WHERE value = 0 AND prev = 1
            )
            SELECT s.parameter, s.start_ts, e.end_ts
            FROM starts s
            LEFT JOIN stops e ON e.parameter = s.parameter AND e.rn = s.rn
            ORDER BY s.start_ts DESC
            LIMIT %s
            """,
            (vid, params, LOG_LIMIT),
        )
        cycles = [
            {
                "pump": PUMP_ON_FIELDS[p],
                "start_ts": start.isoformat(),
                "end_ts": end.isoformat() if end else None,
                "duration_min": (end - start).total_seconds() / 60 if end else None,
            }
            for p, start, end in cur.fetchall()
        ]
    return {"vehicle": v, "cycles": cycles}


@app.get("/api/fuel-day")
def fuel_day(
    day: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    vehicle: str | None = Query(None),
):
    """One day's fuel consumption (litres) split by whether the PTO was engaged
    ("at work") vs not ("travel / idle") — the fuel companion to the route
    activity split, scoped to the same day. Fuel is integrated from the
    Fuel Rate (l/h) samples over each sample's interval and attributed to the
    last-known PTO state at that sample (the same lateral-join /api/route uses),
    matching how the demo accumulates Total Fuel Used. Fuel is a SIMULATED demo
    channel — the UI labels this card as sample data."""
    with connect() as conn, conn.cursor() as cur:
        v = _resolve_vehicle(cur, vehicle)
        vid = v["vehicle_id"]
        tz = v["timezone"] or "UTC"

        cur.execute(
            """
            SELECT DISTINCT (ts AT TIME ZONE %s)::date AS d
            FROM readings
            WHERE vehicle_id = %s AND parameter = ANY(%s)
            ORDER BY d
            """,
            (tz, vid, FUEL_RATE_NAMES),
        )
        days = [d.isoformat() for (d,) in cur.fetchall()]
        if not days:
            return {"vehicle": v, "day": None, "days": [],
                    "work_litres": 0, "idle_litres": 0, "total_litres": 0}
        if day not in days:
            day = days[-1]

        cur.execute(
            """
            SELECT r.ts, r.value AS rate, s.value AS pto
            FROM readings r
            LEFT JOIN LATERAL (
                SELECT value FROM readings
                WHERE vehicle_id = %s AND parameter = ANY(%s) AND ts <= r.ts
                ORDER BY ts DESC LIMIT 1
            ) s ON true
            WHERE r.vehicle_id = %s AND r.parameter = ANY(%s)
              AND (r.ts AT TIME ZONE %s)::date = %s::date
            ORDER BY r.ts
            """,
            (vid, PTO_NAMES, vid, FUEL_RATE_NAMES, tz, day),
        )
        rows = cur.fetchall()

    # Integrate rate over each sample's interval and attribute it to that sample's
    # PTO state. A gap longer than GAP_CAP (feed dropout / break) is treated as a
    # single telemetry step so a long idle gap can't over-count, mirroring the
    # gap cap in deriveActivity on the client.
    GAP_CAP_H = 0.5
    STEP_H = 10 / 60  # telemetry cadence; also used for the final sample
    work = idle = 0.0
    for i, (ts, rate, pto) in enumerate(rows):
        if rate is None or rate <= 0:
            continue
        if i + 1 < len(rows):
            dt_h = (rows[i + 1][0] - ts).total_seconds() / 3600
            if dt_h > GAP_CAP_H:
                dt_h = STEP_H
        else:
            dt_h = STEP_H
        litres = float(rate) * dt_h
        if pto == 1:
            work += litres
        else:
            idle += litres

    return {
        "vehicle": v, "day": day, "days": days,
        "work_litres": round(work, 1),
        "idle_litres": round(idle, 1),
        "total_litres": round(work + idle, 1),
    }


# Trial-vehicle tag names (Section 8 of the Veolia trial spec — confirmed
# `_revlive` feed tags). Selected by v["source"] == "trial_demo" (see
# v_fr_seed.py), kept separate from the sample-fleet constants above rather
# than merged into one lookup table, since only activity-day needs them so far.
TRIAL_PTO = "pto_on_revlive"
TRIAL_SPEED = "scania_vehicle_speed_revlive"
TRIAL_RPM = "truck_rpm_revlive"

# Section 7's exact cap: "Per-sample interval taken to the next timestamp,
# capped at 30 minutes so a feed gap is not billed to any state."
ACTIVITY_GAP_CAP_MIN = 30
# Fallback interval for a sample with no next row yet (matches fuel_day's
# STEP_H approach) - the confirmed feed cadence, not a guess: v_fr_seed and
# program.bas's DoSync both tick every 30 min in this project so far.
ACTIVITY_STEP_MIN = 30
# Section 7: "engine running, taken from truck_rpm at its idle band (about
# 600 rpm) or the relay input." No relay-input tag exists in the confirmed
# feed, so this uses rpm > 0 as "engine on" - simpler than matching an exact
# idle band the spec doesn't pin a number to beyond "about".


@app.get("/api/activity-day")
def activity_day(
    day: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    vehicle: str | None = Query(None),
):
    """One day's Work / Travel / Idle split, computed purely from state
    readings (pto_on, vehicle speed, engine rpm) per the trial spec's Section
    7 state-precedence rules - no GPS required. This is the GPS-free
    equivalent of the existing /api/route + deriveActivity() path, for a
    vehicle with no GPS fix confirmed yet (see sensors.py's gps_lat/gps_lon
    placeholders).

    State precedence, straight from the spec (PTO first):
      Work   = pto_on = 1, regardless of speed.
      Travel = pto_on = 0 AND speed > 0.
      Idle   = pto_on = 0 AND speed = 0 AND engine running (rpm > 0).
      (pto_on = 0 AND speed = 0 AND rpm = 0 -> vehicle off, uncounted -
       "the time is counted to no state.")
    """
    with connect() as conn, conn.cursor() as cur:
        v = _resolve_vehicle(cur, vehicle)
        vid = v["vehicle_id"]
        tz = v["timezone"] or "UTC"

        cur.execute(
            """
            SELECT DISTINCT (ts AT TIME ZONE %s)::date AS d
            FROM readings WHERE vehicle_id = %s AND parameter = %s
            ORDER BY d
            """,
            (tz, vid, TRIAL_PTO),
        )
        days = [d.isoformat() for (d,) in cur.fetchall()]
        if not days:
            return {"vehicle": v, "day": None, "days": [],
                    "work_minutes": 0, "travel_minutes": 0, "idle_minutes": 0,
                    "total_minutes": 0, "work_pct": 0}
        if day not in days:
            day = days[-1]

        # Pivot the three state tags by shared timestamp (same pattern as
        # /api/route's lat/lng pairing) - one row per sync tick.
        cur.execute(
            """
            SELECT ts,
                   max(value) FILTER (WHERE parameter = %s) AS pto,
                   max(value) FILTER (WHERE parameter = %s) AS speed,
                   max(value) FILTER (WHERE parameter = %s) AS rpm
            FROM readings
            WHERE vehicle_id = %s
              AND parameter IN (%s, %s, %s)
              AND (ts AT TIME ZONE %s)::date = %s::date
            GROUP BY ts
            ORDER BY ts
            """,
            (TRIAL_PTO, TRIAL_SPEED, TRIAL_RPM, vid,
             TRIAL_PTO, TRIAL_SPEED, TRIAL_RPM, tz, day),
        )
        rows = cur.fetchall()

    work = travel = idle = 0.0
    for i, (ts, pto, speed, rpm) in enumerate(rows):
        if i + 1 < len(rows):
            dt_min = (rows[i + 1][0] - ts).total_seconds() / 60
            dt_min = min(dt_min, ACTIVITY_GAP_CAP_MIN)
        else:
            dt_min = ACTIVITY_STEP_MIN
        if pto == 1:
            work += dt_min
        elif speed and speed > 0:
            travel += dt_min
        elif rpm and rpm > 0:
            idle += dt_min
        # else: vehicle off - counted to no state, per spec.

    total = work + travel + idle
    return {
        "vehicle": v, "day": day, "days": days,
        "work_minutes": round(work), "travel_minutes": round(travel),
        "idle_minutes": round(idle), "total_minutes": round(total),
        "work_pct": round(work / total * 100, 1) if total else 0,
    }


# Emergency-stop events shown on the Alerts tab. "E-Stop: ..." are SIMULATED
# demo data: the demo generator stores each as a reading (parameter = the
# event name, value = 1), one row per occurrence. alm_safety_tripped_revlive
# is the real trial vehicle's equivalent - the metric list's own "clarify:
# estop?" note on that tag is confirmed against the "Maintenance Thresholds"
# sheet's Alert column ("Emergency stop activated and which type(button,
# fall, remote out of range)") (Joe, 2026-09-11). Same periodic boolean-
# snapshot situation as REAL_OVERRIDE_PARAM below, hence edge detection.
ESTOP_PARAMS = [
    "E-Stop: Button Pressed (Warrior)",
    "E-Stop: Button Pressed (Remote)",
    "E-Stop: Remote Out Of Range",
    "E-Stop: Remote Fall Detection",
]
REAL_ESTOP_PARAM = "alm_safety_tripped_revlive"

# Operational override events. Not emergencies — these are deliberate overrides
# of a safety interlock, shown on the Alerts tab so an operator can see when a
# machine was run outside its recommended envelope. "Low Level Override
# Pressed" is SIMULATED demo data (one row per occurrence, from the demo
# generator); alm_low_overide_revlive is the real trial vehicle's equivalent
# (spec section 4, confirmed 2026-09-10) - same event, real telemetry, but
# arrives as a periodic boolean-group snapshot rather than one row per
# occurrence, so it needs edge detection (see _edge_events in alerts()) rather
# than the plain row scan _events() uses for OVERRIDE_PARAMS. A vehicle only
# ever populates one side of this pairing, so merging the two is safe - a
# given vehicle's overrides are either genuinely real or genuinely simulated,
# never a mix.
OVERRIDE_PARAMS = [
    "Low Level Override Pressed",
]
REAL_OVERRIDE_PARAM = "alm_low_overide_revlive"

# Machine-fault alarms - real trial vehicle only (spec section 4, confirmed
# 2026-09-10), no demo-fleet equivalent, so never simulated. Same periodic
# boolean-snapshot situation as REAL_OVERRIDE_PARAM above, hence edge
# detection. alm_safety_tripped_revlive moved out to REAL_ESTOP_PARAM above
# once confirmed as the real e-stop signal (2026-09-11). alm_vac_water_temp_revlive
# is deliberately excluded - not part of the spec's Alerts section (Joe,
# 2026-09-10); add it once confirmed needed.
MACHINE_FAULT_PARAMS = [
    "alm_low_oil_revlive",
    "alm_high_oil_temp_revlive",
]

# Emergency Stops Log / Operational Overrides Log show only the last known
# state changes, not full history (Joe's supervisor, 2026-09-11).
LOG_LIMIT = 5

# Metrics the Trends tab can chart. Allowlisted (like USAGE_PARAMS) so no raw
# parameter reaches SQL from the client. `agg` picks how each period bucket is
# computed: delta = increase of a cumulative counter, avg = mean of an
# instantaneous reading, count = number of events. `scale` (optional) converts
# units (PTO run-minutes -> hours). Fuel + recycled water are SIMULATED demo
# channels (see demo_data.py); the UI labels the whole tab "Sample data".
# `params` is always a list now (2026-09-11) - widened to real+demo pairs
# where a real equivalent exists, same pattern as PTO_NAMES/FUEL_RATE_NAMES
# elsewhere. water_collected has no real equivalent at all (confirmed - see
# sustainability.md); water_recycled and fuel_used would need the same
# rate-integration/350-L/min-derivation special-casing /api/sustainability
# has, which the generic delta handler below doesn't do - not done here yet,
# so those two (and safety_events, which needs edge detection like
# /api/alerts) stay demo-fleet-only for now. fuel_used is a partial
# exception: TOTAL_FUEL_NAMES also covers Warrior-75-Demo's real cumulative
# counter, just not Warrior-No.75-Veolia's (rate-only, no counter).
TREND_METRICS = {
    "water_collected": {"params": [TOTAL_WATER],       "agg": "delta", "unit": "L",      "label": "Water collected", "scale": 1000},
    "water_recycled":  {"params": [TOTAL_RECYCLED],    "agg": "delta", "unit": "L",      "label": "Water recycled", "scale": 1000},
    "operating_hours": {"params": PTO_MINUTES_NAMES,   "agg": "delta", "unit": "h",      "label": "Operating hours", "scale": 1 / 60},
    "fuel_used":       {"params": TOTAL_FUEL_NAMES,    "agg": "delta", "unit": "L",      "label": "Fuel used"},
    "fuel_rate":       {"params": FUEL_RATE_NAMES,     "agg": "avg",   "unit": "L/h",    "label": "Fuel rate"},
    "rpm_avg":         {"params": [RPM, TRIAL_RPM],    "agg": "avg",   "unit": "rpm",    "label": "Engine RPM"},
    "safety_events":   {"params": ESTOP_PARAMS,        "agg": "count", "unit": "events", "label": "Safety events"},
}


@app.get("/api/alerts")
def alerts(vehicle: str | None = Query(None)):
    """Alert events for the vehicle, newest first: emergency stops, operational
    overrides and machine faults, returned as three separate lists.

    Emergency stops and overrides are real telemetry for the trial vehicle,
    simulated only for the demo fleet (see ESTOP_PARAMS/REAL_ESTOP_PARAM and
    OVERRIDE_PARAMS/REAL_OVERRIDE_PARAM). Faults are real trial-vehicle only,
    never simulated (see MACHINE_FAULT_PARAMS).
    """
    def _events(cur, vid, params):
        cur.execute(
            """
            SELECT parameter, ts FROM readings
            WHERE vehicle_id = %s AND parameter = ANY(%s)
            ORDER BY ts DESC
            """,
            (vid, params),
        )
        return [{"type": p, "ts": ts.isoformat()} for p, ts in cur.fetchall()]

    def _edge_events(cur, vid, params):
        """Same 0->1 edge detection as /api/cycle-counts, for alm_* tags that
        arrive as a periodic boolean-group snapshot rather than one row per
        occurrence - a naive row scan would repeat a still-active fault on
        every sync cycle instead of reporting it once."""
        cur.execute(
            """
            WITH edges AS (
                SELECT parameter, ts, value,
                       LAG(value) OVER (PARTITION BY parameter ORDER BY ts) AS prev
                FROM readings
                WHERE vehicle_id = %s AND parameter = ANY(%s)
            )
            SELECT parameter, ts FROM edges
            WHERE value = 1 AND prev IS DISTINCT FROM 1
            ORDER BY ts DESC
            """,
            (vid, params),
        )
        return [{"type": p, "ts": ts.isoformat()} for p, ts in cur.fetchall()]

    with connect() as conn, conn.cursor() as cur:
        v = _resolve_vehicle(cur, vehicle)
        vid = v["vehicle_id"]
        events = sorted(
            _events(cur, vid, ESTOP_PARAMS) + _edge_events(cur, vid, [REAL_ESTOP_PARAM]),
            key=lambda e: e["ts"], reverse=True,
        )[:LOG_LIMIT]
        overrides = sorted(
            _events(cur, vid, OVERRIDE_PARAMS) + _edge_events(cur, vid, [REAL_OVERRIDE_PARAM]),
            key=lambda e: e["ts"], reverse=True,
        )[:LOG_LIMIT]
        faults = _edge_events(cur, vid, MACHINE_FAULT_PARAMS)
    return {"vehicle": v, "events": events, "overrides": overrides, "faults": faults}


@app.get("/api/rpm")
def rpm(
    grain: str = Query("week", pattern="^(day|week|month)$"),
    vehicle: str | None = Query(None),
):
    """Daily/weekly/monthly average engine RPM while running (zeros excluded), split
    exclusively: PTO off vs PTO on (last-known state at each sample, as on the
    route map). PTO-off includes both idling and driving — separating those is
    deferred until a speed signal arrives in the fuller Scania ECU file; it
    cannot be derived honestly from 10-minute GPS.
    """
    with connect() as conn, conn.cursor() as cur:
        v = _resolve_vehicle(cur, vehicle)
        cur.execute(
            """
            SELECT date_trunc(%s, r.ts AT TIME ZONE %s) AS bucket,
                   avg(r.value) FILTER (WHERE p.value IS DISTINCT FROM 1) AS avg_off,
                   avg(r.value) FILTER (WHERE p.value = 1) AS avg_pto,
                   count(*) AS samples
            FROM readings r
            LEFT JOIN LATERAL (
                SELECT value FROM readings s
                WHERE s.vehicle_id = r.vehicle_id AND s.parameter = %s
                  AND s.ts <= r.ts
                ORDER BY s.ts DESC LIMIT 1
            ) p ON true
            WHERE r.vehicle_id = %s AND r.parameter = %s AND r.value > 0
            GROUP BY 1 ORDER BY 1
            """,
            (grain, v["timezone"] or "UTC", PTO, v["vehicle_id"], RPM),
        )
        buckets = [
            {
                "bucket": b.date().isoformat(),
                "avg_rpm_off": round(float(a)) if a is not None else None,
                "avg_rpm_pto": round(float(ap)) if ap is not None else None,
                "samples": n,
            }
            for b, a, ap, n in cur.fetchall()
        ]
    return {"grain": grain, "buckets": buckets}


@app.get("/api/trend")
def trend(
    metric: str = Query(..., description="A key from TREND_METRICS"),
    grain: str = Query("week", pattern="^(day|week|month)$"),
    vehicle: str | None = Query(None),
):
    """Period-over-period trend for one allowlisted metric, bucketed in the
    vehicle's local time. Powers the Trends tab. `agg` (from TREND_METRICS)
    selects the computation:
      delta — increase of a cumulative counter over the period (as /api/usage)
      avg   — mean of an instantaneous reading, zeros excluded (as /api/rpm)
      count — number of events in the period (e.g. emergency stops)
    """
    cfg = TREND_METRICS.get(metric)
    if cfg is None:
        raise HTTPException(400, f"Unknown metric. Available: {sorted(TREND_METRICS)}")
    agg = cfg["agg"]
    with connect() as conn, conn.cursor() as cur:
        v = _resolve_vehicle(cur, vehicle)
        tz = v["timezone"] or "UTC"
        fallback_scale = None
        if agg == "delta":
            cur.execute(
                """
                WITH b AS (
                    SELECT date_trunc(%s, ts AT TIME ZONE %s) AS bucket,
                           min(value) AS cmin, max(value) AS cmax
                    FROM readings
                    WHERE vehicle_id = %s AND parameter = ANY(%s)
                    GROUP BY 1
                )
                SELECT bucket,
                       GREATEST(cmax - COALESCE(lag(cmax) OVER (ORDER BY bucket), cmin), 0)
                FROM b ORDER BY bucket
                """,
                (grain, tz, v["vehicle_id"], cfg["params"]),
            )
            rows = cur.fetchall()
            # Fallbacks for a real-tag vehicle with no cumulative counter to
            # take a delta of - both already return final litres, so they
            # override cfg["scale"] (meant for the primary m³-counter path)
            # rather than being scaled again below.
            # fuel_used: rate-integration, same technique /api/sustainability
            # uses when there's no cumulative fuel counter (2026-09-11).
            if metric == "fuel_used" and not rows:
                cur.execute(
                    """
                    WITH ordered AS (
                        SELECT ts, value,
                               LEAD(ts) OVER (ORDER BY ts) AS next_ts
                        FROM readings
                        WHERE vehicle_id = %s AND parameter = ANY(%s)
                    )
                    SELECT date_trunc(%s, ts AT TIME ZONE %s) AS bucket,
                           sum(value * LEAST(
                               EXTRACT(EPOCH FROM (COALESCE(next_ts, ts + interval '10 minutes') - ts)) / 3600.0,
                               0.5
                           )) AS litres
                    FROM ordered
                    WHERE value > 0
                    GROUP BY 1 ORDER BY 1
                    """,
                    (v["vehicle_id"], FUEL_RATE_NAMES, grain, tz),
                )
                rows = cur.fetchall()
                fallback_scale = 1
            # water_recycled: RECYCLE_PUMP_MINUTES' counter delta *
            # RECYCLE_FLOW_LPM, same derivation /api/sustainability uses when
            # there's no water-volume counter, only the pump's run-minutes
            # (2026-09-11).
            elif metric == "water_recycled" and not rows:
                cur.execute(
                    """
                    WITH b AS (
                        SELECT date_trunc(%s, ts AT TIME ZONE %s) AS bucket,
                               min(value) AS cmin, max(value) AS cmax
                        FROM readings
                        WHERE vehicle_id = %s AND parameter = ANY(%s)
                        GROUP BY 1
                    )
                    SELECT bucket,
                           GREATEST(cmax - COALESCE(lag(cmax) OVER (ORDER BY bucket), cmin), 0) * %s
                    FROM b ORDER BY bucket
                    """,
                    (grain, tz, v["vehicle_id"], [RECYCLE_PUMP_MINUTES], RECYCLE_FLOW_LPM),
                )
                rows = cur.fetchall()
                fallback_scale = 1
        elif agg == "avg":
            cur.execute(
                """
                SELECT date_trunc(%s, ts AT TIME ZONE %s) AS bucket, avg(value)
                FROM readings
                WHERE vehicle_id = %s AND parameter = ANY(%s) AND value > 0
                GROUP BY 1 ORDER BY 1
                """,
                (grain, tz, v["vehicle_id"], cfg["params"]),
            )
            rows = cur.fetchall()
        else:  # count
            cur.execute(
                """
                SELECT date_trunc(%s, ts AT TIME ZONE %s) AS bucket, count(*)
                FROM readings
                WHERE vehicle_id = %s AND parameter = ANY(%s)
                GROUP BY 1 ORDER BY 1
                """,
                (grain, tz, v["vehicle_id"], cfg["params"]),
            )
            rows = cur.fetchall()
        scale = fallback_scale if fallback_scale is not None else cfg.get("scale", 1)
        buckets = [
            {
                "bucket": b.date().isoformat(),
                "value": round(float(val) * scale, 2) if val is not None else 0,
            }
            for b, val in rows
        ]
    return {
        "metric": metric,
        "grain": grain,
        "unit": cfg["unit"],
        "label": cfg["label"],
        "buckets": buckets,
    }


@app.get("/api/sustainability")
def sustainability(
    grain: str = Query("week", pattern="^(week|month)$"),
    vehicle: str | None = Query(None),
):
    """Per-period energy/water-saving figures for the report's Sustainability
    section, bucketed by `grain` (week/month) in the vehicle's local time so the
    report's period toggle/nav drives it just like Usage. One bucket per period,
    each with:

    - avg_working_fuel_rate / avg_offtask_fuel_rate: mean fuel rate (l/h) split
      by whether the vehicle was WORKING (PTO engaged OR the vacuum pump
      running) vs off-task (idle or driving — the two can't be separated
      without a speed signal, deferred to the fuller ECU file). Working uses
      the last-known PTO / pump state at each sample, the same lateral-join
      approach as /api/rpm. Real trial vehicle: matched via PTO_NAMES/
      VAC_NAMES/FUEL_RATE_NAMES (see their own comments) - a vehicle only
      ever reports under one of the two names per pairing.
    - utilisation_pct: share of engine-on samples spent working (evenly-spaced
      10-min samples, so sample share ~= time share).
    - water_collected_litres: period counter delta, m³ -> litres. SIMULATED
      demo channel only - the real trial vehicle has no water-collected tag
      at all (only tank level %), so this comes back null for it rather
      than a fabricated figure.
    - water_recycled_litres: counter delta for the demo fleet; for a
      real-tag vehicle, derived instead from RECYCLE_PUMP_MINUTES' counter
      delta * RECYCLE_FLOW_LPM (the recycling piston's known flow rate, not
      derived from telemetry - see its own comment). recycling_rate_pct is
      recycled/collected (m³) for the demo fleet; for a real-tag vehicle
      (no water-collected equivalent to divide by) it's redefined instead
      as RECYCLE_PUMP_MINUTES' counter delta / PTO_ACTIVE_MINUTES' counter
      delta - share of PTO-active time spent recycling (Joe, 2026-09-11).
    - fuel_used_litres + co2_kg: period fuel total (real for the trial vehicle,
      integrated from FUEL_RATE_NAMES samples - it has no cumulative Total
      Fuel Used counter, only a rate, same technique /api/fuel-day already
      uses - simulated demo-counter delta otherwise) and an estimated CO2
      figure (fuel * DIESEL_KG_CO2_PER_L, an estimate either way).
    """
    with connect() as conn, conn.cursor() as cur:
        v = _resolve_vehicle(cur, vehicle)
        vid = v["vehicle_id"]
        tz = v["timezone"] or "UTC"

        # Fuel rate + utilisation per period: for every fuel-rate sample, carry
        # forward the last-known PTO / vacuum-pump state and split working vs
        # off-task. Rewritten 2026-09-11 from a per-row LATERAL "last known
        # value" lookup (correct, but a correlated subquery per fuel-rate row -
        # fine over one day's ~150 rows elsewhere, but ~35,000 lookups over a
        # vehicle's full history took 30+ seconds) to a single window-function
        # pass: union fuel/pto/vac readings into one ordered stream, use a
        # running count of each signal's own readings as a "generation" number
        # (same technique as a classic gaps-and-islands last-observation-
        # carried-forward join), then join each fuel row back to the pto/vac
        # value whose generation is current as of that row. Verified to return
        # byte-identical results to the old query, ~1000x faster (30ms vs 32.7s
        # on Warrior 75's ~18k fuel-rate rows) - see sustainability.md.
        cur.execute(
            """
            WITH combined AS (
                SELECT ts, value, 'fuel'::text AS kind FROM readings
                WHERE vehicle_id = %s AND parameter = ANY(%s) AND value > 0
                UNION ALL
                SELECT ts, value, 'pto'::text AS kind FROM readings
                WHERE vehicle_id = %s AND parameter = ANY(%s)
                UNION ALL
                SELECT ts, value, 'vac'::text AS kind FROM readings
                WHERE vehicle_id = %s AND parameter = ANY(%s)
            ),
            grouped AS (
                SELECT ts, value, kind,
                    count(*) FILTER (WHERE kind = 'pto') OVER (ORDER BY ts) AS pto_grp,
                    count(*) FILTER (WHERE kind = 'vac') OVER (ORDER BY ts) AS vac_grp
                FROM combined
            ),
            pto_vals AS (
                SELECT pto_grp AS grp, value AS pto_value FROM grouped WHERE kind = 'pto'
            ),
            vac_vals AS (
                SELECT vac_grp AS grp, value AS vac_value FROM grouped WHERE kind = 'vac'
            ),
            joined AS (
                SELECT g.ts, g.value AS fuel_value, pv.pto_value, vv.vac_value
                FROM grouped g
                LEFT JOIN pto_vals pv ON pv.grp = g.pto_grp AND g.pto_grp > 0
                LEFT JOIN vac_vals vv ON vv.grp = g.vac_grp AND g.vac_grp > 0
                WHERE g.kind = 'fuel'
            )
            SELECT date_trunc(%s, ts AT TIME ZONE %s) AS bucket,
                   avg(fuel_value) FILTER (WHERE pto_value = 1 OR vac_value = 1) AS fuel_working,
                   avg(fuel_value) FILTER (WHERE pto_value IS DISTINCT FROM 1
                                             AND vac_value IS DISTINCT FROM 1)   AS fuel_offtask,
                   count(*)       FILTER (WHERE pto_value = 1 OR vac_value = 1) AS n_working,
                   count(*) AS n_total
            FROM joined
            GROUP BY 1
            """,
            (vid, FUEL_RATE_NAMES, vid, PTO_NAMES, vid, VAC_NAMES, grain, tz),
        )
        fuel = {b.date().isoformat(): (fw, fo, nw, nt)
                for b, fw, fo, nw, nt in cur.fetchall()}

        # Per-period delta of a cumulative counter (same shape as /api/usage).
        def _delta_by_bucket(params):
            cur.execute(
                """
                WITH b AS (
                    SELECT date_trunc(%s, ts AT TIME ZONE %s) AS bucket,
                           min(value) AS cmin, max(value) AS cmax
                    FROM readings WHERE vehicle_id = %s AND parameter = ANY(%s)
                    GROUP BY 1
                )
                SELECT bucket,
                       GREATEST(cmax - COALESCE(lag(cmax) OVER (ORDER BY bucket), cmin), 0)
                FROM b ORDER BY bucket
                """,
                (grain, tz, vid, params if isinstance(params, list) else [params]),
            )
            return {b.date().isoformat(): float(d) for b, d in cur.fetchall()}

        # Per-period fuel litres integrated from rate samples (rate * dt_h,
        # gap-capped at 30 min same as /api/fuel-day) - for a vehicle with no
        # cumulative Total Fuel Used counter, only a rate.
        def _fuel_integrated_by_bucket():
            cur.execute(
                """
                WITH ordered AS (
                    SELECT ts, value,
                           LEAD(ts) OVER (ORDER BY ts) AS next_ts
                    FROM readings
                    WHERE vehicle_id = %s AND parameter = ANY(%s)
                )
                SELECT date_trunc(%s, ts AT TIME ZONE %s) AS bucket,
                       sum(value * LEAST(
                           EXTRACT(EPOCH FROM (COALESCE(next_ts, ts + interval '10 minutes') - ts)) / 3600.0,
                           0.5
                       )) AS litres
                FROM ordered
                WHERE value > 0
                GROUP BY 1
                """,
                (vid, FUEL_RATE_NAMES, grain, tz),
            )
            return {b.date().isoformat(): float(d) for b, d in cur.fetchall() if d is not None}

        collected = _delta_by_bucket(TOTAL_WATER)
        recycled = _delta_by_bucket(TOTAL_RECYCLED)
        recycled_minutes = _delta_by_bucket([RECYCLE_PUMP_MINUTES])
        pto_minutes = _delta_by_bucket([PTO_ACTIVE_MINUTES])
        fuel_used = _delta_by_bucket(TOTAL_FUEL_NAMES) or _fuel_integrated_by_bucket()

    keys = sorted(set(fuel) | set(collected) | set(recycled) | set(recycled_minutes) | set(fuel_used))
    buckets = []
    for k in keys:
        fw, fo, n_work, n_total = fuel.get(k, (None, None, 0, 0))
        col_m3 = collected.get(k)
        rec_m3 = recycled.get(k)
        rec_min = recycled_minutes.get(k)
        pto_min = pto_minutes.get(k)
        rec_litres = (
            round(rec_m3 * 1000) if rec_m3 is not None
            else round(rec_min * RECYCLE_FLOW_LPM) if rec_min is not None
            else None
        )
        recycling_rate_pct = (
            round(rec_m3 / col_m3 * 100) if col_m3
            else round(rec_min / pto_min * 100) if pto_min
            else None
        )
        fl = fuel_used.get(k)
        buckets.append({
            "bucket": k,
            "avg_working_fuel_rate": round(float(fw), 1) if fw is not None else None,
            "avg_offtask_fuel_rate": round(float(fo), 1) if fo is not None else None,
            "utilisation_pct": round(n_work / n_total * 100) if n_total else None,
            "water_collected_litres": round(col_m3 * 1000) if col_m3 is not None else None,
            "water_recycled_litres": rec_litres,
            "recycling_rate_pct": recycling_rate_pct,
            "fuel_used_litres": round(fl) if fl is not None else None,
            "co2_kg": round(fl * DIESEL_KG_CO2_PER_L) if fl is not None else None,
        })
    return {"vehicle": v, "grain": grain, "buckets": buckets}
