// Pump run-time — the shared source of truth for the Overview pump cards.
//
// PTO is the enabling envelope. When PTO is on it *allows* the three pumps to
// run, but they may not be: there are stretches of PTO idling (engine burning
// fuel under PTO with no pump engaged) — a real inefficiency. So PTO time splits
// into two mutually-exclusive states:
//
//   PTO time = WORKING (≥1 pump running) + IDLE (PTO on, no pump)
//
// That split is a clean either/or partition, so working and idle CAN be summed
// honestly. The three pumps, by contrast, OVERLAP in time (vacuum runs most of
// the working window; jet and recycle run intermittently inside it), so their
// run-minutes are NEVER summed/stacked — each is measured independently against
// PTO (CLAUDE.md non-negotiable #3).

import { getUsage, getPtoWorking } from "./api.js";

// The PTO counter (envelope) and the idle counter (PTO on, no pump) — both come
// straight from the ingested cumulative counters via /api/usage.
// `label` stays plain English (ReportDialog.jsx has its own separate PUMPS
// array, so nothing else reads these); `labelKey` is what the live UI
// translates via t().
export const PTO = { key: "PTO Run Minute (min)", field: "pto", label: "PTO", labelKey: "pumps.labels.pto" };
export const IDLE = { key: "PTO Idle Run Minute (min)", field: "idle", label: "PTO Idle", labelKey: "pumps.labels.idle" };

// The three pumps that run inside a working window. `field` is the merged-row
// key; `color` is a useChartTheme() role; `sw` is the CSS legend-swatch modifier.
export const PUMPS = [
  { key: "Vacuum Pump Run Minute (min)", field: "vacuum", label: "Vacuum", labelKey: "pumps.labels.vacuum", color: "blue", sw: "vac" },
  { key: "Jet Pump Run Minute (min)", field: "jet", label: "Jet", labelKey: "pumps.labels.jet", color: "violet", sw: "jet" },
  // Re-added 2026-06-20: No.75 actually runs its recycle pump (No.66 never has —
  // it just shows the empty state for vehicles that don't use it).
  { key: "Recycle Pump Run Minute (min)", field: "recycle", label: "Recycle", labelKey: "pumps.labels.recycle", color: "teal", sw: "recycle" },
];

// The real trial vehicle's equivalent cumulative counters (confirmed
// 2026-09-08). There is no real "PTO idle" counter to match IDLE above —
// /api/pto-working derives working time from the on/off state signals
// instead, and idle is computed as pto - working (see fetchPumpUsage).
export const REAL_PTO = { key: "pto_active_minutes_revlive", field: "pto", label: "PTO", labelKey: "pumps.labels.pto" };
export const REAL_PUMPS = [
  { key: "vacuum_pump_active_minutes_revlive", field: "vacuum", label: "Vacuum", labelKey: "pumps.labels.vacuum", color: "blue", sw: "vac" },
  { key: "jetting_active_minutes_revlive", field: "jet", label: "Jet", labelKey: "pumps.labels.jet", color: "violet", sw: "jet" },
  { key: "recycling_pump_active_minutes_revlive", field: "recycle", label: "Recycle", labelKey: "pumps.labels.recycle", color: "teal", sw: "recycle" },
];

// Fetch PTO, idle and the three pumps for a vehicle/grain and merge into one row
// per bucket, keyed by the *union* of dates across every counter (missing → 0)
// so a counter that started reporting later doesn't shift the others. A counter
// with no data just comes back empty, leaving its field 0 everywhere.
//
// Returns { rows: [{ bucket, pto, idle, vacuum, jet, recycle }], present } where
// `present[field]` is true only if that pump has any non-zero reading — an absent
// pump is omitted rather than drawn as an always-zero "ran nothing" bar.
export async function fetchPumpUsage(vehicleId, grain, vehicle) {
  // "live" (the real truck) and "trial_demo" (its rehearsal seed data, built
  // from the same real tag names ahead of the truck existing) both use the
  // _revlive convention; only the original "demo" fleet uses the old names.
  const real = vehicle?.source === "live" || vehicle?.source === "trial_demo";
  const pumps = real ? REAL_PUMPS : PUMPS;
  const series = real ? [REAL_PTO, ...REAL_PUMPS] : [PTO, IDLE, ...PUMPS];

  const results = await Promise.all(
    series.map((s) =>
      getUsage(s.key, grain, vehicleId)
        .then((r) => ({ s, buckets: r.buckets }))
        .catch(() => ({ s, buckets: [] }))
    )
  );

  const byBucket = new Map();
  const get = (bucket) => {
    if (!byBucket.has(bucket)) {
      byBucket.set(bucket, { bucket, pto: 0, idle: 0, vacuum: 0, jet: 0, recycle: 0 });
    }
    return byBucket.get(bucket);
  };
  for (const { s, buckets } of results) {
    for (const b of buckets) get(b.bucket)[s.field] = b.minutes;
  }

  // Real vehicles: no idle counter exists, so derive it from working time
  // (state-signal based, overlap-safe — see /api/pto-working) instead of
  // reading a counter that doesn't exist. Floored at 0 for the same reason
  // workingMin below floors — small discrepancies between two independently
  // sampled sources should never show as a negative duration.
  if (real) {
    const { buckets } = await getPtoWorking(grain, vehicleId).catch(() => ({ buckets: [] }));
    for (const b of buckets) {
      const row = get(b.bucket);
      row.idle = Math.max(0, row.pto - b.minutes);
    }
  }

  const rows = [...byBucket.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));

  // "Ever shown a non-zero reading" is a reasonable fitted/not-fitted proxy
  // for the demo fleet, where different synthetic vehicle models genuinely
  // lack certain pumps. It's the wrong test for the one real vehicle, whose
  // full equipment list is already known from its confirmed tag catalog —
  // early in a trial, a fitted pump may legitimately have zero usage so far,
  // which isn't the same as "not fitted".
  const present = {};
  for (const p of pumps) present[p.field] = real || rows.some((r) => r[p.field] > 0);

  return { rows, present };
}

// Working minutes for a row = PTO time minus idle time, floored at 0 (guards the
// rare case where bucketing leaves idle marginally above PTO).
export const workingMin = (r) => Math.max(0, r.pto - r.idle);

// Utilisation over a set of merged rows. Splits PTO time into working vs idle
// (a true partition — the honest inefficiency headline), and separately gives
// each pump's share of PTO time (independent, never summed across pumps). `pct`
// values are null when there is no PTO time in the window (divide-by-zero) —
// callers show "—", never a fabricated ratio.
export function computeUtilisation(rows) {
  const ptoMinutes = rows.reduce((a, r) => a + r.pto, 0);
  const idleMinutes = rows.reduce((a, r) => a + r.idle, 0);
  const workingMinutes = Math.max(0, ptoMinutes - idleMinutes);
  const share = (m) => (ptoMinutes > 0 ? (m / ptoMinutes) * 100 : null);

  const pumps = {};
  for (const p of PUMPS) {
    const minutes = rows.reduce((a, r) => a + r[p.field], 0);
    pumps[p.field] = { minutes, pct: share(minutes) };
  }
  return {
    ptoMinutes,
    idleMinutes,
    workingMinutes,
    idlePct: share(idleMinutes),
    workingPct: share(workingMinutes),
    pumps,
  };
}
