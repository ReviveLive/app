import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { fetchPumpUsage, PUMPS } from "../pumps.js";
import { fmtDay, fmtWeek, fmtMonth, fmtDayAxis } from "../dates.js";
import { fmtAxisTick } from "../format.js";
import { useChartTheme } from "../theme.js";
import { usePeriodPaging } from "../usePeriodPaging.js";
import GrainToggle from "./GrainToggle.jsx";
import PeriodNav from "./PeriodNav.jsx";

// Per-pump run-time over time — vacuum, jet and recycle plotted as separate
// lines rather than stacked, because the three OVERLAP in time (jet/recycle
// can run while vacuum does), so summing them would misrepresent total pump
// time (CLAUDE.md non-negotiable #3 — see pumps.js's header comment for the
// same rule applied to PumpUsage's PTO working/idle split). Complements that
// working-vs-idle envelope chart by showing which pump is driving the work.
export default function PumpTrend({ vehicleId, vehicle }) {
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

  const shownPumps = PUMPS.filter((p) => present[p.field]);

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
        <h2 style={{ margin: 0 }}>{t("pumps.trend.title")}</h2>
        <GrainToggle grain={grain} onChange={setGrain} />
      </div>

      {!empty && !err && (
        <PeriodNav label={label} onPrev={() => go(-1)} onNext={() => go(1)}
          atStart={atOldest} atEnd={atNewest} />
      )}

      {err ? (
        <div className="err">{err}</div>
      ) : shownPumps.length === 0 || chartData.length === 0 ? (
        <div className="empty">{t("pumps.trend.noData")}</div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={C.grid} strokeDasharray="5 5" vertical={false} />
            <XAxis dataKey="bucket"
              tickFormatter={grain === "week" ? monthAtChange : grain === "month" ? fmtMonth : fmtDayAxis}
              interval={grain === "day" ? "preserveStartEnd" : 0}
              tick={{ fill: C.tick, fontSize: 11, fontFamily: "DM Mono" }}
              tickLine={false} axisLine={{ stroke: C.axis }} />
            <YAxis tick={{ fill: C.tick, fontSize: 11, fontFamily: "DM Mono" }}
              tickFormatter={fmtAxisTick} tickLine={false} axisLine={false} width={42} />
            <Tooltip
              cursor={{ stroke: C.axis }}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)",
                borderRadius: 12, fontFamily: "DM Mono", fontSize: 12, color: "var(--ink)" }}
              itemStyle={{ color: "var(--ink)" }}
              labelStyle={{ color: "var(--ink-dim)" }}
              labelFormatter={grain === "week" ? fmtWeek : grain === "month" ? fmtMonth : fmtDay}
              formatter={(v, name) => [`${Math.round(v)} min`, name]} />
            <Legend wrapperStyle={{ fontFamily: "DM Mono", fontSize: 12 }} />
            {shownPumps.map((p) => (
              <Line key={p.field} type="monotone" dataKey={p.field} name={t(p.labelKey)}
                stroke={C[p.color]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
