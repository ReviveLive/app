import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { fetchPumpUsage, PUMPS } from "../pumps.js";
import { fmtDay, fmtWeek, fmtMonth, fmtDayAxis } from "../dates.js";
import { fmtAxisTick } from "../format.js";
import { useChartTheme } from "../theme.js";
import { usePeriodPaging } from "../usePeriodPaging.js";
import GrainToggle from "./GrainToggle.jsx";
import PeriodNav from "./PeriodNav.jsx";

// PTO/pump activity, in minutes, grouped by period - a bar-chart recreation
// of a chart from an earlier iteration of the project (Joe, 2026-09-12: no
// longer has access to the original, before he took over). Same underlying
// data as PTO Utilisation above (fetchPumpUsage) - that panel shows one
// period at a time as a percentage-of-PTO-time share; this shows several
// periods side by side as absolute minutes, so a trend across weeks/months
// is easier to read at a glance.
//
// Grouped bars, not stacked: PTO and the three pumps OVERLAP in time (a pump
// only runs while PTO is on, and more than one pump can run at once), so
// summing them into one stacked bar would misrepresent total time (same
// non-summing rule pumps.js's own header comment documents for PumpUsage/
// PumpTrend).
const PTO_SERIES = { field: "pto", label: "PTO", labelKey: "pumps.labels.pto", color: "green" };

export default function PumpActivityBars({ vehicleId, vehicle }) {
  const { t } = useTranslation();
  const C = useChartTheme();
  const [grain, setGrain] = useState("week");
  const [rows, setRows] = useState([]);
  const [present, setPresent] = useState({});
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!vehicleId) return;
    let live = true;
    fetchPumpUsage(vehicleId, grain, vehicle)
      .then(({ rows, present }) => live && (setRows(rows), setPresent(present), setErr(null)))
      .catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [vehicleId, grain, vehicle]);

  const series = [PTO_SERIES, ...PUMPS.filter((p) => present[p.field])];

  const { view: chartData, label, go, atOldest, atNewest, empty } =
    usePeriodPaging(rows, grain);

  const monthAtChange = (bucket, index) => {
    const cur = String(bucket).slice(0, 7);
    const prev = index > 0 ? String(chartData[index - 1]?.bucket).slice(0, 7) : null;
    return cur !== prev ? fmtMonth(bucket) : "";
  };

  return (
    <div className="panel">
      <div className="usage-head">
        <h2 style={{ margin: 0 }}>{t("pumps.activityBars.title")}</h2>
        <GrainToggle grain={grain} onChange={setGrain} />
      </div>
      <div className="panel-sub">{t("pumps.activityBars.subtitle")}</div>

      {!empty && !err && (
        <PeriodNav label={label} onPrev={() => go(-1)} onNext={() => go(1)}
          atStart={atOldest} atEnd={atNewest} />
      )}

      {err ? (
        <div className="err">{err}</div>
      ) : chartData.length === 0 ? (
        <div className="empty">{t("pumps.activityBars.noData")}</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={C.grid} strokeDasharray="5 5" vertical={false} />
            <XAxis dataKey="bucket"
              tickFormatter={grain === "week" ? monthAtChange : grain === "month" ? fmtMonth : fmtDayAxis}
              interval={grain === "day" ? "preserveStartEnd" : 0}
              tick={{ fill: C.tick, fontSize: 11, fontFamily: "DM Mono" }}
              tickLine={false} axisLine={{ stroke: C.axis }} />
            <YAxis tick={{ fill: C.tick, fontSize: 11, fontFamily: "DM Mono" }}
              tickFormatter={fmtAxisTick} tickLine={false} axisLine={false} width={42} />
            <Tooltip
              cursor={{ fill: "rgba(20,176,83,0.08)" }}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)",
                borderRadius: 12, fontFamily: "DM Mono", fontSize: 12, color: "var(--ink)" }}
              itemStyle={{ color: "var(--ink)" }}
              labelStyle={{ color: "var(--ink-dim)" }}
              labelFormatter={grain === "week" ? fmtWeek : grain === "month" ? fmtMonth : fmtDay}
              formatter={(v, name) => [`${Math.round(v)} min`, name]} />
            <Legend wrapperStyle={{ fontFamily: "DM Mono", fontSize: 12 }} />
            {series.map((s) => (
              <Bar key={s.field} dataKey={s.field} name={t(s.labelKey)} fill={C[s.color]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
