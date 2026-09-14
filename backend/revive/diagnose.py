"""Read-only data-fidelity diagnostic.

Answers one question: is the telemetry sampled finely enough to faithfully
represent work time and movement, or is the dashboard's "lightness" an artifact
of coarse sampling? It does NOT write anything — pure SELECTs against the same
database the dashboard reads.

Run it like the ingest tool:
    python -m revive.diagnose

What it reports, per the sole pilot vehicle:
  1. Per-parameter cadence (gap distribution between consecutive readings).
  2. GPS cadence histogram — resolves "is GPS ~10s or ~10min?" definitively.
  3. PTO Active sampling pattern (periodic heartbeat vs change-only).
  4. Authoritative vs derived work time per local day: the cumulative
     run-minute counter delta (what /api/usage trusts) alongside what the
     sparse PTO-Active samples can actually see.
  5. An adequacy verdict per signal against the cadence its dashboard use needs.

Times are bucketed in the vehicle's own timezone, matching api.py, so day
boundaries line up with the dashboard.
"""
from __future__ import annotations

from .db import connect

# Parameter names — kept here, not imported, so this stays a standalone tool.
LAT = "Latitude Decimal Degrees"
PTO_RUN = "PTO Run Minute (min)"
PTO_ACTIVE = "PTO Active"


def human(seconds) -> str:
    """Render a gap in the largest sensible unit."""
    if seconds is None:
        return "—"
    s = float(seconds)
    if s < 90:
        return f"{s:.0f} s"
    if s < 5400:
        return f"{s / 60:.0f} min"
    if s < 172800:
        return f"{s / 3600:.1f} h"
    return f"{s / 86400:.1f} d"


def _sole_vehicle(cur):
    cur.execute(
        "SELECT vehicle_id, name, timezone FROM vehicles ORDER BY created_at LIMIT 1")
    row = cur.fetchone()
    if not row:
        raise SystemExit("No vehicle ingested yet — nothing to diagnose.")
    return row[0], row[1], (row[2] or "UTC")


def section(title: str):
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


def per_parameter_cadence(cur, vid):
    section("1. PER-PARAMETER CADENCE  (gap between consecutive readings)")
    cur.execute(
        """
        WITH g AS (
            SELECT parameter, ts,
                   EXTRACT(EPOCH FROM ts -
                       lag(ts) OVER (PARTITION BY parameter ORDER BY ts)) AS gap
            FROM readings WHERE vehicle_id = %s
        )
        SELECT parameter,
               count(*) AS n,
               round(EXTRACT(EPOCH FROM max(ts) - min(ts)) / 86400.0, 1) AS span_days,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) AS median_s,
               percentile_cont(0.9) WITHIN GROUP (ORDER BY gap) AS p90_s,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY gap) AS p95_s,
               max(gap) AS max_s
        FROM g
        GROUP BY parameter
        ORDER BY n DESC
        """,
        (vid,),
    )
    rows = cur.fetchall()
    print(f"  {'parameter':<34}{'n':>7}{'span':>8}"
          f"{'median':>9}{'p90':>9}{'p95':>9}{'max':>9}")
    print(f"  {'-' * 34}{'-' * 7}{'-' * 8}{'-' * 9}{'-' * 9}{'-' * 9}{'-' * 9}")
    for p, n, span, med, p90, p95, mx in rows:
        print(f"  {p[:33]:<34}{n:>7}{f'{span}d':>8}"
              f"{human(med):>9}{human(p90):>9}{human(p95):>9}{human(mx):>9}")
    return {p: (med, p90) for p, n, span, med, p90, p95, mx in rows}


def gps_histogram(cur, vid):
    section("2. GPS CADENCE  (Latitude gaps — resolves 10s vs 10min)")
    cur.execute(
        """
        WITH g AS (
            SELECT EXTRACT(EPOCH FROM ts - lag(ts) OVER (ORDER BY ts)) AS gap
            FROM readings WHERE vehicle_id = %s AND parameter = %s
        )
        SELECT count(*) FILTER (WHERE gap <= 30)                  AS le_30s,
               count(*) FILTER (WHERE gap > 30  AND gap <= 120)   AS le_2m,
               count(*) FILTER (WHERE gap > 120 AND gap <= 720)   AS le_12m,
               count(*) FILTER (WHERE gap > 720 AND gap <= 3600)  AS le_1h,
               count(*) FILTER (WHERE gap > 3600)                 AS gt_1h,
               count(*) FILTER (WHERE gap IS NOT NULL)            AS total
        FROM g
        """,
        (vid, LAT),
    )
    le30, le2, le12, le1h, gt1h, total = cur.fetchone()
    if not total:
        print("  (no GPS data)")
        return
    for label, c in [("<= 30 s", le30), ("30 s – 2 min", le2),
                     ("2 – 12 min", le12), ("12 min – 1 h", le1h),
                     ("> 1 h", gt1h)]:
        pct = 100 * c / total
        bar = "#" * int(pct / 2)
        print(f"  {label:<14}{c:>6}  {pct:5.1f}%  {bar}")
    print(f"  {'total gaps':<14}{total:>6}")


