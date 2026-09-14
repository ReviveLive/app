import { useId } from "react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import { fmtDay, fmtWeek, fmtMonth, fmtDayAxis, fmtWeekAxis } from "../dates.js";
import { fmtAxisTick } from "../format.js";
import { useChartTheme } from "../theme.js";

// One reusable trend chart, so the axis/tooltip/grid config isn't repeated per
// metric. `type` picks the visual: "area"/"line" for continuous trends, "bar"
// for per-period counts. `colorRole` (e.g. "green") resolves to the themed
// series colour; a literal `color` still works as a fallback. Grid/tick/axis
// come from the chart theme so the whole thing recolours on dark-mode toggle.

// Axis ticks stay compact, and daily vs weekly read differently ("Mon 06" vs
// "06 Apr") so the two grains can't be confused at a glance; the tooltip label is
// spelled out in full (the Mon–Sun range for weeks, the full date for days).
const tickFmt = (grain) =>
  grain === "month" ? fmtMonth : grain === "week" ? fmtWeekAxis : fmtDayAxis;
const labelFmt = (grain) =>
  grain === "month" ? fmtMonth : grain === "week" ? fmtWeek : fmtDay;

export default function TrendChart({ data, type = "area", unit, color, colorRole = "green", grain = "week", height = 200 }) {
  const gid = useId();                       // unique per instance — area gradient
  const C = useChartTheme();
  const stroke = color || C[colorRole] || C.green;
  const tf = tickFmt(grain);
  const lf = labelFmt(grain);
  const fmtValue = (v) => [`${v} ${unit}`, ""];

  const axes = (
    <>
      <CartesianGrid stroke={C.grid} strokeDasharray="5 5" vertical={false} />
      <XAxis dataKey="bucket" tickFormatter={tf} interval="preserveStartEnd" minTickGap={20}
        tick={{ fill: C.tick, fontSize: 11, fontFamily: "DM Mono" }}
        tickLine={false} axisLine={{ stroke: C.axis }} />
      <YAxis tick={{ fill: C.tick, fontSize: 11, fontFamily: "DM Mono" }}
        tickFormatter={fmtAxisTick} tickLine={false} axisLine={false} width={44} />
      <Tooltip
        cursor={{ fill: "rgba(20,176,83,0.08)", stroke }}
        contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)",
          borderRadius: 12, fontFamily: "DM Mono", fontSize: 12, color: "var(--ink)" }}
        itemStyle={{ color: "var(--ink)" }}
        labelStyle={{ color: "var(--ink-dim)" }}
        labelFormatter={lf}
        formatter={fmtValue} />
    </>
  );

  return (
    <ResponsiveContainer width="100%" height={height}>
      {type === "bar" ? (
        <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          {axes}
          <Bar dataKey="value" radius={[6, 6, 6, 6]}>
            {data.map((_, i) => <Cell key={i} fill={stroke} />)}
          </Bar>
        </BarChart>
      ) : type === "line" ? (
        <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          {axes}
          <Line type="monotone" dataKey="value" stroke={stroke} strokeWidth={2.5}
            dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      ) : (
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.32} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          {axes}
          <Area type="monotone" dataKey="value" stroke={stroke} strokeWidth={2.5}
            fill={`url(#${gid})`} />
        </AreaChart>
      )}
    </ResponsiveContainer>
  );
}
