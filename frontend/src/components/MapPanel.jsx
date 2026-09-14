import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import L from "leaflet";
import { reverseGeocode } from "../geocode.js";
import { chartColors } from "../theme.js";
import { makeBasemap } from "../basemaps.js";
import MapTypeToggle from "./MapTypeToggle.jsx";

// Plain Leaflet + free CARTO "Positron" basemap (no account, no API key). It's a
// muted, near-greyscale map so the green marker and route data stand out instead
// of competing with busy OSM landuse colours; in dark mode the CSS tile-invert
// (styles.css) turns it into a clean dark map. A circleMarker is used so we don't
// depend on Leaflet's default marker images.
export default function MapPanel({ lat, lng, stamp, className = "", visible = true }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const base = useRef(null);      // current tile layer/group
  const firstRun = useRef(true);  // skip the basemap-swap effect's mount run
  const [place, setPlace] = useState(null);
  const [basemap, setBasemap] = useState("map");
  const hasLoc = lat != null && lng != null; // a vehicle may have no GPS at all

  useEffect(() => {
    if (!hasLoc) { setPlace(null); return; }
    let live = true;
    setPlace(null);
    reverseGeocode(lat, lng)
      .then((p) => live && setPlace(p))
      .catch(() => {}); // lookup is a nicety — coords below still tell the truth
    return () => { live = false; };
  }, [lat, lng, hasLoc]);

  useEffect(() => {
    // No location (e.g. a vehicle whose file has no lat/lng): tear the map down
    // so it doesn't linger, and bail. Recreated cleanly when a located vehicle
    // is selected again.
    if (!hasLoc) {
      if (map.current) { map.current.remove(); map.current = null; marker.current = null; }
      return;
    }
    if (!map.current) {
      map.current = L.map(ref.current, { zoomControl: true, attributionControl: true });
      base.current = makeBasemap(basemap);
      base.current.addTo(map.current);
      const g = chartColors(document.documentElement.classList.contains("dark")).green;
      marker.current = L.circleMarker([lat, lng], {
        radius: 9, color: g, weight: 3,
        fillColor: g, fillOpacity: 0.35,
      }).addTo(map.current);
    } else {
      marker.current.setLatLng([lat, lng]); // moved vehicle (e.g. switched truck)
    }
    map.current.setView([lat, lng], 14);
  }, [lat, lng, hasLoc]);

  // Swap the basemap when the toggle flips. The mount run is skipped — the block
  // above already added the initial layer (and re-adds it when the map is torn
  // down and rebuilt for a no-GPS vehicle).
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (!map.current) return;
    if (base.current) base.current.remove();
    base.current = makeBasemap(basemap);
    base.current.addTo(map.current);
  }, [basemap]);

  // This panel can be kept mounted but CSS-hidden (Overview's Routes/Location
  // toggle) rather than unmounted. A Leaflet map sizes its tiles off its
  // container at creation time; a display:none container measures 0x0, so a
  // map that was ever hidden shows broken/blank until told to recheck -
  // invalidateSize() on becoming visible again fixes it. No-op (and cheap)
  // for a panel that's never hidden.
  useEffect(() => {
    if (visible && map.current) map.current.invalidateSize();
  }, [visible]);

  return (
    <div className={"panel " + className}>
      <h2>{t("common.mapPanel.title")} {hasLoc && <span className="stamp">{stamp}</span>}</h2>
      {hasLoc ? (
        <>
          <div className="map-wrap">
            <div className="map" ref={ref} />
            <MapTypeToggle value={basemap} onChange={setBasemap} />
          </div>
          <div className="coords">
            {place && <span><b>{place}</b></span>}
            <span>lat <b>{lat?.toFixed(5)}</b></span>
            <span>lng <b>{lng?.toFixed(5)}</b></span>
          </div>
        </>
      ) : (
        <div className="empty">{t("common.mapPanel.noLocation")}</div>
      )}
    </div>
  );
}
