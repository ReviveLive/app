
# Sustainability figures — what's real, what's calculated

`GET /api/sustainability` (`revive/api.py`) powers the Sustainability page.
This documents exactly where each figure comes from, since several are
derived rather than a direct reading — worth knowing before treating any of
them as a raw sensor value (Joe, 2026-09-11).

## Per vehicle, per figure

| Figure | Warrior-No.75-Veolia (real trial vehicle) | Warrior-75-Demo (seeded rehearsal data) | Original demo fleet |
|---|---|---|---|
| Avg working / off-task fuel rate | ✅ calculated | ✅ calculated | ✅ calculated |
| Utilisation % | ✅ calculated | ✅ calculated | ✅ calculated |
| Fuel used (L) | ✅ calculated (integrated) | ✅ calculated (counter delta) | ✅ calculated (counter delta) |
| CO₂ (kg) | ✅ calculated (estimate) | ✅ calculated (estimate) | ✅ calculated (estimate) |
| Water collected (L) | ❌ not available | ❌ not available | ✅ calculated (counter delta) |
| Water recycled (L) | ✅ calculated (from run-time) | ✅ calculated (from run-time) | ✅ calculated (counter delta) |
| Recycling rate % | ✅ calculated (minutes ratio) | ✅ calculated (minutes ratio) | ✅ calculated (volume ratio) |

**Nothing on this page is a raw sensor reading passed straight through** —
every figure is at least an average, a delta, a ratio, or an estimate. The
table above is about *data availability* (is there a real underlying signal
to calculate from at all), not about "calculated vs not".

## How each one is actually calculated

- **Avg working / off-task fuel rate** — average of real `Fuel Rate (l/h)`
  (or `scania_fuelrate_revlive`) samples, split by whether PTO or the
  vacuum pump was on at that same moment (last-known state, not a raw
  average of everything).
- **Utilisation %** — the share of those same fuel-rate samples classified
  as "working" vs total samples. Sample share is treated as a time share
  because samples are roughly evenly spaced.
- **Fuel used (L)** — two different methods depending on what the vehicle
  actually has:
  - If a real cumulative counter exists (`Total Fuel Used (l)` for the
    original demo fleet, `scania_total_fuel_used_revlive` for
    Warrior-75-Demo) — **delta**: `max(counter) − min(counter)` per period.
    This is the more accurate method when available.
  - Otherwise (Warrior-No.75-Veolia has no such counter, only a rate) —
    **integrated from the rate**: for each fuel-rate sample, `rate × hours
    until the next sample`, summed per period. Gaps longer than 30 minutes
    are capped at 30 minutes so a feed dropout can't inflate the total —
    the same technique `/api/fuel-day` already uses for the Overview Fuel
    panel.
- **CO₂ (kg)** — `fuel_used_litres × 2.68` (`DIESEL_KG_CO2_PER_L`, a fixed
  UK DEFRA-style diesel emission factor). Always an estimate, regardless of
  which fuel-used method was used above.
- **Water collected (L)** — counter delta from `Total Water Used (m3)` (×
  1000 for litres). **No real equivalent exists** — the full Flexy tag
  catalogue has no cumulative water-collected counter and no water
  flow-rate tag at all, only tank level *percentages*
  (`front_level_pcent_revlive` / `rear_level_pcent_revlive`). Comes back
  `null` for Warrior-No.75-Veolia and Warrior-75-Demo, and the frontend
  (`SustainabilityPage.jsx`) hides its KPI tile/chart entirely for any
  vehicle where it's null across the whole fetched window, rather than
  showing a broken/empty panel to a customer on first look at the product
  (2026-09-11) - this is a genuine "can't work at all" gap, not a "no data
  logged yet" one, so hiding is correct rather than an empty-state message.

  **What would be needed to implement this**: a real water-volume datapoint
  from the Flexy - either a cumulative counter (ideal, same shape as the
  fuel counter) or a flow-rate tag to integrate from (same technique as
  fuel used when there's no counter). Neither currently exists in the
  confirmed tag catalogue; this would need to go back to whoever owns the
  Warrior's PLC/Flexy tag configuration - it isn't something derivable from
  what's already being logged. A tank-level-percentage-based estimate is
  theoretically possible as a stopgap but isn't implemented - it would need
  the tank's actual capacity (not in the data anywhere) and would be
  materially less trustworthy than a real counter or rate.

- **Water recycled (L)** — counter delta from `Total Recycled Water (m3)`
  for the demo fleet. For a real-tag vehicle (no water-volume tag exists at
  all), derived instead from `recycling_pump_active_minutes_revlive`'s
  counter delta × **350 L/min** (`RECYCLE_FLOW_LPM` - the recycling
  piston's known flow rate, confirmed with the machine spec, 2026-09-11 -
  not measured from telemetry, so worth double-checking this number is
  exactly right before treating it as authoritative). Unlike water
  collected, this one **is** calculable for a real-tag vehicle, since the
  pump's run-time is already a tracked lifetime counter even without a
  volume/rate tag.

- **Recycling rate %** — `recycled_m³ / collected_m³` for the demo fleet.
  For a real-tag vehicle (no water-collected volume to divide by),
  redefined instead (Joe, 2026-09-11) as a **minutes ratio**:
  `recycling_pump_active_minutes_revlive`'s counter delta ÷
  `pto_active_minutes_revlive`'s counter delta - i.e. share of PTO-active
  time spent recycling, not a volume ratio. Both are tracked lifetime
  counters, so this works even without any water-volume tag at all.

## Performance note (2026-09-11)

The fuel-rate/utilisation query originally looked up PTO/vacuum-pump state
per fuel-rate row via a correlated `LEFT JOIN LATERAL ... LIMIT 1` (the same
pattern `/api/route`, `/api/fuel-day` and others use for "last known value
at this timestamp"). That pattern is fine when scoped to one day (a few
hundred rows), which is how every other endpoint uses it - but
`/api/sustainability` runs it over a vehicle's **entire history**, and at
~18,000 fuel-rate rows for Warrior 75 that took **32.7 seconds**
(`EXPLAIN ANALYZE` showed ~35,000 per-row lookups, most doing real
filtering work).

Rewritten as a single window-function pass instead: union the fuel/PTO/vac
readings into one ordered stream, use a running count of each signal's own
readings as a "generation" number, then join each fuel-rate row back to
whichever PTO/vac generation was current at that point (a standard
last-observation-carried-forward technique). Verified to return
byte-identical results, now **~30ms** on the same data - roughly 1000x
faster, and the cost no longer scales badly as more history accumulates
over the life of the trial.

Caching the results was considered and rejected: the underlying cost was a
bad query plan, not genuinely heavy computation, so a correct query already
solves it with no added complexity, no staleness risk, and no invalidation
logic needed (the current period's bucket changes as new readings arrive
every few minutes, which would have made a naive cache subtly wrong).
