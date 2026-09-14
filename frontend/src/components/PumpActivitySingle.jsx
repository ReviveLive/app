import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { getUsage } from "../api.js";
import { PTO, PUMPS, REAL_PTO, REAL_PUMPS } from "../pumps.js";
import { fmtDay, fmtWeek, fmtMonth, fmtDayAxis } from "../dates.js";
import { fmtAxisTick } from "../format.js";
import { useChartTheme } from "../theme.js";
import { usePeriodPaging } from "../usePeriodPaging.js";
import GrainToggle from "./GrainToggle.jsx";
import PeriodNav from "./PeriodNav.jsx";

// Individual pump activity — pick ONE of PTO/Vacuum/Jet/Recycle and see just
// that signal's minutes-run per period. A recreation of a chart from an
// earlier project iteration a supervisor sent Joe a picture of (2026-09-12,
// no source access) - read from that picture as: a PTO/Vacuum/Jet/Recycle
// selector, a Daily/Weekly grain toggle, and a plain single-colour bar chart
// of that one signal's minutes. Complements PumpActivityBars above (all
// four together, grouped) by letting one signal's own trend be read without
// the others alongside it. Colours here follow each pump's own established
// role (PTO green, Vacuum blue, Jet violet, Recycle teal - same as
// PumpUtilisation/PumpActivityBars) rather than the single flat colour the
// picture happened to show for its one example (PTO, which is green anyway
// in that scheme) - the source picture never showed what another signal's
// colour would be, so this isn't a deviation from anything actually seen.
export default function PumpActivitySingle({ vehicleId, vehicle }) {
  const { t } = useTranslation();
  const C = useChartTheme();
  const [selected, setSelected] = useState("pto");
  const [grain, setGrain] = useState("week");
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);

  const real = vehicle?.source === "live" || vehicle?.source === "trial_demo";
  const series = useMemo(
    () => [real ? REAL_PTO : PTO, ...(real ? REAL_PUMPS : PUMPS)],
    [real]
  );
  const current = series.find((s) => s.field === selected) || series[0];

  useEffect(() => {
    if (!vehicleId) return;
    let live = true;
    setRows([]);
    getUsage(current.key, grain, vehicleId)
      .then((r) => live && (setRows(r.buckets || []), setErr(null)))
      .catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [vehicleId, grain, current.key]); // eslint-disable-line

  const { view: chartData, label, go, atOldest, atNewest, empty } =
    usePeriodPaging(rows, grain);

  const monthAtChange = (bucket, index) => {
    const cur = String(bucket).slice(0, 7);
    const prev = index > 0 ? String(chartData[index - 1]?.bucket).slice(0, 7) : null;
    return cur !== prev ? fmtMonth(bucket) : "";
  };

  const color = C[current.color || "green"];

  return (
    <div className="panel">
      <div className="usage-head">
        <h2 style={{ margin: 0 }}>{t("pumps.activitySingle.title")}</h2>
      </div>
      <div className="toggle" style={{ marginBottom: 10 }}>
        {series.map((s) => (
          <button key={s.field} className={selected === s.field ? "active" : ""}
            onClick={() => setSelected(s.field)}>{t(s.labelKey)}</button>
        ))}
      </div>
      <div className="usage-head">
        <GrainToggle grain={grain} onChange={setGrain} />
      </div>

      {!empty && !err && (
        <PeriodNav label={label} onPrev={() => go(-1)} onNext={() => go(1)}
          atStart={atOldest} atEnd={atNewest} />
      )}

      {err ? (
        <div className="err">{err}</div>
      ) : chartData.length === 0 ? (
        <div className="empty">{t("pumps.activitySingle.noData", { pump: t(current.labelKey) })}</div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
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
              formatter={(v) => [`${Math.round(v)} min`, t(current.labelKey)]} />
            <Bar dataKey="minutes" name={t(current.labelKey)} fill={color} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
