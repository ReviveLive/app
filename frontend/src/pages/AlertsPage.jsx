import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getAlerts } from "../api.js";
import { estopInfo, overrideInfo, faultInfo } from "../alerts.js";
import { SENSOR_PROBES, probeStatus } from "../maintenance.js";
import KpiStrip from "../components/KpiStrip.jsx";
import InfoTip from "../components/InfoTip.jsx";
import { SkelRows } from "../components/Skeleton.jsx";
import { IconAlerts, IconBolt } from "../components/Icons.jsx";

// Alerts — safety/override events for the vehicle:
//   1. Emergency stops (real for the trial vehicle via alm_safety_tripped_revlive,
//      simulated for the demo fleet - see alerts.js's ESTOP_CATALOG).
//   2. Operational overrides (real for the trial vehicle, simulated for the
//      demo fleet - see alerts.js's OVERRIDE_CATALOG).
//   3. Machine faults (real trial vehicle only, spec section 4 - see
//      alerts.js's FAULT_CATALOG).
// The anomaly-detection scaffold is hidden here rather than shown as a
// permanent "in build" note (2026-09-11).
//
// TEST-ONLY (Joe, 2026-09-11): the Sensor Health grid (SENSOR_PROBES, same
// data as the Health page's hidden panel - see maintenance.js) is shown here
// too, but ONLY for Warrior-75-Demo (vehicle.source === "trial_demo"), so
// probe data can be seeded and checked without exposing it on the real
// Veolia trial vehicle. Remove this once testing is done, or once it has a
// permanent home.

// Live current-state snapshot (not history - see the Log panels below for
// that) for the four real alm_* alarm tags, split by how they're triggered
// (Joe's supervisor, 2026-09-11): manual (a person presses/trips something)
// vs automatic (a threshold sensor). Same red/green dot convention as the
// vehicle online/offline status pill in the top bar (see App.jsx's
// .status-pill/.status-dot).
const MANUAL_ALARMS = [
  { key: "alm_low_overide_revlive", i18nKey: "lowLevelOverride" },
  { key: "alm_safety_tripped_revlive", i18nKey: "safetyCircuit" },
];
const AUTOMATIC_ALARMS = [
  { key: "alm_low_oil_revlive", i18nKey: "oilLevel" },
  { key: "alm_high_oil_temp_revlive", i18nKey: "oilTemperature" },
];

function AlarmStatusRow({ item, readings }) {
  const { t } = useTranslation();
  const value = readings?.[item.key]?.value ?? null;
  const active = value === 1;
  const cls = value == null ? "status-unknown" : active ? "status-alarm" : "status-clear";
  const text = value == null ? t("alerts.alarmStatus.noData") : active ? t(`alerts.alarms.${item.i18nKey}.activeLabel`) : t("alerts.alarmStatus.ok");
  return (
    <div className="alarm-status-row">
      <span>{t(`alerts.alarms.${item.i18nKey}.label`)}</span>
      <span className={`status-pill ${cls}`}>
        <span className="status-dot" aria-hidden="true" />
        <span className="status-label">{text}</span>
      </span>
    </div>
  );
}

