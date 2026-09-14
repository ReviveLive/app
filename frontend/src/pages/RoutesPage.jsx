import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getTruckStops, getWorkLocations } from "../api.js";
import RoutePanel from "../components/RoutePanel.jsx";
import MapPanel from "../components/MapPanel.jsx";
import WeatherPanel from "../components/WeatherPanel.jsx";
import InfoTip from "../components/InfoTip.jsx";
import { getGpsFix } from "../gps.js";
import { groupStops, fmtDur } from "../activity.js";
import { todayLocal } from "../period.js";
import { localDate } from "../dates.js";
import { reverseGeocode } from "../geocode.js";
import { getForecast, wmo } from "../weather.js";

// Routes — renamed from the old standalone Weather tab (Joe, 2026-09-11): a
// dedicated Weather-only page was hard to justify on its own, so this page
// leads with the same Route History + Last-Known Location panels Overview
// already shows (since that's what "where has it been" is really asking).
//
// Two logs follow, both derived from GPS across the vehicle's FULL history
// (not just the day Route History is showing), clustered client-side with
// the same groupStops() Route History/Overview activity already use, each
// capped to the last LOG_LIMIT entries:
//   - Truck Stops Log: every place the truck stopped moving - pure stillness
//     (distance + dwell time), no PTO/pump condition. PTO's last-known state
//     is only carried along to badge a stop as "working" vs a plain rest/
//     parking stop (see api.py's /api/truck-stops).
//   - Work Location Log: the narrower case - anywhere PTO AND a pump were
//     active at the same time (see api.py's /api/work-locations).
// Both approved by Joe's supervisor 2026-09-11.
// Weather is folded in as a per-entry reference on Work Location Log's
// today rows, plus the same always-current Weather card kept at the bottom.
const LOG_LIMIT = 5;

function durOf(startTs, endTs) {
  return fmtDur((new Date(endTs) - new Date(startTs)) / 60000);
}

function TruckStopRow({ stop, fmtTime }) {
  const { t } = useTranslation();
  const [place, setPlace] = useState(null);

  useEffect(() => {
    let live = true;
    reverseGeocode(stop.center[0], stop.center[1]).then((p) => live && setPlace(p)).catch(() => {});
    return () => { live = false; };
  }, [stop.center[0], stop.center[1]]); // eslint-disable-line

  return (
    <li className="estop-row">
      <span className="estop-dot" aria-hidden="true"
        style={{ background: stop.pto ? "var(--brand-strong)" : "var(--ink-faint)" }} />
      <div className="estop-text">
        <div className="estop-title">{place || `${stop.center[0].toFixed(5)}, ${stop.center[1].toFixed(5)}`}</div>
        <div className="estop-cause">
          {fmtTime(stop.startTs)} – {fmtTime(stop.endTs)} ({durOf(stop.startTs, stop.endTs)})
          {stop.pto ? ` · ${t("common.routePanel.ptoActive")}` : ""}
        </div>
      </div>
    </li>
  );
}

function WorkLocationRow({ job, vehicle, fmtTime }) {
  const { t } = useTranslation();
  const [place, setPlace] = useState(null);
  const [wx, setWx] = useState(null); // null = loading/not applicable, false = failed
  const isToday = localDate(job.endTs, vehicle?.timezone) === todayLocal(vehicle?.timezone);

  useEffect(() => {
    let live = true;
    reverseGeocode(job.center[0], job.center[1]).then((p) => live && setPlace(p)).catch(() => {});
    // Only today's weather is available - there's no historical weather
    // lookup wired up yet, so a past day's job intentionally shows neither a
    // real nor a fabricated forecast.
    if (isToday) {
      getForecast(job.center[0], job.center[1])
        .then((r) => live && setWx(r)).catch(() => live && setWx(false));
    }
    return () => { live = false; };
  }, [job.center[0], job.center[1], isToday]); // eslint-disable-line

  return (
    <li className="estop-row">
      <span className="estop-dot" aria-hidden="true" style={{ background: "var(--brand-strong)" }} />
      <div className="estop-text">
        <div className="estop-title">{place || `${job.center[0].toFixed(5)}, ${job.center[1].toFixed(5)}`}</div>
        <div className="estop-cause">
          {fmtTime(job.startTs)} – {fmtTime(job.endTs)} ({durOf(job.startTs, job.endTs)})
          {isToday && wx && ` · ${Math.round(wx.tempNow)}°C, ${t(wmo(wx.code).labelKey)}`}
          {isToday && wx === false && ` · ${t("routes.weatherUnavailable")}`}
          {!isToday && ` · ${t("routes.historicalWeatherUnavailable")}`}
        </div>
      </div>
    </li>
  );
}

