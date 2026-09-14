import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCycleCounts } from "../api.js";
import {
  MAINTENANCE_GROUPS, MAINTENANCE_POINTS, pointByKey, maintenanceStatus, resolvePointValue,
  SENSOR_PROBES, probeStatus,
} from "../maintenance.js";
import Gauge from "../components/Gauge.jsx";
import KpiStrip from "../components/KpiStrip.jsx";
import { IconHealth, IconGauge, IconClock } from "../components/Icons.jsx";

// TEMPORARY (Joe, 2026-09-14): hidden pending something to test tomorrow -
// not a data/approval issue, just hidden from view for now. Flip back to
// `true` once that's done; nothing else about the panel changed.
const SHOW_CYCLE_COUNTS = false;
// TEMPORARY (Joe, 2026-09-14): hidden for now, same reasoning as above.
const SHOW_THRESHOLDS_NOTE = false;

// Its own panel (see maintenance.js's Body & Cycles group), kept apart from
// the main Machine Health panel below since its counts come from a separate
// endpoint (/api/cycle-counts) rather than a last-known reading in
// `readings`. Approved 2026-09-14 (Joe) - was period-scoped with its own
// Day/Week/Month/Range picker pending approval; now always shows the
// vehicle's full-history cumulative count instead (omitting start/end asks
// the endpoint for exactly that - see its own docstring).
const PERIOD_SCOPED_GROUP = "Body & Cycles";
// Its own panel (see maintenance.js), kept out of both the static Machine
// Health panel and the period-picker panel.
const CHASSIS_MILEAGE_GROUP = "Chassis Mileage";

