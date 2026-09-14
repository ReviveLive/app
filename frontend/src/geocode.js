// Reverse geocoding via OpenStreetMap's Nominatim — the same provider that
// already serves the map tiles, so no NEW party learns the vehicle's location.
// Fair-use policy: max 1 request/second, so results are cached in localStorage
// keyed on ~11 m cells (4 decimal places) — a parked vehicle is one lookup.
const KEY = "revive-geocode-cache-v1";
const REGION_KEY = "revive-region-cache-v1";

function loadCache(key = KEY) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}

export async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null;
  const k = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cache = loadCache();
  if (k in cache) return cache[k];

  const url = "https://nominatim.openstreetmap.org/reverse" +
    `?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16`;
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error(`geocode -> ${res.status}`);
  const j = await res.json();

  // Road + locality + county reads best; fall back to the full display name.
  const a = j.address || {};
  const place = [a.road, a.village || a.town || a.suburb || a.city, a.county]
    .filter(Boolean).join(", ") || j.display_name || null;

  cache[k] = place;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* cache is best-effort */ }
  return place;
}

// Coarser lookup: the county / region the coords sit in, not the street. Used to
// caption the local weather ("Rain in County Dublin"). zoom=8 asks Nominatim for
// the county-level administrative area; we pick the most region-like field
// available and fall back down the ladder. Cached separately (own coord cells).
export async function reverseRegion(lat, lng) {
  if (lat == null || lng == null) return null;
  const k = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cache = loadCache(REGION_KEY);
  if (k in cache) return cache[k];

  const url = "https://nominatim.openstreetmap.org/reverse" +
    `?format=jsonv2&lat=${lat}&lon=${lng}&zoom=8`;
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error(`region -> ${res.status}`);
  const j = await res.json();

  const a = j.address || {};
  // County/metro area reads best (County Dublin, Greater Manchester, Greater
  // London); fall back to broader region/state only when nothing finer exists.
  const region = a.county || a.state_district || a.city || a.region
    || a.state || a.town || null;

  cache[k] = region;
  try { localStorage.setItem(REGION_KEY, JSON.stringify(cache)); } catch { /* best-effort */ }
  return region;
}