function EventList({ list, infoFn, dotClass, fmt }) {
  const { t } = useTranslation();
  if (list === null) return <SkelRows count={3} />;
  if (list.length === 0) return <div className="empty">{t("alerts.eventList.none")}</div>;
  return (
    <ul className="estop-list">
      {list.map((e, i) => {
        const info = infoFn(e.type);
        return (
          <li className="estop-row" key={`${e.ts}-${e.type}-${i}`}>
            <span className={"estop-dot" + (dotClass ? ` ${dotClass}` : "")} aria-hidden="true" />
            <div className="estop-text">
              <div className="estop-title">{info.labelKey ? t(info.labelKey) : info.label}</div>
              <div className="estop-cause">{info.causeKey ? t(info.causeKey) : info.cause}</div>
            </div>
            <span className="estop-time">{fmt ? fmt(e.ts) : e.ts}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function AlertsPage({ vehicle, readings, fmt }) {
  const { t } = useTranslation();
  const vehicleId = vehicle?.vehicle_id;
  const [events, setEvents] = useState(null);
  const [overrides, setOverrides] = useState(null);
  const [faults, setFaults] = useState(null);

  // TEST-ONLY, Warrior (demo) only - see the top-of-file note. Always lists
  // every known probe (not just ones that have reported) so a user can see
  // what sensors this vehicle actually has - a probe with no reading yet
  // shows an honest "no data" state rather than silently disappearing or
  // being assumed OK (Joe, 2026-09-11).
  const showTestSensors = vehicle?.source === "trial_demo";
  const testProbes = showTestSensors
    ? SENSOR_PROBES.map((p) => ({ ...p, value: readings?.[p.key]?.value ?? null, ts: readings?.[p.key]?.ts ?? null }))
    : [];

  useEffect(() => {
    if (!vehicleId) return;
    let live = true;
    setEvents(null); setOverrides(null); setFaults(null);
    getAlerts(vehicleId)
      .then((r) => live && (setEvents(r.events || []), setOverrides(r.overrides || []), setFaults(r.faults || [])))
      .catch(() => live && (setEvents([]), setOverrides([]), setFaults([])));
    return () => { live = false; };
  }, [vehicleId]);

  const kpis = [
    { key: "estop", label: t("alerts.kpi.emergencyStops.label"), Icon: IconBolt, value: events?.length ?? "—", note: t("alerts.kpi.emergencyStops.note") },
    { key: "ovr", label: t("alerts.kpi.overrides.label"), Icon: IconAlerts, value: overrides?.length ?? "—", note: t("alerts.kpi.overrides.note") },
    { key: "fault", label: t("alerts.kpi.machineFaults.label"), Icon: IconAlerts, value: faults?.length ?? "—", note: t("alerts.kpi.machineFaults.note") },
  ];

  return (
    <>
      <KpiStrip items={kpis} />

      <div className="panel">
        <div className="panel-head">{t("alerts.alarmStatus.title")}</div>
        <div className="grid g2">
          <div>
            <div className="alarm-status-head">{t("alerts.alarmStatus.manual")}</div>
            {MANUAL_ALARMS.map((item) => <AlarmStatusRow key={item.key} item={item} readings={readings} />)}
          </div>
          <div>
            <div className="alarm-status-head">{t("alerts.alarmStatus.automatic")}</div>
            {AUTOMATIC_ALARMS.map((item) => <AlarmStatusRow key={item.key} item={item} readings={readings} />)}
          </div>
        </div>
      </div>

      <div className="grid g2">
        <div className="panel">
          <div className="panel-head">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              {t("alerts.emergencyStopsLog.title")}
            </span>
          </div>
          <EventList list={events} infoFn={estopInfo} fmt={fmt} />
        </div>
        <div className="panel">
          <div className="panel-head">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              {t("alerts.operationalOverridesLog.title")}
            </span>
          </div>
          <EventList list={overrides} infoFn={overrideInfo} dotClass="warn" fmt={fmt} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            {t("alerts.machineFaultsLog.title")}
          </span>
        </div>
        <EventList list={faults} infoFn={faultInfo} fmt={fmt} />
      </div>

      {/* TEST-ONLY, Warrior (demo) only - see the top-of-file note. Red
          border (.gps-pending) since Warrior-75-Demo has no probe data
          seeded yet - flags this as awaiting test data, not broken. */}
      {showTestSensors && (
        <div className="panel gps-pending">
          <div className="panel-head">{t("alerts.sensorHealth.title")}</div>
          <div className="sensor-grid">
            {testProbes.map(({ key, labelKey, value, ts }) => {
              const label = t(labelKey);
              const status = probeStatus(value);
              // Unlike OK/Fault (backed by a real 0/1 reading), "no data yet"
              // is its own honest state - amber (attention, not a fault; not
              // silently assumed OK), with a plain note instead of an
              // InfoTip, since there's no timestamp to look up.
              const noData = status === "unknown";
              return (
                <div className="sensor-chip" key={key}>
                  <div className="sensor-chip-row">
                    <span>{label}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className={`mnt-badge ${noData ? "amber" : status}`}>
                        {status === "red" ? t("alerts.sensorHealth.fault") : status === "green" ? t("alerts.sensorHealth.ok") : t("alerts.sensorHealth.noData")}
                      </span>
                      {ts && <InfoTip label={label} text={t("alerts.sensorHealth.lastReading", { when: fmt(ts) })} />}
                    </span>
                  </div>
                  {noData && <div className="sensor-chip-nodata">{t("alerts.sensorHealth.dataUnavailable")}</div>}
                </div>
              );
            })}
          </div>
          {testProbes.some((p) => p.value == null) && (
            <div className="mnt-note">
              {t("alerts.sensorHealth.noDataNote")}
            </div>
          )}
        </div>
      )}
    </>
  );
}
