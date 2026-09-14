import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getTrend } from "../api.js";
import TrendChart from "../components/TrendChart.jsx";
import SafetyTimeline from "../components/SafetyTimeline.jsx";
import KpiStrip from "../components/KpiStrip.jsx";
import GrainToggle from "../components/GrainToggle.jsx";
import PeriodNav from "../components/PeriodNav.jsx";
import PumpUsage from "../components/PumpUsage.jsx";
import RpmChart from "../components/RpmChart.jsx";
import { usePeriodPaging } from "../usePeriodPaging.js";
import { SkelKpiStrip } from "../components/Skeleton.jsx";
import { IconDrop, IconClock, IconRecycle, IconGauge, IconTrends } from "../components/Icons.jsx";

// Trends tab — period-over-period direction-of-travel: how much work the vehicle
// is doing over time, and what it's costing. Every metric is served by
// /api/trend at the chosen grain. As of 2026-09-11, Operating Hours, Fuel Rate,
// Engine RPM, Fuel Used and Water Recycled are all real for a real-tag vehicle
// (TREND_METRICS matches either name; Fuel Used/Water Recycled fall back to
// integrating the fuel-rate samples / RECYCLE_PUMP_MINUTES * 350 L/min, same
// techniques /api/sustainability uses, when there's no cumulative counter to
// take a delta of - both currently read 0 for Warrior-No.75-Veolia since
// neither has happened yet, not because the derivation is missing). Water
// Collected and Safety Events remain demo-fleet-only - the former has no real
// datapoint at all, the latter would need edge-detection like /api/alerts got.
//
// `goodUp` colours the KPI delta: for output metrics (water, hours) a rise is
// good; for cost/safety metrics (fuel, events) a rise is bad; null = neutral.
const METRICS = [
  { key: "operating_hours", labelKey: "trends.metrics.operatingHours.label", unit: "h",    type: "area", colorRole: "green",  goodUp: true,  Icon: IconClock },
  { key: "water_recycled",  labelKey: "trends.metrics.waterRecycled.label",  unit: "L",    type: "area", colorRole: "teal",   goodUp: true,  Icon: IconRecycle },
  { key: "fuel_used",       labelKey: "trends.metrics.fuelUsed.label",       unit: "L",     type: "area", colorRole: "amber",  goodUp: false, Icon: IconDrop },
  { key: "fuel_rate",       labelKey: "trends.metrics.fuelRate.label",       unit: "L/h",   type: "line", colorRole: "amber",  goodUp: false, Icon: IconGauge },
  { key: "rpm_avg",         labelKey: "trends.metrics.engineRpm.label",      unit: "rpm",   type: "line", colorRole: "violet", goodUp: null,  Icon: IconGauge },
  { key: "safety_events",   labelKey: "trends.metrics.safetyEvents.label",   unit: "events", type: "timeline", colorRole: "red", goodUp: false },
];
const KPI_KEYS = ["water_recycled", "fuel_used", "fuel_rate", "operating_hours", "rpm_avg"];
const CHART_KEYS = ["water_recycled", "operating_hours", "fuel_used", "fuel_rate", "rpm_avg"];
const byKey = Object.fromEntries(METRICS.map((m) => [m.key, m]));

function fmtVal(v, unit) {
  if (v == null) return "—";
  if (unit === "rpm" || unit === "events" || unit === "L") return Math.round(v).toLocaleString("en-GB");
  return Number(v.toFixed(1)).toLocaleString("en-GB");
}
function periodDomain(data) {
  const dates = Object.values(data || {}).flatMap((d) => (d?.buckets ?? []).map((b) => b.bucket));
  if (dates.length === 0) return null;
  return [dates.reduce((a, b) => (a < b ? a : b)), dates.reduce((a, b) => (a > b ? a : b))];
}
function summarise(buckets) {
  if (!buckets || buckets.length === 0) return { latest: null, changePct: null };
  const latest = buckets[buckets.length - 1].value;
  const prev = buckets.length > 1 ? buckets[buckets.length - 2].value : null;
  const changePct = prev != null && prev !== 0 ? ((latest - prev) / prev) * 100 : null;
  return { latest, changePct };
}

