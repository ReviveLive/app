import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { getRpm } from "../api.js";
import { fmtDay, fmtMonth, fmtWeek, fmtDayAxis, fmtWeekAxis } from "../dates.js";
import { fmtAxisTick } from "../format.js";
import { useChartTheme } from "../theme.js";
import { usePeriodPaging } from "../usePeriodPaging.js";
import GrainToggle from "./GrainToggle.jsx";
import PeriodNav from "./PeriodNav.jsx";

// Average engine RPM per week or month, split exclusively: PTO off vs PTO on.
// PTO-off covers both idling and driving — separating those needs a speed
// signal, deferred until the fuller Scania ECU file arrives. The two series use
// the validated green/violet pair (CVD-safe) plus a legend as the required
// secondary encoding.
export default function RpmChart({ vehicleId }) {
  const { t } = useTranslation();
  const C = useChartTheme();
  const [grain, setGrain] = useState("week");
  const [buckets, setBuckets] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let live = true;
    getRpm(grain, vehicleId)
      .then((r) => live && (setBuckets(r.buckets), setErr(null)))
      .catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [grain, vehicleId]);

  // Compact axis ticks that read differently per grain ("Mon 06" vs "06 Apr"),
  // with a fuller tooltip label.
  const tickFmt = grain === "month" ? fmtMonth : grain === "week" ? fmtWeekAxis : fmtDayAxis;
  const labelFmt = grain === "month" ? fmtMonth : grain === "week" ? fmtWeek : fmtDay;

  // Page a bounded window at a time (a week of days, or a fixed run of
  // weeks/months) so the bars stay readable however much history there is.
  const { view: chartData, label, go, atOldest, atNewest, empty } =
    usePeriodPaging(buckets, grain);

  return (
    <div className="panel">
      <div className="usage-head">
        <h2 style={{ margin: 0 }}>{t("trends.rpmChart.title")}</h2>
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
        <div className="empty">{t("trends.rpmChart.noData")}</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} strokeDasharray="5 5" vertical={false} />
              <XAxis dataKey="bucket" tickFormatter={tickFmt}
                tick={{ fill: C.tick, fontSize: 11, fontFamily: "DM Mono" }}
                tickLine={false} axisLine={{ stroke: C.axis }} />
              <YAxis tick={{ fill: C.tick, fontSize: 11, fontFamily: "DM Mono" }}
                tickFormatter={fmtAxisTick} tickLine={false} axisLine={false} width={44} />
              <Tooltip
                cursor={{ fill: "rgba(20,176,83,0.08)" }}
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)",
                  borderRadius: 12, fontFamily: "DM Mono", fontSize: 12, color: "var(--ink)" }}
                itemStyle={{ color: "var(--ink)" }}
                labelStyle={{ color: "var(--ink-dim)" }}
                labelFormatter={labelFmt}
                formatter={(v) => [`${v} rpm`]} />
              <Bar dataKey="avg_rpm_off" name={t("trends.rpmChart.ptoOff")} fill={C.green} radius={[5, 5, 5, 5]} />
              <Bar dataKey="avg_rpm_pto" name={t("trends.rpmChart.atWork")} fill={C.violet} radius={[5, 5, 5, 5]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="coords">
            <span><i className="sw" /> {t("trends.rpmChart.ptoOff")}</span>
            <span><i className="sw work" /> {t("trends.rpmChart.atWork")}</span>
          </div>
        </>
      )}
    </div>
  );
}
