import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSustainability } from "../api.js";
import TrendChart from "../components/TrendChart.jsx";
import KpiStrip from "../components/KpiStrip.jsx";
import { SkelKpiStrip } from "../components/Skeleton.jsx";
import { IconCO2, IconRecycle, IconGauge, IconDrop, IconLeaf } from "../components/Icons.jsx";
import InfoTip from "../components/InfoTip.jsx";

// Sustainability / ESG — a dedicated on-screen home for the figures that used to
// live only inside the PDF report (getSustainability). A strong sales story:
// CO₂, recycling rate, utilisation and water reuse over time.
//
// Customer-facing honesty, revised 2026-09-11: a real customer only ever sees
// their own vehicle, never a "demo fleet" - so the info button explains what
// each visible figure means, not internal real-vs-simulated bookkeeping. A
// figure with genuinely no underlying datapoint at all (water collected - see
// sustainability.md) is hidden outright rather than shown broken or
// red-bordered: "no data for this vehicle at all" is a structural gap to
// track separately (sustainability.md does), not something to surface to the
// customer as a half-working panel on first look at the product. Recycling
// Rate and Water Recycled are NOT in that bucket - both are calculable from
// tracked lifetime-minute counters even without a water-volume tag (see
// their own CHARTS comments) - so they show normally, with a plain
// empty-style note under the chart on a genuine 0 (the recycling pump hasn't
// run) rather than being hidden. A metric with SOME real history but none in
// the current period still shows normally too, just empty for that period
// (existing "No data for this period." state below) - that's a data gap, not
// a missing feature.

const num = (n, d = 0) => (n == null ? "—" : Number(n).toLocaleString("en-GB", { maximumFractionDigits: d }));
const sum = (b, f) => b.reduce((s, x) => s + (f(x) || 0), 0);
const avg = (b, f) => { const v = b.map(f).filter((x) => x != null); return v.length ? v.reduce((a, c) => a + c, 0) / v.length : null; };

// Map buckets to the {bucket, value} shape TrendChart expects.
const series = (buckets, f) => buckets.map((b) => ({ bucket: b.bucket, value: Math.round((f(b) || 0) * 10) / 10 }));

const CHARTS = [
  { key: "co2_kg", i18nKey: "co2", unit: "kg", type: "area", colorRole: "green" },
  { key: "fuel_used_litres", i18nKey: "fuelUsed", unit: "L", type: "area", colorRole: "amber" },
  { key: "utilisation_pct", i18nKey: "utilisation", unit: "%", type: "line", colorRole: "blue" },
  // Redefined 2026-09-11: recycling pump run-time / PTO-active run-time over
  // the period (both lifetime counters), not a volume ratio - there's no
  // water-collected volume to divide by.
  { key: "recycling_rate_pct", i18nKey: "recyclingRate", unit: "%", type: "line", colorRole: "teal", hasZeroNote: true },
  // Derived from RECYCLE_PUMP_MINUTES' counter delta * the recycling piston's
  // known flow rate (api.py's RECYCLE_FLOW_LPM, confirmed with the machine
  // spec, not measured from telemetry) - not a direct volume reading, so
  // flagged in its info text rather than left unstated. Wording note (Joe,
  // 2026-09-11): never say "real"/"demo" vehicle in customer-facing text - a
  // customer only ever sees their own vehicle, so the distinction is
  // meaningless to them and shouldn't leak into the UI.
  { key: "water_recycled_litres", i18nKey: "waterRecycled", unit: "L", type: "area", colorRole: "teal", hasZeroNote: true },
];