def pto_pattern(cur, vid):
    section("3. PTO ACTIVE  (0/1 — heartbeat vs change-only?)")
    cur.execute(
        """
        WITH s AS (
            SELECT ts, value, lag(value) OVER (ORDER BY ts) AS prev
            FROM readings WHERE vehicle_id = %s AND parameter = %s
        )
        SELECT count(*) AS total,
               count(*) FILTER (WHERE value = 1) AS on_n,
               count(*) FILTER (WHERE value = 0) AS off_n,
               count(*) FILTER (WHERE prev IS NOT NULL AND value IS DISTINCT FROM prev)
                   AS transitions,
               count(*) FILTER (WHERE prev IS NOT NULL AND value = prev)
                   AS repeats
        FROM s
        """,
        (vid, PTO_ACTIVE),
    )
    total, on_n, off_n, trans, repeats = cur.fetchone()
    if not total:
        print("  (no PTO Active data)")
        return
    print(f"  total samples      : {total}")
    print(f"  value = 1 (on)     : {on_n}  ({100*on_n/total:.0f}%)")
    print(f"  value = 0 (off)    : {off_n}  ({100*off_n/total:.0f}%)")
    print(f"  state transitions  : {trans}")
    print(f"  repeat samples     : {repeats}  (same value as the one before)")
    verdict = ("periodic heartbeat + change events"
               if repeats > trans else "change-only (event-style)")
    print(f"  -> pattern looks like: {verdict}")


def authoritative_vs_derived(cur, vid, tz):
    section("4. WORK TIME: authoritative counter  vs  what samples can see")
    print("  run_min  = PTO Run Minute counter delta (what /api/usage trusts)")
    print("  pto_on   = number of PTO-Active=1 samples that local day")
    print("  on_span  = minutes between first & last PTO=1 sample that day")
    print("  c_smpls  = how many counter samples exist that day\n")
    cur.execute(
        """
        WITH cnt AS (
            SELECT (ts AT TIME ZONE %s)::date AS d,
                   min(value) AS cmin, max(value) AS cmax, count(*) AS n
            FROM readings WHERE vehicle_id = %s AND parameter = %s
            GROUP BY 1
        ),
        delta AS (
            SELECT d, n,
                   GREATEST(cmax - COALESCE(lag(cmax) OVER (ORDER BY d), cmin), 0) AS run_min
            FROM cnt
        ),
        pto AS (
            SELECT (ts AT TIME ZONE %s)::date AS d,
                   count(*) FILTER (WHERE value = 1) AS on_samples,
                   min(ts) FILTER (WHERE value = 1) AS first_on,
                   max(ts) FILTER (WHERE value = 1) AS last_on
            FROM readings WHERE vehicle_id = %s AND parameter = %s
            GROUP BY 1
        )
        SELECT d.d, d.run_min, d.n,
               COALESCE(p.on_samples, 0),
               round(EXTRACT(EPOCH FROM p.last_on - p.first_on) / 60.0)
        FROM delta d LEFT JOIN pto p USING (d)
        ORDER BY d.d
        """,
        (tz, vid, PTO_RUN, tz, vid, PTO_ACTIVE),
    )
    rows = cur.fetchall()
    print(f"  {'day':<12}{'run_min':>9}{'c_smpls':>9}{'pto_on':>9}{'on_span':>9}   flag")
    print(f"  {'-' * 12}{'-' * 9}{'-' * 9}{'-' * 9}{'-' * 9}")
    worked_days = 0
    for d, run_min, c_smpls, pto_on, on_span in rows:
        flag = ""
        if run_min and c_smpls <= 1:
            flag = "<- work, but <=1 counter sample (undersampled)"
        elif run_min and pto_on == 0:
            flag = "<- counter shows work the PTO samples never saw"
        if run_min:
            worked_days += 1
        span_txt = f"{on_span:.0f}" if on_span is not None else "—"
        print(f"  {str(d):<12}{run_min:>9.0f}{c_smpls:>9}{pto_on:>9}"
              f"{span_txt:>9}   {flag}")
    print(f"\n  Days with PTO run-minutes recorded: {worked_days} of {len(rows)}")


def adequacy(cur, medians):
    section("5. ADEQUACY VERDICT  (current cadence vs what the use needs)")
    # (signal, dashboard use, required typical gap in seconds)
    reqs = [
        (LAT, "Route map: see stops & short trips", 60),
        (PTO_ACTIVE, "Route/RPM labelling of work", 120),
        (PTO_RUN, "Daily/weekly usage totals", 86400),
        (PTO_RUN, "Intra-day / hourly work profile", 300),
    ]
    print(f"  {'signal':<22}{'use':<36}{'median':>8}{'need':>8}  verdict")
    print(f"  {'-' * 22}{'-' * 36}{'-' * 8}{'-' * 8}")
    for sig, use, need in reqs:
        med = medians.get(sig, (None, None))[0]
        if med is None:
            verdict = "NO DATA"
        elif med <= need:
            verdict = "PASS"
        elif med <= need * 3:
            verdict = "MARGINAL"
        else:
            verdict = "INADEQUATE"
        print(f"  {sig[:21]:<22}{use:<36}{human(med):>8}{human(need):>8}  {verdict}")


def main():
    with connect() as conn, conn.cursor() as cur:
        vid, name, tz = _sole_vehicle(cur)
        print(f"Data-fidelity diagnostic for: {name} ({vid})   timezone: {tz}")
        medians = per_parameter_cadence(cur, vid)
        gps_histogram(cur, vid)
        pto_pattern(cur, vid)
        authoritative_vs_derived(cur, vid, tz)
        adequacy(cur, medians)
        print("\nDone. (read-only — nothing was written)")


if __name__ == "__main__":
    main()
