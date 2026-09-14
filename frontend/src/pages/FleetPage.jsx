import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getLastKnown, getTrend, getSustainability, getAlerts } from "../api.js";
import { fmtDMY } from "../dates.js";
import { getGpsFix } from "../gps.js";
import KpiStrip from "../components/KpiStrip.jsx";
import { IconFleet, IconClock, IconDrop, IconAlerts } from "../components/Icons.jsx";

// Fleet compare — every vehicle side by side, sortable. There's no fleet
// endpoint (the demo stays lean); each row is assembled client-side from the
// same per-vehicle endpoints the single-vehicle pages use. A vehicle missing a
// channel (no fuel, no GPS) shows a dash, never a fabricated number.
//
// Moved to pages/ and audited against real data 2026-09-12: hasGps used to
// check only the demo fleet's "Latitude Decimal Degrees" key, so the real
// trial vehicle (reports under gps_lat_revlive - see gps.js) always showed
// "no GPS" even with a fix - fixed via the shared getGpsFix() helper.
// `alerts` still sums /api/alerts' events+overrides, which that endpoint
// caps at LOG_LIMIT (5 each) for its own log display - fine today (no
// vehicle has more than a handful of alerts yet) but this column will
// under-count once any vehicle's real lifetime total passes that cap;
// not fixed here since it needs its own uncapped count query, not a reuse
// of the capped log endpoint.

function newestTs(readings) {
  let t = "";
  for (const k in readings) { const ts = readings[k]?.ts; if (ts && ts > t) t = ts; }
  return t || null;
}

async function loadVehicle(v) {
  const [lk, hours, sust, alerts] = await Promise.all([
    getLastKnown(v.vehicle_id).catch(() => ({ readings: {} })),
    getTrend("operating_hours", "week", v.vehicle_id).catch(() => ({ buckets: [] })),
    getSustainability(v.vehicle_id, "week").catch(() => ({ buckets: [] })),
    getAlerts(v.vehicle_id).catch(() => ({ events: [], overrides: [] })),
  ]);
  const r = lk.readings || {};
  const latest = sust.buckets?.at(-1) || {};
  return {
    id: v.vehicle_id,
    name: v.name?.replace(/\s*no\.\s*/i, " ") || v.vehicle_id,
    tz: v.timezone,
    hasGps: getGpsFix(r).lat != null,
    hours: hours.buckets?.at(-1)?.value ?? null,
    util: latest.utilisation_pct ?? null,
    fuel: latest.fuel_used_litres ?? null,
    alerts: (alerts.events?.length || 0) + (alerts.overrides?.length || 0),
    lastSeen: newestTs(r),
  };
}

const COLS = [
  { key: "name", labelKey: "fleet.columns.vehicle", num: false },
  { key: "hours", labelKey: "fleet.columns.hoursPerWeek", num: true },
  { key: "util", labelKey: "fleet.columns.utilisation", num: true },
  { key: "fuel", labelKey: "fleet.columns.fuelPerWeek", num: true },
  { key: "alerts", labelKey: "fleet.columns.alerts", num: true },
  { key: "lastSeen", labelKey: "fleet.columns.lastSeen", num: false },
];

const dash = <span className="fleet-dash">—</span>;
const num = (n, d = 0) => (n == null ? dash : Number(n).toLocaleString("en-GB", { maximumFractionDigits: d }));

export default function FleetPage({ vehicles, vehicle, onSelect }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(null);
  const [sort, setSort] = useState({ key: "hours", dir: "desc" });

  // Scoped to the currently-selected vehicle's own customer (Joe,
  // 2026-09-12): an unrestricted/local view still has every ingested
  // vehicle in `vehicles` (e.g. the master-user vehicle switcher), but the
  // Fleet page itself must never show another customer's trucks alongside
  // the selected one - Warrior 75 selected shows only Veolia's fleet, not
  // Warrior (demo) or Citiflex too. A deployment already scoped to one
  // customer (CUSTOMER_ID set) has this as a no-op - `vehicles` only ever
  // contains that customer's own vehicles to begin with.
  const scoped = useMemo(
    () => vehicles.filter((v) => v.customer_id === vehicle?.customer_id),
    [vehicles, vehicle]
  );

  useEffect(() => {
    if (!scoped.length) { setRows([]); return; }
    let live = true;
    setRows(null);
    Promise.all(scoped.map(loadVehicle))
      .then((res) => live && setRows(res))
      .catch(() => live && setRows([]));
    return () => { live = false; };
  }, [scoped]);

  const sorted = useMemo(() => {
    if (!rows) return null;
    const { key, dir } = sort;
    const s = [...rows].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return dir === "asc" ? av - bv : bv - av;
    });
    return s;
  }, [rows, sort]);

  const clickSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));

  // Fleet-level KPI roll-up
  const kpis = useMemo(() => {
    const r = rows || [];
    const sum = (f) => r.reduce((s, x) => s + (f(x) || 0), 0);
    const avg = (f) => { const v = r.map(f).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    return [
      { key: "count", label: t("fleet.kpi.vehicles.label"), Icon: IconFleet, value: r.length, note: t("fleet.kpi.vehicles.note"), accent: true },
      { key: "hours", label: t("fleet.kpi.totalHours.label"), Icon: IconClock, value: sum((x) => x.hours), format: (n) => n.toFixed(0), unit: "h" },
      { key: "util", label: t("fleet.kpi.avgUtilisation.label"), Icon: IconClock, value: avg((x) => x.util) ?? "—", format: (n) => n.toFixed(0), unit: avg((x) => x.util) != null ? "%" : "" },
      { key: "fuel", label: t("fleet.kpi.totalFuel.label"), Icon: IconDrop, value: sum((x) => x.fuel), format: (n) => n.toFixed(0), unit: "L" },
      { key: "alerts", label: t("fleet.kpi.openAlerts.label"), Icon: IconAlerts, value: sum((x) => x.alerts), note: t("fleet.kpi.openAlerts.note") },
    ];
  }, [rows, t]);

  const maxHours = Math.max(1, ...(rows || []).map((r) => r.hours || 0));

  return (
    <>
      {rows && <KpiStrip items={kpis} />}
      <div className="panel">
        <div className="panel-head">
          {t("fleet.title")}
          <span className="stamp">{t("fleet.clickToOpen")}</span>
        </div>
        <p className="panel-sub">{t("fleet.subtitle")}</p>

        {!sorted ? (
          <div className="empty">{t("fleet.loading")}</div>
        ) : sorted.length === 0 ? (
          <div className="empty">{t("fleet.noVehicles")}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="fleet-table">
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th key={c.key} className={c.num ? "num" : ""} onClick={() => clickSort(c.key)}>
                      {t(c.labelKey)}
                      {sort.key === c.key && <span className="arrow">{sort.dir === "asc" ? "▲" : "▼"}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr className="fleet-row" key={r.id} onClick={() => onSelect(r.id)}>
                    <td>
                      <span className="fleet-name">{r.name}
                        {!r.hasGps && <span className="loc">{t("fleet.noGps")}</span>}
                      </span>
                    </td>
                    <td className="num">
                      {r.hours == null ? dash : <>{num(r.hours, 1)}
                        <span className="fleet-mini"><i style={{ width: `${(r.hours / maxHours) * 100}%` }} /></span></>}
                    </td>
                    <td className="num">{r.util == null ? dash : `${num(r.util, 0)}%`}</td>
                    <td className="num">{r.fuel == null ? dash : `${num(r.fuel, 0)} L`}</td>
                    <td className="num">{r.alerts}</td>
                    <td>{r.lastSeen ? fmtDMY(r.lastSeen, r.tz) : dash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