// Fetch + cluster + cap to the last LOG_LIMIT stops, newest first - shared
// by both logs below (the backend already scopes each fetch to the right
// points - all of them for Truck Stops, PTO+pump-active only for Work
// Locations - so no client-side filtering is needed here beyond clustering).
function useStopLog(vehicleId, fetchFn) {
  const [points, setPoints] = useState(null); // null = loading
  useEffect(() => {
    if (!vehicleId) return;
    let live = true;
    setPoints(null);
    fetchFn(vehicleId).then((r) => live && setPoints(r.points || [])).catch(() => live && setPoints([]));
    return () => { live = false; };
  }, [vehicleId]); // eslint-disable-line
  if (points == null) return null;
  return groupStops(points).filter((s) => s.type === "stop").slice(-LOG_LIMIT).reverse();
}

export default function RoutesPage({ vehicleId, vehicle, readings, fmt, fmtTime, day, setDay }) {
  const { t } = useTranslation();
  const { lat, lng, ts: gpsTs } = getGpsFix(readings);
  const locStamp = fmt(gpsTs);

  const stops = useStopLog(vehicleId, getTruckStops);
  const jobs = useStopLog(vehicleId, getWorkLocations);

  return (
    <>
      <div className="canvas">
        <div className="c-6 ov-route">
          <RoutePanel fmt={fmt} fmtTime={fmtTime} vehicleId={vehicleId}
            day={day} setDay={setDay} requestedDay={day ?? todayLocal(vehicle?.timezone)} tall />
        </div>
        <div className="c-6 col ov-side">
          <MapPanel lat={lat} lng={lng} stamp={locStamp} />
        </div>
      </div>

      <WeatherPanel readings={readings} vehicle={vehicle} />

      <div className="panel">
        <div className="usage-head">
          <div className="panel-head" style={{ margin: 0 }}>{t("routes.workLocationLog.title")}</div>
          <InfoTip label={t("routes.workLocationLog.title")}
            text={t("routes.workLocationLog.info", { limit: LOG_LIMIT })} />
        </div>
        {jobs === null ? (
          <div className="empty">{t("common.loading")}</div>
        ) : jobs.length === 0 ? (
          <div className="empty">{t("routes.workLocationLog.noData")}</div>
        ) : (
          <ul className="estop-list">
            {jobs.map((job, i) => (
              <WorkLocationRow key={i} job={job} vehicle={vehicle} fmtTime={fmtTime} />
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <div className="usage-head">
          <div className="panel-head" style={{ margin: 0 }}>{t("routes.truckStopsLog.title")}</div>
          <InfoTip label={t("routes.truckStopsLog.title")}
            text={t("routes.truckStopsLog.info", { limit: LOG_LIMIT })} />
        </div>
        {stops === null ? (
          <div className="empty">{t("common.loading")}</div>
        ) : stops.length === 0 ? (
          <div className="empty">{t("routes.truckStopsLog.noData")}</div>
        ) : (
          <ul className="estop-list">
            {stops.map((stop, i) => <TruckStopRow key={i} stop={stop} fmtTime={fmtTime} />)}
          </ul>
        )}
      </div>
    </>
  );
}
