// Maintenance thresholds for the machine-health points.
//
// ⚠️ PLACEHOLDER VALUES — these are NOT real service intervals. They exist only
// so the maintenance page has something to colour against. Replace every `warn`
// and `limit` below with the manufacturer's actual maintenance schedule before
// anyone makes a real maintenance decision from this screen.
//
// Model (kept deliberately simple for the pilot): each point is a lifetime
// cumulative counter. We compare the last-known value against two thresholds:
//   value >= limit  -> red    ("service due")
//   value >= warn   -> amber  ("service soon")
//   else            -> green  ("ok")
// `kind` controls units only: "minutes" = lifetime run-minutes (shown as hours),
// "count" = lifetime cycle/event count, "km"/"hours" = displayed as-is.
//
// Each point's value comes from one of three places, tried in order (see
// resolvePointValue): the real trial vehicle's derived cycle count
// (`cycleKey`, real vehicles only — see api.py's /api/cycle-counts), its real
// last-known tag (`altKey`), or the original demo-fleet tag (`key`). A point
// with neither a cycle-count nor a reading under either name has no data for
// this vehicle and is hidden rather than shown as a permanent "no reading".
//
// This mirrors the points shown on the Machine health page
// (see pages/HealthPage.jsx); keep the two lists in step.
// `labelKey`/`titleKey` (added 2026-09-13) are translation keys used by the
// live HealthPage/Gauge UI; `label`/`title` stay as plain English strings,
// unchanged, since ReportDialog.jsx (the PDF report - not yet translated)
// still reads those directly. Update both when adding/renaming a point.
export const MAINTENANCE_POINTS = [
  { key: "PTO Run Minute (min)", altKey: "pto_active_minutes_revlive",
    label: "PTO", labelKey: "health.points.pto", kind: "minutes", warn: 30000, limit: 50000 },
  { key: "Vacuum Pump Run Minute (min)", altKey: "vacuum_pump_active_minutes_revlive",
    label: "Vacuum Pump", labelKey: "health.points.vacuumPump", kind: "minutes", warn: 24000, limit: 40000 },
  { key: "Jet Pump Run Minute (min)", altKey: "jetting_active_minutes_revlive",
    label: "Jetting Pump", labelKey: "health.points.jettingPump", kind: "minutes", warn: 18000, limit: 30000 },
  { key: "Recycle Pump Run Minute (min)", altKey: "recycling_pump_active_minutes_revlive",
    label: "Recycle Pump", labelKey: "health.points.recyclePump", kind: "minutes", warn: 18000, limit: 30000 },
  { key: "Piston Moves Completed (times)", cycleKey: "piston_moves",
    label: "Piston Moves Completed", labelKey: "health.points.pistonMovesCompleted", kind: "count", warn: 80000, limit: 120000 },
  { key: "Cassette Fully extended Count (times)", cycleKey: "cassette_movements",
    label: "Cassette Movements", labelKey: "health.points.cassetteMovements", kind: "count", warn: 60000, limit: 100000 },
  { key: "Rear Cover Open Count (times)", cycleKey: "rear_cover_openings",
    label: "Rear Cover Openings", labelKey: "health.points.rearCoverOpenings", kind: "count", warn: 8000, limit: 12000 },
  // Real trial vehicle only - no demo-fleet equivalent tracked today.
  { key: "scania_vehicle_km_revlive", label: "Chassis Mileage", labelKey: "health.points.chassisMileage", kind: "km", warn: 200000, limit: 250000 },
  { key: "scania_total_hours_revlive", label: "Engine Hours", labelKey: "health.points.engineHours", kind: "hours", warn: 8000, limit: 10000 },
  // Coolant/oil temp thresholds aren't in Revive's own service-plan docs
  // (those cover the Warrior body/hydraulics, not the Scania chassis engine)
  // and haven't been confirmed against Scania's engine spec - typical diesel
  // truck warning/critical bands, pending engineering sign-off.
  //
  // Checked 2026-09-09 - both tags read a flat 0 on Warrior 75 the whole time
  // despite the engine clearly running (truck_rpm up to 2160 in the same
  // window), so this looks like an unwired/unscaled sensor rather than a
  // real reading. Kept here (thresholds, `pending` flag) but deliberately
  // NOT referenced by any MAINTENANCE_GROUPS entry below, so they're hidden
  // rather than shown as a misleading 0°C gauge - add their keys back to the
  // "Engine" group once values are confirmed scaled/real.
  { key: "scania_coolant_temp_revlive", label: "Coolant Temp", labelKey: "health.points.coolantTemp", kind: "celsius", warn: 100, limit: 108, pending: true },
  { key: "scania_oil_temp_revlive", label: "Oil Temp", labelKey: "health.points.oilTemp", kind: "celsius", warn: 120, limit: 130, pending: true },
];