// Machine health: lifetime counters grouped into sections, each shown as a gauge
// against its (placeholder) service threshold. A summary strip counts how many
// points are OK / due soon / overdue. Read-only, last-known.
//
// Real trial vehicle (source "live"/"trial_demo"): the piston/cassette/rear-
// cover points come from /api/cycle-counts (derived from the boolean
// activation tags), the run-time and mileage points from their real tags in
// `readings` (see maintenance.js's altKey). Demo fleet: everything comes from
// its own pre-aggregated lifetime-counter tags, unchanged from before - and
// since it never has a picker either, it stays a single panel (see `real`
// checks below).
export default function HealthPage({ readings, vehicle, fmtDate }) {
  const { t } = useTranslation();
  const [cycleCounts, setCycleCounts] = useState(null);
  const real = vehicle?.source === "live" || vehicle?.source === "trial_demo";

  useEffect(() => {
    setCycleCounts(null);
    if (!real || !vehicle) return;
    let live = true;
    // No start/end - the vehicle's full-history cumulative count.
    getCycleCounts(vehicle.vehicle_id)
      .then((r) => live && setCycleCounts(r)).catch(() => {});
    return () => { live = false; };
  }, [vehicle, real]);

  const cc = real ? cycleCounts : null;
  const valueOf = (key) => resolvePointValue(pointByKey(key), readings, cc);

  // Skip any group where every point is absent for this vehicle (e.g. the
  // demo fleet has no mileage tags; "Recycle pump" per the spec is shown only
  // where the unit has that pump) rather than showing a permanent "no reading".
  const visibleGroups = MAINTENANCE_GROUPS
    .map((g) => ({ ...g, keys: g.keys.filter((k) => valueOf(k) != null) }))
    .filter((g) => g.keys.length > 0);
  const visibleKeys = visibleGroups.flatMap((g) => g.keys);

  // Only split into a static panel + a period panel when there's a picker to
  // justify the split (real/trial vehicles). Otherwise everything stays
  // together, exactly as before.
  const staticGroups = visibleGroups.filter((g) =>
    g.title !== CHASSIS_MILEAGE_GROUP && !(real && g.title === PERIOD_SCOPED_GROUP)
  );

  // The period panel's own group, computed separately from visibleGroups
  // (not filtered out of it) - its keys only resolve once cycleCounts has
  // loaded, which only happens once the picker below has fired at least once.
  // Gating the picker's panel on this group already having data would be a
  // deadlock: no picker mounted -> no period set -> no fetch -> no data ->
  // panel never shown -> picker never mounts. So for real vehicles the panel
  // (and the picker in it) always renders; only the gauges inside wait on data.
  const bodyCyclesGroup = MAINTENANCE_GROUPS.find((g) => g.title === PERIOD_SCOPED_GROUP);
  const bodyCyclesKeys = real ? bodyCyclesGroup.keys.filter((k) => valueOf(k) != null) : [];

  // Its own panel, shown right after Body & Cycles - see maintenance.js.
  const chassisMileageGroup = MAINTENANCE_GROUPS.find((g) => g.title === CHASSIS_MILEAGE_GROUP);
  const chassisMileageKeys = chassisMileageGroup.keys.filter((k) => valueOf(k) != null);

  // Sensor probes: real-vehicle-only status flags, no demo-fleet equivalent,
  // never period-scoped (last-known status only). Hidden from this
  // customer-facing trial view (Joe, 2026-09-11) - not deleted, since it's a
  // real capability worth keeping for Revive Live's own internal tooling
  // later, just not something to show Veolia unrequested. `visibleProbes`
  // still feeds the KPI tally below even though the grid itself isn't
  // rendered.
  const visibleProbes = SENSOR_PROBES
    .map((p) => ({ ...p, value: readings[p.key]?.value ?? null, ts: readings[p.key]?.ts ?? null }))
    .filter((p) => p.value != null);

  const newest = MAINTENANCE_POINTS
    .filter((p) => visibleKeys.includes(p.key) && readings[p.altKey ?? p.key])
    .map((p) => readings[p.altKey ?? p.key])
    .reduce((m, r) => (r.ts > m ? r.ts : m), "");

  // Status tally across every visible point, plus the sensor probes (a fault
  // counts toward "service due" just like an over-threshold gauge would).
  const tally = { green: 0, amber: 0, red: 0, unknown: 0 };
  for (const key of visibleKeys) {
    const p = pointByKey(key);
    tally[maintenanceStatus(valueOf(key), p.warn, p.limit)]++;
  }
  for (const p of visibleProbes) tally[probeStatus(p.value)]++;
  const kpis = [
    { key: "ok", label: t("health.kpi.healthy.label"), Icon: IconHealth, value: tally.green, note: t("health.kpi.healthy.note"), accent: tally.red === 0 },
    { key: "soon", label: t("health.kpi.serviceSoon.label"), Icon: IconClock, value: tally.amber, note: t("health.kpi.serviceSoon.note") },
    { key: "due", label: t("health.kpi.serviceDue.label"), Icon: IconGauge, value: tally.red, note: t("health.kpi.serviceDue.note") },
    { key: "tracked", label: t("health.kpi.pointsTracked.label"), Icon: IconGauge, value: visibleKeys.length + visibleProbes.length, note: t("health.kpi.pointsTracked.note") },
  ];

  const gaugeGroup = (group) => (
    <div className="mnt-section" key={group.titleKey}>
      <h3>{t(group.titleKey)}</h3>
      <div className="mnt-gauges">
        {group.keys.map((key) => {
          const { labelKey, kind, warn, limit, pending } = pointByKey(key);
          const value = valueOf(key);
          const status = maintenanceStatus(value, warn, limit);
          return (
            <Gauge key={key} compact label={t(labelKey)} kind={kind} value={value}
              warn={warn} limit={limit} status={status} pending={pending} />
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <KpiStrip items={kpis} />
      <div className="panel">
        <div className="panel-head mnt-h2">
          {t("health.title")}
          {newest && <span className="stamp">{t("health.updated", { date: fmtDate(newest) })}</span>}
        </div>
        {SHOW_THRESHOLDS_NOTE && <div className="mnt-note">{t("health.thresholdsPlaceholder")}</div>}
        <div className="mnt-sections">
          {staticGroups.map(gaugeGroup)}
        </div>
      </div>

      {real && SHOW_CYCLE_COUNTS && (
        <div className="panel">
          <div className="panel-head mnt-h2">{t("health.cycleCounts.title")}</div>
          <div className="mnt-note">
            {t("health.cycleCounts.note")}
          </div>
          <div className="mnt-sections">
            {bodyCyclesKeys.length > 0
              ? gaugeGroup({ titleKey: bodyCyclesGroup.titleKey, keys: bodyCyclesKeys })
              : <div className="empty">{t("common.loading")}</div>}
          </div>
        </div>
      )}

      {chassisMileageKeys.length > 0 && (
        <div className="panel">
          <div className="panel-head mnt-h2">{t("health.groups.chassisMileage")}</div>
          <div className="mnt-sections">
            {gaugeGroup({ titleKey: chassisMileageGroup.titleKey, keys: chassisMileageKeys })}
          </div>
        </div>
      )}
    </>
  );
}
