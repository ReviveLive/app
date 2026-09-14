// The app has two data sources, chosen at BUILD TIME:
//
//  LIVE   — local dev and the Docker/Caddy deploy. Calls the read-only FastAPI
//           backend at BASE (same-origin "/api/..." in the deploy; :8000 in dev).
//  STATIC — the Vercel deploy. There is NO backend or database: every response
//           was pre-computed once by `python -m revive.export_static` into
//           /snapshot/*.json, and we just read the right file. See that module.
//
// STATIC is selected when the app is built with `vite build --mode static`
// (npm run build:static), which sets import.meta.env.MODE === "static". A normal
// `npm run build` (Docker) or `npm run dev` stays LIVE, so this is invisible to
// the existing stack.
const STATIC = import.meta.env.MODE === "static";

// Where the Python API lives (LIVE mode). In the Docker deploy this is built as
// "" (empty) = "same domain", so the app calls /api/... on whatever host served
// it — no hardcoded address, no cross-origin request. When VITE_API_BASE is
// unset (local dev, Vite on :5173) it falls back to the local API on :8000.
// Uses ?? (not ||) so an intentional empty string is kept as same-origin.
const BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

// --- static snapshot plumbing (STATIC mode only) ---------------------------
// The frozen responses live under <base>/snapshot/ (BASE_URL is "/" on Vercel).
const SNAP = `${import.meta.env.BASE_URL}snapshot`;
let _manifestPromise = null;
function manifest() {
  if (!_manifestPromise) {
    _manifestPromise = fetch(`${SNAP}/manifest.json`).then((r) => {
      if (!r.ok) throw new Error(`snapshot manifest -> ${r.status}`);
      return r.json();
    });
  }
  return _manifestPromise;
}

// Turn a request path ("/api/route?day=x&vehicle=y") into the manifest key the
// exporter recorded: the endpoint, then its params sorted by name with decoded
// values, as "k=v&k=v". MUST stay identical to _key() in export_static.py.
function snapshotKey(path) {
  const rel = path.replace(/^\/api\//, "");
  const q = rel.indexOf("?");
  if (q === -1) return rel;
  const pairs = [...new URLSearchParams(rel.slice(q + 1)).entries()].sort(
    (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  );
  return `${rel.slice(0, q)}?${pairs.map(([k, v]) => `${k}=${v}`).join("&")}`;
}

async function get(path) {
  if (STATIC) {
    const key = snapshotKey(path);
    const file = (await manifest())[key];
    if (!file) throw new Error(`No snapshot for ${key}`);
    const res = await fetch(`${SNAP}/${file}`);
    if (!res.ok) throw new Error(`${file} -> ${res.status}`);
    return res.json();
  }
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

// Build a query string from defined params only (drops null/undefined).
const qs = (params) => {
  const s = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null)
  ).toString();
  return s ? `?${s}` : "";
};

export const getVehicles = () => get("/api/vehicles");
export const getCustomer = () => get("/api/customer");
export const getLastKnown = (vehicle) => get(`/api/last-known${qs({ vehicle })}`);
export const getUsage = (parameter, grain, vehicle) =>
  get(`/api/usage${qs({ parameter, grain, vehicle })}`);
export const getPtoWorking = (grain, vehicle) =>
  get(`/api/pto-working${qs({ grain, vehicle })}`);
export const getPtoTimeline = (day, vehicle) =>
  get(`/api/pto-timeline${qs({ day, vehicle })}`);
export const getRoute = (day, vehicle) => get(`/api/route${qs({ day, vehicle })}`);
export const getTruckStops = (vehicle) => get(`/api/truck-stops${qs({ vehicle })}`);
export const getWorkLocations = (vehicle) => get(`/api/work-locations${qs({ vehicle })}`);
export const getPumpActivations = (vehicle) => get(`/api/pump-activations${qs({ vehicle })}`);
export const getFuelDay = (day, vehicle) => get(`/api/fuel-day${qs({ day, vehicle })}`);
export const getRpm = (grain, vehicle) => get(`/api/rpm${qs({ grain, vehicle })}`);
export const getAlerts = (vehicle) => get(`/api/alerts${qs({ vehicle })}`);
export const getCycleCounts = (vehicle, start, end) =>
  get(`/api/cycle-counts${qs({ vehicle, start, end })}`);
export const getTrend = (metric, grain, vehicle) =>
  get(`/api/trend${qs({ metric, grain, vehicle })}`);
export const getSustainability = (vehicle, grain) =>
  get(`/api/sustainability${qs({ vehicle, grain })}`);
export const getCosting = (vehicle, start, end) =>
  get(`/api/costing${qs({ vehicle, start, end })}`);
