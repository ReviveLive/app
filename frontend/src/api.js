// Where the Python API lives. In the Docker deploy this is built as ""
// (empty) = "same domain", so the app calls /api/... on whatever host served
// it — no hardcoded address, no cross-origin request. When VITE_API_BASE is
// unset (local dev, Vite on :5173) it falls back to the local API on :8000.
// Uses ?? (not ||) so an intentional empty string is kept as same-origin.
const BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

async function get(path) {
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