// Grouping for the maintenance view: PTO + the pumps, the body / cycle
// counters, then engine (mileage, hours - temps hidden for now, see above).
// Keys reference MAINTENANCE_POINTS above. A group with no data for the
// current vehicle (every key hidden) is skipped entirely - see
// HealthPage.jsx's visibleGroups.
export const MAINTENANCE_GROUPS = [
  {
    title: "PTO & Pumps", titleKey: "health.groups.ptoAndPumps",
    keys: [
      "PTO Run Minute (min)",
      "Vacuum Pump Run Minute (min)",
      "Jet Pump Run Minute (min)",
      "Recycle Pump Run Minute (min)",
    ],
  },
  {
    title: "Body & Cycles", titleKey: "health.groups.bodyAndCycles",
    keys: [
      "Piston Moves Completed (times)",
      "Cassette Fully extended Count (times)",
      "Rear Cover Open Count (times)",
    ],
  },
  // Its own panel, shown right after Body & Cycles - unlike that group this
  // is a last-known reading (not from /api/cycle-counts), so it's kept out
  // of the period-picker panel rather than merged into it (see
  // PERIOD_SCOPED_GROUP's comment in HealthPage.jsx).
  {
    title: "Chassis Mileage", titleKey: "health.groups.chassisMileage",
    keys: ["scania_vehicle_km_revlive"],
  },
  {
    title: "Engine", titleKey: "health.groups.engine",
    // scania_coolant_temp_revlive / scania_oil_temp_revlive intentionally
    // left out - see the comment on their MAINTENANCE_POINTS entries above.
    keys: [
      "scania_total_hours_revlive",
    ],
  },
];

// The "OTR" probe alarms (0/1, 1 = fault/out-of-range - same alm_* polarity
// as alm_low_oil/alm_high_oil_temp elsewhere) - confirmed 2026-09-09 all live
// and steadily 0 (no current fault) on Warrior 75. Rendered as a status grid
// on the Health page, not a Gauge - there's no meaningful scale for a 0/1
// fault flag. Real trial vehicle only, no demo-fleet equivalent.
export const SENSOR_PROBES = [
  { key: "alm_cyclone_probe_otr_revlive", label: "Cyclone Probe", labelKey: "health.probes.cycloneProbe" },
  { key: "alm_dynaset_probe_otr_revlive", label: "Dynaset Probe", labelKey: "health.probes.dynasetProbe" },
  { key: "alm_frontlvl_probe_otr_revlive", label: "Front Level Probe", labelKey: "health.probes.frontLevelProbe" },
  { key: "alm_hydpress_probe_otr_revlive", label: "Hydraulic Pressure Probe", labelKey: "health.probes.hydraulicPressureProbe" },
  { key: "alm_jet_probe_otr_revlive", label: "Jetting Probe", labelKey: "health.probes.jettingProbe" },
  { key: "alm_piston_probe_otr_revlive", label: "Piston Probe", labelKey: "health.probes.pistonProbe" },
  { key: "alm_rearlvl_probe_otr_revlive", label: "Rear Level Probe", labelKey: "health.probes.rearLevelProbe" },
  { key: "alm_vac_probe_otr_revlive", label: "Vacuum Probe", labelKey: "health.probes.vacuumProbe" },
];

// A probe's status from its raw 0/1 value: "green" (OK), "red" (fault) or
// "unknown" (no reading yet) - never "amber", there's no in-between state
// for a fault flag.
export function probeStatus(value) {
  if (value == null) return "unknown";
  return value === 1 ? "red" : "green";
}

// Resolve a parameter key to its maintenance point (label, kind, warn, limit).
const _POINT_BY_KEY = Object.fromEntries(MAINTENANCE_POINTS.map((p) => [p.key, p]));
export const pointByKey = (key) => _POINT_BY_KEY[key];

// A point's current value: the real vehicle's derived cycle count (if this
// point has one and cycleCounts has loaded), else its real last-known tag,
// else the demo-fleet tag. Returns null when none of those has data - the
// point is not present on this vehicle.
export function resolvePointValue(point, readings, cycleCounts) {
  if (point.cycleKey && cycleCounts && cycleCounts[point.cycleKey] != null) {
    return cycleCounts[point.cycleKey];
  }
  if (point.altKey && readings[point.altKey]) return readings[point.altKey].value;
  if (readings[point.key]) return readings[point.key].value;
  return null;
}

// Map a last-known value to a status against its placeholder thresholds.
// Returns one of: "green" | "amber" | "red" | "unknown" (no reading yet).
export function maintenanceStatus(value, warn, limit) {
  if (value == null) return "unknown";
  if (value >= limit) return "red";
  if (value >= warn) return "amber";
  return "green";
}

// Human label for a status — what the chip says next to the dot.
export const STATUS_TEXT = {
  green: "OK",
  amber: "Service soon",
  red: "Service due",
  unknown: "No reading",
};

// Format a counter value for display. Minutes are shown as whole hours (the
// counters are lifetime, so the minute remainder is noise at this scale).
export function formatPointValue(value, kind) {
  if (value == null) return "—";
  if (kind === "minutes") {
    return `${Math.round(value / 60).toLocaleString("en-GB")} h`;
  }
  if (kind === "km") return `${Math.round(value).toLocaleString("en-GB")} km`;
  if (kind === "hours") return `${Math.round(value).toLocaleString("en-GB")} h`;
  if (kind === "celsius") return `${Math.round(value)}°C`;
  return `${Math.round(value).toLocaleString("en-GB")} ×`;
}

// Fraction of the way to the `limit` threshold, clamped to [0, 1] — drives the
// progress bar width on the maintenance page.
export function progressToLimit(value, limit) {
  if (value == null || !limit) return 0;
  return Math.max(0, Math.min(1, value / limit));
}