export default function SustainabilityPage({ vehicleId, vehicle }) {
  const { t } = useTranslation();
  const [grain, setGrain] = useState("week");
  const [buckets, setBuckets] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!vehicleId) return;
    let live = true;
    setBuckets(null);
    getSustainability(vehicleId, grain)
      .then((r) => live && (setBuckets(r.buckets || []), setErr(null)))
      .catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [vehicleId, grain]);

  const b = buckets || [];
  const latest = b.at(-1) || {};

  // Structural availability, not "empty this period" - true only if this
  // vehicle has NEVER reported it across the whole fetched window. See the
  // top-of-file note: this hides the figure outright rather than showing a
  // permanently-broken panel.
  const hasRecycling = b.some((x) => x.recycling_rate_pct != null);
  const hasWaterRecycled = b.some((x) => x.water_recycled_litres != null);

  const kpis = [
    { key: "co2", label: t("sustainability.kpi.co2.label"), Icon: IconCO2, accent: true, value: sum(b, (x) => x.co2_kg), format: (n) => num(n, 0), unit: "kg", note: t("sustainability.kpi.co2.note") },
    hasRecycling && { key: "recy", label: t("sustainability.kpi.recyclingRate.label"), Icon: IconRecycle, value: latest.recycling_rate_pct ?? "—", format: (n) => n.toFixed(0), unit: latest.recycling_rate_pct != null ? "%" : "", note: t("sustainability.kpi.recyclingRate.note") },
    { key: "util", label: t("sustainability.kpi.avgUtilisation.label"), Icon: IconGauge, value: avg(b, (x) => x.utilisation_pct) ?? "—", format: (n) => n.toFixed(0), unit: "%", note: t("sustainability.kpi.avgUtilisation.note") },
    { key: "fuel", label: t("sustainability.kpi.fuel.label"), Icon: IconDrop, value: sum(b, (x) => x.fuel_used_litres), format: (n) => num(n, 0), unit: "L" },
    hasWaterRecycled && { key: "wrec", label: t("sustainability.kpi.waterRecycled.label"), Icon: IconRecycle, value: sum(b, (x) => x.water_recycled_litres), format: (n) => num(n, 0), unit: "L" },
  ].filter(Boolean);

  const visibleCharts = CHARTS.filter((c) =>
    (c.key !== "recycling_rate_pct" || hasRecycling) && (c.key !== "water_recycled_litres" || hasWaterRecycled)
  );

  // Only explains what's actually visible right now - no point describing a
  // hidden figure the customer can't see.
  const info = [
    t("sustainability.info.co2"),
    t("sustainability.info.fuelUsed"),
    t("sustainability.info.utilisation"),
    hasRecycling && t("sustainability.info.recyclingRate"),
    hasWaterRecycled && t("sustainability.info.waterRecycled"),
  ].filter(Boolean).join(" ");

  return (
    <>
      <div className="panel">
        <div className="usage-head">
          <div className="panel-head" style={{ margin: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <span className="kpi-ico"><IconLeaf /></span> {t("sustainability.title")}
              {vehicle?.name && <span className="stamp">{vehicle.name}</span>}
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div className="toggle">
              <button className={grain === "week" ? "active" : ""} onClick={() => setGrain("week")}>{t("common.grain.week")}</button>
              <button className={grain === "month" ? "active" : ""} onClick={() => setGrain("month")}>{t("common.grain.month")}</button>
            </div>
            <InfoTip label={t("sustainability.title")} text={info} />
          </div>
        </div>
        {err ? <div className="err">{err}</div>
          : buckets == null ? <SkelKpiStrip count={6} className="k6" />
          : <KpiStrip items={kpis} />}
      </div>

      {buckets != null && !err && (
        <div className="grid g3">
          {visibleCharts.map((c) => {
            const data = series(b, (x) => x[c.key]);
            const label = t(`sustainability.charts.${c.i18nKey}.label`);
            const allZero = c.hasZeroNote && data.length > 0 && data.every((d) => d.value === 0);
            return (
              <div className="panel" key={c.key}>
                <div className="panel-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{label} <span className="trend-unit">· {c.unit}</span></span>
                  <InfoTip label={label} text={t(`sustainability.charts.${c.i18nKey}.info`)} />
                </div>
                {data.length === 0 ? (
                  <div className="empty">{t("common.noDataForPeriod")}</div>
                ) : (
                  <TrendChart data={data} type={c.type} unit={c.unit} colorRole={c.colorRole}
                    grain={grain} height={180} />
                )}
                {allZero && <div className="empty">{t(`sustainability.charts.${c.i18nKey}.zeroNote`)}</div>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
