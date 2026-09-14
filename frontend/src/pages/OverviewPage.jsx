import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getAlerts } from "../api.js";
import { deriveActivity, fmtDur } from "../activity.js";
import { localDate, fmtDay } from "../dates.js";
import { todayLocal } from "../period.js";
import { getGpsFix } from "../gps.js";
import KpiStrip from "../components/KpiStrip.jsx";
import MapPanel from "../components/MapPanel.jsx";
import RoutePanel from "../components/RoutePanel.jsx";
import PumpUtilisation from "../components/PumpUtilisation.jsx";
import FuelPanel from "../components/FuelPanel.jsx";
import TankLevel from "../components/TankLevel.jsx";
import WeightPanel from "../components/WeightPanel.jsx";
import WeatherPanel from "../components/WeatherPanel.jsx";
import DayStatusBar from "../components/DayStatusBar.jsx";
import StatusPanel from "../components/StatusPanel.jsx";
import {
  IconClock, IconGauge, IconRoute, IconAlerts, IconPin,
} from "../components/Icons.jsx";

// Activity breakdown for the focused day — Work / Travel / Idle, plus
// jobs/stops, all derived from the vehicle's own GPS route (deriveActivity).
// idleMin is 0 for a vehicle whose route has no separate idle detection, so
// that third segment simply collapses to nothing.
function ActivityPanel({ activity, hasData, mismatch }) {
  const { t } = useTranslation();
  const { workMin, travelMin, idleMin = 0, workPct, jobs, stops } = activity;
  const travelPct = activity.totalMin > 0 ? (travelMin / activity.totalMin) * 100 : 0;
  const idlePct = activity.totalMin > 0 ? (idleMin / activity.totalMin) * 100 : 0;
  return (
    <div className="panel activity-panel">
      <div className="panel-head">{t("overview.activity.title")}</div>
      {mismatch && (
        <div className="mnt-note">
          {t("overview.activity.mismatch", { requested: fmtDay(mismatch.requested), actual: fmtDay(mismatch.actual) })}
        </div>
      )}
      {!hasData ? (
        <div className="empty">{t("overview.activity.noData")}</div>
      ) : (
        <div className="activity-body">
          <div className="activity-bar">
            <div className="activity-seg work" style={{ flexBasis: `${Math.max(2, workPct)}%` }}>
              {workPct >= 12 ? `${workPct.toFixed(0)}%` : ""}
            </div>
            <div className="activity-seg travel" style={{ flexBasis: `${travelPct}%` }}>
              {travelPct >= 12 ? `${travelPct.toFixed(0)}%` : ""}
            </div>
            {idleMin > 0 && (
              <div className="activity-seg idle" style={{ flexBasis: `${idlePct}%` }}>
                {idlePct >= 12 ? `${idlePct.toFixed(0)}%` : ""}
              </div>
            )}
          </div>
          <div className="activity-legend">
            <span className="activity-stat"><span className="v">{fmtDur(workMin)}</span>
              <span className="lg"><i className="work" /> {t("overview.activity.atWork")}</span></span>
            <span className="activity-stat"><span className="v">{fmtDur(travelMin)}</span>
              <span className="lg"><i className="travel" /> {t("overview.activity.travel")}</span></span>
            {idleMin > 0 && (
              <span className="activity-stat"><span className="v">{fmtDur(idleMin)}</span>
                <span className="lg"><i className="idle" /> {t("overview.activity.idle")}</span></span>
            )}
            <span className="activity-stat">
              <span className="v">{jobs}</span><span>{t("overview.activity.jobs")}</span></span>
            <span className="activity-stat">
              <span className="v">{stops}</span><span>{t("overview.activity.stops")}</span></span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OverviewPage({ vehicleId, vehicle, readings, fmt, fmtTime, day, setDay, isLive }) {
  const { t } = useTranslation();
  const [alerts, setAlerts] = useState(null); // {events, overrides}
  const [dayPoints, setDayPoints] = useState([]);
  const [routePointsDay, setRoutePointsDay] = useState(null); // the day `dayPoints` is actually for (see RoutePanel's onData)
  // Route History and Last-Known Location merged into one toggle (2026-09-12)
  // - Routes now has its own dedicated page for the deeper history/logs, so
  // showing both full panels side by side on Overview was redundant.
  const [routeView, setRouteView] = useState("routes"); // "routes" | "location"

  useEffect(() => {
    if (!vehicleId) return;
    let live = true;
    setAlerts(null); setDayPoints([]); setRoutePointsDay(null);
    getAlerts(vehicleId).then((r) => live && setAlerts(r)).catch(() => live && setAlerts({ events: [], overrides: [] }));
    return () => { live = false; };
  }, [vehicleId]);

  // Activity (work/travel/jobs/stops) is always route-derived from real GPS
  // now (deriveActivity) - every vehicle reports real gps_lat/gps_lon-style
  // fixes (confirmed 2026-09-12: the WarriorSimulator test vehicle carries
  // the same real tag data Warrior 75 does). This used to branch on a
  // GPS-free /api/activity-day fallback + a red "still placeholder-tagged"
  // flag for the test vehicle specifically, back when its GPS tags weren't
  // yet confirmed - removed now that they are.
  const activity = useMemo(() => deriveActivity(dayPoints), [dayPoints]);
  const hasDay = activity.totalMin > 0;

  // The route can resolve to a day other than the one being displayed (its
  // GPS coverage may be narrower than the rest of the vehicle's data - see
  // RoutePanel's own note for the map) - flag it when that happens.
  const displayDay = day ?? todayLocal(vehicle?.timezone);
  const activityMismatch = routePointsDay && routePointsDay !== displayDay
    ? { requested: displayDay, actual: routePointsDay }
    : null;

  const { lat, lng, ts: gpsTs } = getGpsFix(readings);
  const locStamp = fmt(gpsTs);

  // Open alerts scoped to the focused day (in vehicle-local time), so the strip
  // reads as one coherent "this day" snapshot. Until the route resolves a day,
  // fall back to the full record. The total stays visible in the note.
  const allAlerts = alerts ? [...(alerts.events || []), ...(alerts.overrides || [])] : null;
  const totalAlerts = allAlerts ? allAlerts.length : null;
  const dayAlerts = allAlerts == null ? null
    : day ? allAlerts.filter((e) => localDate(e.ts, vehicle?.timezone) === day).length
      : totalAlerts;

  // Every tile follows the selected day, all derived from that day's real
  // route/PTO fixes (via deriveActivity) — no weekly or global figures mixed in.
  const kpis = [
    {
      key: "util", label: t("overview.kpi.utilisation.label"), Icon: IconGauge, accent: true,
      value: hasDay ? activity.workPct : "—", unit: hasDay ? "%" : "",
      format: (n) => n.toFixed(0), note: t("overview.kpi.utilisation.note"),
      infoTip: true,
    },
    {
      key: "hours", label: t("overview.kpi.hours.label"), Icon: IconClock,
      value: hasDay ? activity.totalMin / 60 : "—", unit: hasDay ? "h" : "",
      format: (n) => n.toFixed(1), note: t("overview.kpi.hours.note"),
      infoTip: true,
    },
    {
      key: "atwork", label: t("overview.kpi.atWork.label"), Icon: IconClock,
      value: activity.workMin, format: (n) => fmtDur(n),
      note: hasDay ? t("overview.kpi.atWork.notePct", { pct: activity.workPct.toFixed(0) }) : t("overview.kpi.atWork.noteNoRoute"),
      infoTip: true,
    },
    {
      key: "jobs", label: t("overview.kpi.jobs.label"), Icon: IconRoute,
      value: activity.jobs, note: t("overview.kpi.jobs.note"),
      infoTip: true,
    },
    {
      key: "stops", label: t("overview.kpi.stops.label"), Icon: IconPin,
      value: activity.stops, note: t("overview.kpi.stops.note"),
      infoTip: true,
    },
    {
      key: "alerts", label: t("overview.kpi.openAlerts.label"), Icon: IconAlerts,
      value: dayAlerts != null ? dayAlerts : "—",
      note: totalAlerts != null ? t("overview.kpi.openAlerts.noteInRecord", { count: totalAlerts }) : "",
      infoTip: true,
    },
  ];

  return (
    <>
      <DayStatusBar vehicle={vehicle} day={day} setDay={setDay} />
      <KpiStrip items={kpis} resetKey={vehicleId} />
      <StatusPanel readings={readings} isLive={isLive} />

      <div className="canvas">
        <div className="c-6 ov-route">
          <div className="toggle ov-route-toggle">
            <button className={routeView === "routes" ? "active" : ""}
              onClick={() => setRouteView("routes")}>{t("overview.routeToggle.routes")}</button>
            <button className={routeView === "location" ? "active" : ""}
              onClick={() => setRouteView("location")}>{t("overview.routeToggle.location")}</button>
          </div>
          {/* Both stay mounted (never conditionally rendered) so switching
              between them is instant, not a fresh fetch each time - only
              visibility toggles, via each panel's own className prop.
              `visible` tells the map inside to re-check its size once shown
              again (a hidden Leaflet map otherwise renders broken - it sizes
              itself off its container at creation/resize time, and a
              display:none container measures as 0x0). */}
          <RoutePanel fmt={fmt} fmtTime={fmtTime} vehicleId={vehicleId}
            day={day} setDay={setDay} requestedDay={displayDay}
            onData={(points, resolvedDay) => { setDayPoints(points); setRoutePointsDay(resolvedDay); }} tall
            visible={routeView === "routes"}
            className={routeView === "routes" ? "" : "ov-route-hidden"} />
          <MapPanel lat={lat} lng={lng} stamp={locStamp}
            visible={routeView === "location"}
            className={routeView === "location" ? "" : "ov-route-hidden"} />
        </div>
        <div className="c-6 col ov-side">
          <WeatherPanel readings={readings} vehicle={vehicle} />
          <TankLevel readings={readings} />
          <WeightPanel readings={readings} />
        </div>
        <div className="c-6 ov-lower"><PumpUtilisation vehicleId={vehicleId} vehicle={vehicle} /></div>
        <div className="c-6 col ov-lower">
          <ActivityPanel activity={activity} hasData={hasDay} mismatch={activityMismatch} />
          <FuelPanel vehicleId={vehicleId} day={day} requestedDay={displayDay} />
        </div>
      </div>
    </>
  );
}
