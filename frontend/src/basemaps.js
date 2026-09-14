import L from "leaflet";

// The one place tile sources live, shared by both Overview maps (MapPanel +
// RoutePanel) so "Map" vs "Satellite" is defined once.
//
// "map"       — Esri's free "Light Gray Canvas" basemap (no account, no API
//               key) — base + a thin reference overlay for labels, same
//               pattern as "satellite" below. Previously CARTO's Positron
//               CDN, which started serving "API KEY REQUIRED" watermarked
//               tiles (2026-09-09) — that CDN now needs a CARTO account,
//               despite this file's own prior comment assuming otherwise.
// "satellite" — free Esri World Imagery (no account, no API key) with thin Esri
//               reference overlays for place names + roads, so the aerial view
//               stays readable ("hybrid"). Every Esri layer carries the
//               `sat-tile` class so the dark-mode invert (which would ruin a
//               photo) can be switched off for it in CSS.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const ESRI_ATTR =
  "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";

export function makeBasemap(kind) {
  if (kind === "satellite") {
    const opts = { maxZoom: 19, className: "sat-tile" };
    return L.layerGroup([
      L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, {
        ...opts, attribution: ESRI_ATTR,
      }),
      L.tileLayer(`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, opts),
      L.tileLayer(`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, opts),
    ]);
  }
  const opts = { maxZoom: 19 };
  return L.layerGroup([
    L.tileLayer(`${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
      ...opts, attribution: ESRI_ATTR,
    }),
    L.tileLayer(`${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, opts),
  ]);
}