export default function TrendsPage({ vehicleId, vehicle }) {
  const { t } = useTranslation();
  const [grain, setGrain] = useState("week");
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!vehicleId) return;
    let live = true;
    setData(null);
    Promise.all(
      METRICS.map((m) =>
        getTrend(m.key, grain, vehicleId).then((r) => [m.key, r]).catch(() => [m.key, { buckets: [] }])
      )
    ).then((entries) => live && (setData(Object.fromEntries(entries)), setErr(null)))
      .catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [vehicleId, grain]);

  // One shared window across every chart, so the whole page pages together and
  // the bars never crowd. The timeline is the union of all metrics' bucket dates;
  // the current window gives an inclusive [start, end] each chart is sliced to.
  const timeline = useMemo(() => {
    const set = new Set();
    if (data) for (const key of CHART_KEYS) (data[key]?.buckets ?? []).forEach((b) => set.add(b.bucket));
    return [...set].sort().map((bucket) => ({ bucket }));
  }, [data]);
  const { view, label, go, atOldest, atNewest, empty } = usePeriodPaging(timeline, grain);
  const range = view.length ? [view[0].bucket, view[view.length - 1].bucket] : null;
  const inRange = (b) => !range || (b.bucket >= range[0] && b.bucket <= range[1]);

  const kpis = KPI_KEYS.map((key) => {
    const m = byKey[key];
    const buckets = data?.[key]?.buckets ?? [];
    const { latest, changePct } = summarise(buckets);
    const dir = changePct == null ? "flat" : changePct > 0 ? "up" : "down";
    const tone = m.goodUp == null || dir === "flat" ? undefined : (dir === "up") === m.goodUp ? "good" : "bad";
    const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "→";
    return {
      key, label: t(m.labelKey), Icon: m.Icon, unit: m.unit,
      value: latest != null ? Number(fmtVal(latest, m.unit).replace(/,/g, "")) : "—",
      format: (n) => fmtVal(n, m.unit),
      spark: buckets.length > 1 ? buckets.map((b) => b.value) : null,
      sparkColor: `var(--series-${m.colorRole})`,
      delta: changePct == null ? null : `${arrow} ${Math.abs(changePct).toFixed(0)}%`,
      deltaTone: tone, note: changePct == null ? "" : t("trends.kpiNote.vsLast"),
    };
  });

  const chartPanel = (key) => {
    const m = byKey[key];
    const buckets = (data?.[key]?.buckets ?? []).filter(inRange);
    return (
      <div className="panel" key={key}>
        <div className="panel-head">{t(m.labelKey)} <span className="trend-unit">· {m.unit}</span></div>
        {buckets.length === 0 ? (
          <div className="empty">{t("common.noDataForPeriod")}</div>
        ) : (
          <TrendChart data={buckets} type={m.type} unit={m.unit} colorRole={m.colorRole}
            grain={grain} height={185} />
        )}
      </div>
    );
  };

  return (
    <>
      <div className="panel">
        <div className="usage-head">
          <div className="panel-head" style={{ margin: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <span className="kpi-ico"><IconTrends /></span> {t("trends.title")}
              {vehicle?.name && <span className="stamp">{vehicle.name}</span>}
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <GrainToggle grain={grain} onChange={setGrain} />
          </div>
        </div>
        {grain === "month" && (
          <div className="mnt-note">
            {t("trends.monthlyNote")}
          </div>
        )}
        {data != null && !err && !empty && (
          <PeriodNav label={label} onPrev={() => go(-1)} onNext={() => go(1)}
            atStart={atOldest} atEnd={atNewest} />
        )}
        {err ? <div className="err">{err}</div>
          : data == null ? <SkelKpiStrip count={6} className="k6" />
          : <KpiStrip items={kpis} />}
      </div>

      {data != null && !err && (
        <>
          <div className="grid g3">{CHART_KEYS.map(chartPanel)}</div>
          <SafetyTimeline events={(data.safety_events?.buckets ?? []).filter(inRange)}
            domain={range || periodDomain(data)} grain={grain} />
        </>
      )}

      <PumpUsage vehicleId={vehicleId} />
      <RpmChart vehicleId={vehicleId} />
    </>
  );
}
