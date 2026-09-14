import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import L from "leaflet";
import { getRoute } from "../api.js";
import { fmtDay } from "../dates.js";
import { groupStops } from "../activity.js";
import { chartColors } from "../theme.js";
import { makeBasemap } from "../basemaps.js";
import MapTypeToggle from "./MapTypeToggle.jsx";
import { SkelBar } from "./Skeleton.jsx";

// One day's GPS track with prev/next day navigation. Stationary clusters are
// drawn as stop dots (working stops in violet); movement is drawn as green lines
// through the real fixes. Stop clustering is shared with the Overview activity
// panel (see activity.js) so both agree on how many stops a day had.
//
// The day can be CONTROLLED by a parent (Overview lifts it for cross-filtering):
// pass `day` + `setDay`. Left uncontrolled, it keeps its own day state. `onData`
// hands the resolved points back up so the parent can derive activity from the
// same fixes.
//
// GPS coverage can be narrower than the rest of the vehicle's data (e.g. the
// backfilled Argos GPS export doesn't reach as far as live telemetry does) -
// the backend clamps an out-of-range `day` to its own latest GPS day. When
// controlled, that clamp is for THIS PANEL's own display only (`effDay`,
// below) and is never pushed back up to overwrite the page's shared `day` -
// the status bar and the rest of the page stay on the day actually chosen
// (explicitly, or just "today" by default) regardless of what any one
// panel's own data happens to cover; this panel shows the nearest day it
// actually has, with a note saying so (see the .mnt-note below), the same
// pattern OverviewPage's ActivityPanel now uses for its own, differently-
// scoped data. Uncontrolled usage always self-corrects, since nothing else
// depends on it.
//
// `requestedDay` (optional): what to show as the requested day in that note
// when `day` is null ("today", unconfigured) - this panel has no vehicle
// timezone of its own to resolve "today" from, so the parent (which does)
// passes its own already-resolved fallback. Falls back to `day` itself if
// not given.
export default function RoutePanel({ fmt, fmtTime, vehicleId, day: dayProp, setDay: setDayProp, onData, tall, className = "", requestedDay, visible = true }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const base = useRef(null);      // current tile layer/group
  const firstRun = useRef(true);  // skip the basemap-swap effect's mount run
  const [basemap, setBasemap] = useState("map");
  const [days, setDays] = useState([]);
  const [dayState, setDayState] = useState(null);
  const controlled = dayProp !== undefined && typeof setDayProp === "function";
  const day = controlled ? dayProp : dayState;
  const setDay = controlled ? setDayProp : setDayState;
  // The day actually being displayed - usually equal to `day`, but pinned to
  // the backend's clamped GPS day when `day` itself has no GPS coverage.
  const [effDay, setEffDay] = useState(day);
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const segs = useMemo(() => groupStops(points), [points]);
  const noGps = !loading && days.length === 0;

  useEffect(() => { setDay(null); }, [vehicleId]); // eslint-disable-line

  useEffect(() => {
    if (noGps && map.current) { map.current.remove(); map.current = null; layer.current = null; }
  }, [noGps]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getRoute(day, vehicleId)
      .then((r) => {
        if (!live) return;
        setDays(r.days);
        setEffDay(r.day);
        if (r.day !== day && !controlled) setDay(r.day);
        setPoints(r.points);
        // Second arg: the day these points are ACTUALLY for (r.day, which
        // can differ from the requested `day` - see effDay above). Overview
        // needs this to know whether its own route-derived activity/KPIs are
        // for the day it's displaying or a fallback, same as this panel's
        // own note already tells the user for the map.
        onData?.(r.points, r.day);
        setErr(null);
      })
      .catch((e) => live && setErr(String(e)))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [day, vehicleId]); // eslint-disable-line

  const dur = (aIso, bIso) => {
    const m = Math.round((new Date(bIso) - new Date(aIso)) / 60000);
    const h = Math.floor(m / 60);
    return h ? `${h} h ${m % 60} m` : `${m} m`;
  };
  const stopLabel = (s) =>
    `${fmtTime(s.startTs)} – ${fmtTime(s.endTs)} (${dur(s.startTs, s.endTs)})` +
    (s.pto ? ` — ${t("common.routePanel.ptoActive")}` : "");

  useEffect(() => {
    if (!ref.current) return;
    const C = chartColors(document.documentElement.classList.contains("dark"));
    if (!map.current) {
      map.current = L.map(ref.current, { zoomControl: true, attributionControl: true });
      base.current = makeBasemap(basemap);
      base.current.addTo(map.current);
    }
    if (layer.current) { layer.current.remove(); layer.current = null; }
    if (points.length === 0) return;

    const latlngs = points.map((p) => [p.lat, p.lng]);
    const g = L.layerGroup().addTo(map.current);
    for (const s of segs) {
      if (s.type !== "leg") continue;
      L.polyline(s.idx.map((j) => latlngs[j]), { color: C.green, weight: 4, opacity: 0.85 }).addTo(g);
    }
    for (const s of segs) {
      if (s.type !== "stop") continue;
      L.circleMarker(s.center, {
        radius: 7, weight: 3,
        color: s.pto ? C.violet : C.green,
        fillColor: s.pto ? C.violet : "#ffffff",
        fillOpacity: s.pto ? 0.6 : 1,
      }).bindTooltip(stopLabel(s)).addTo(g);
    }
    L.circleMarker(latlngs[0], { radius: 7, color: C.green, weight: 3, fillColor: "#ffffff", fillOpacity: 1 })
      .bindTooltip(t("common.routePanel.start")).addTo(g);
    L.circleMarker(latlngs[latlngs.length - 1], { radius: 7, color: C.green, weight: 3, fillColor: C.green, fillOpacity: 0.5 })
      .bindTooltip(t("common.routePanel.end")).addTo(g);
    layer.current = g;

    // maxZoom caps how far fitBounds will zoom in for a tightly-clustered day
    // (e.g. one stop, barely any movement). Without it, a small enough bounding
    // box can push past the "Map" style's real reference-data resolution for
    // that specific location - Esri's Light Gray Canvas basemap (basemaps.js)
    // is a general reference map, not photography, and doesn't have detailed
    // source data everywhere at every zoom the tile scheme technically allows;
    // past that point it serves a literal "Map data not yet available" tile
    // instead of an error (Joe, 2026-09-14). 16 is comfortably within its
    // normal worldwide coverage. Satellite (real aerial photography) doesn't
    // have this ceiling, but the cap applies to both since it's the same
    // Leaflet map instance/fitBounds call regardless of which is showing.
    const b = L.latLngBounds(latlngs);
    if (latlngs.length > 1 && !b.getNorthEast().equals(b.getSouthWest())) {
      map.current.fitBounds(b, { padding: [24, 24], maxZoom: 16 });
    } else {
      map.current.setView(latlngs[0], 15);
    }
  }, [segs]); // eslint-disable-line

  // Swap the basemap when the toggle flips (mount run skipped — the effect above
  // added the initial layer; it also re-adds it if the map is rebuilt).
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (!map.current) return;
    if (base.current) base.current.remove();
    base.current = makeBasemap(basemap);
    base.current.addTo(map.current);
  }, [basemap]);

  // This panel can be kept mounted but CSS-hidden (Overview's Routes/Location
  // toggle) rather than unmounted, so switching back doesn't re-fetch. A
  // Leaflet map sizes its tiles off its container at creation time; a
  // display:none container measures 0x0, so a map that was ever hidden shows
  // broken/blank until told to recheck - invalidateSize() on becoming visible
  // again fixes it. No-op (and cheap) for a panel that's never hidden.
  useEffect(() => {
    if (visible && map.current) map.current.invalidateSize();
  }, [visible]);

  const i = days.indexOf(effDay);
  const go = (delta) => setDay(days[i + delta]);
  const nStops = segs.filter((s) => s.type === "stop").length;

  return (
    <div className={"panel " + className}>
      <div className="panel-head">
        {t("common.routePanel.title")}
        {!noGps && (
          <span className="stamp">
            {points.length ? `${fmt(points[0].ts)} → ${fmt(points[points.length - 1].ts)}` : ""}
          </span>
        )}
      </div>
      {noGps ? (
        <div className="empty">{t("common.routePanel.noLocation")}</div>
      ) : (
        <>
          <div className="route-nav">
            <button className="navbtn" disabled={loading || i <= 0} onClick={() => go(-1)}>‹ {t("common.nav.prev")}</button>
            <span className="route-day">{fmtDay(effDay)}</span>
            <button className="navbtn" disabled={loading || i < 0 || i >= days.length - 1} onClick={() => go(1)}>{t("common.nav.next")} ›</button>
          </div>
          {controlled && effDay !== (requestedDay ?? day) && (
            <div className="mnt-note">
              {t("common.routePanel.noGpsFallback", { requested: fmtDay(requestedDay ?? day), actual: fmtDay(effDay) })}
            </div>
          )}
          <div className={"map-wrap" + (tall ? " tall" : "")}>
            <div className={"map" + (tall ? " tall" : "")} ref={ref} />
            <MapTypeToggle value={basemap} onChange={setBasemap} />
          </div>
          {loading ? (
            <SkelBar style={{ marginTop: 14 }} />
          ) : err ? (
            <div className="err">{err}</div>
          ) : points.length === 0 ? (
            <div className="empty">{t("common.routePanel.noGpsForDay")}</div>
          ) : (
            <div className="coords">
              <span><i className="sw drive" /> {t("common.routePanel.driving")}</span>
              <span><i className="sw dot" /> {t("common.routePanel.stop")}</span>
              <span><i className="sw dot work" /> {t("common.routePanel.workingStop")}</span>
              <span><b>{nStops}</b> {t("common.routePanel.stops")}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
