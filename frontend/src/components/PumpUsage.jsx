import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { fetchPumpUsage, workingMin } from "../pumps.js";
import { fmtDay, fmtWeek, fmtMonth, fmtDayAxis } from "../dates.js";
import { fmtAxisTick } from "../format.js";
import { useChartTheme } from "../theme.js";
import { usePeriodPaging } from "../usePeriodPaging.js";
import GrainToggle from "./GrainToggle.jsx";
import PeriodNav from "./PeriodNav.jsx";

// PTO time over time, split into WORKING (≥1 pump running, green) and IDLE (PTO
// on but no pump engaged, amber). The two stack to the full PTO envelope — a
// legitimate stack because they're mutually exclusive, unlike the overlapping
// pumps. Shows when idling happens and whether it's trending.
export default function PumpUsage({ vehicleId }) {
  const { t } = useTranslation();
  const C = useChartTheme();
  const [grain, setGrain] = useState("week");
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!vehicleId) return;
    let live = true;
    fetchPumpUsage(vehicleId, grain)
      .then(({ rows }) => live && (setRows(rows), setErr(null)))
      .catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [vehicleId, grain]);

  // Derive the two stacked series once per row.
  const data = useMemo(
    () => rows.map((r) => ({ bucket: r.bucket, working: workingMin(r), idle: r.idle })),
    [rows],
  );

  // Page a bounded window at a time (a week of days, or a fixed run of
  // weeks/months) so the bars stay readable however much history there is.
  const { view: chartData, label, go, atOldest, atNewest, empty } =
    usePeriodPaging(data, grain);

  // Weekly x-axis: label only where the month changes, so the axis reads
  // "Apr … May … Jun" instead of a wall of Monday dates.
  const monthAtChange = (bucket, index) => {
    const cur = String(bucket).slice(0, 7);
    const prev = index > 0 ? String(chartData[index - 1]?.bucket).slice(0, 7) : null;
    return cur !== prev ? fmtMonth(bucket) : "";
  };

  return (
    <div className="panel">
      <div className="usage-head">
        <h2 style={{ margin: 0 }}>{t("pumps.usage.title")}</h2>
        <GrainToggle grain={grain} onChange={setGrain} />
      </div>

      {/* Step between windows, mirroring the route history card. */}
      {!empty && !err && (
        <PeriodNav label={label} onPrev={() => go(-1)} onNext={() => go(1)}
          atStart={atOldest} atEnd={atNewest} />
      )}

      {err ? (
        <div className="err">{err}</div>
      ) : chartData.length === 0 ? (
        <div className="empty">{t("pumps.usage.noData")}</div>
      ) : (
        <>
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
                formatter={(v, name) => [`${Math.round(v)} min`, name]} />
              {/* Stacked: working (bottom) + idle (top) = total PTO time. */}
              <Bar dataKey="working" name={t("pumps.utilisation.pumpsActive")} stackId="pto" fill={C.green} />
              <Bar dataKey="idle" name={t("pumps.utilisation.ptoIdle")} stackId="pto" fill={C.amber} radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          {/* Legend is the required secondary encoding alongside colour. */}
          <div className="coords">
            <span><i className="sw active" /> {t("pumps.usage.pumpsActiveLong")}</span>
            <span><i className="sw idle" /> {t("pumps.usage.ptoIdleLong")}</span>
          </div>
        </>
      )}
    </div>
  );
}
