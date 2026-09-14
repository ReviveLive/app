import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { getPtoTimeline } from "../api.js";
import { fmtDay } from "../dates.js";
import { useChartTheme } from "../theme.js";
import { SkelBar } from "./Skeleton.jsx";

// One day's exact PTO/pump on-off transitions — the raw state signals, not
// aggregated into a percentage the way PumpUtilisation shows them. Each
// signal gets its own horizontal lane (so overlapping pumps don't draw on
// top of each other) and only draws a line while ON — nothing while off —
// so there's no step height to interpret: a coloured segment IS "on", empty
// space IS "off".
const LANE_GAP = 1.3;
// Display order top to bottom - PTO (the envelope) above the three pumps it
// enables. `labelKey` mirrors pumps.js's convention (own array here since the
// field names differ - pto/vac/jet/rec vs pumps.js's pto/vacuum/jet/recycle).
const SERIES = [
  { field: "pto", label: "PTO", labelKey: "pumps.labels.pto", colorRole: "green" },
  { field: "vac", label: "Vacuum", labelKey: "pumps.labels.vacuum", colorRole: "blue" },
  { field: "jet", label: "Jet", labelKey: "pumps.labels.jet", colorRole: "violet" },
  { field: "rec", label: "Recycle", labelKey: "pumps.labels.recycle", colorRole: "teal" },
];

const toMs = (iso) => new Date(iso).getTime();
const fmtTimeOfDay = (ms) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// One series' chart-ready on-segments: null everywhere except while the
// signal is on, where it sits flat at `laneY`. Explicit start/end points
// bracket every segment, so even a brief on-pulse (a single change-based
// reading in, one right back out) still renders as a visible block instead
// of an isolated, invisible point.
function onSegments(points, field, laneY) {
  const rows = [];
  let onSince = null;
  for (const p of points) {
    const t = toMs(p.ts);
    const on = p[field] === 1;
    if (on && onSince === null) {
      onSince = t;
      rows.push({ x: t, y: laneY });
    } else if (!on && onSince !== null) {
      rows.push({ x: t, y: laneY });
      rows.push({ x: t, y: null });
      onSince = null;
    }
  }
  if (onSince !== null && points.length) {
    rows.push({ x: toMs(points[points.length - 1].ts), y: laneY });
  }
  return rows;
}

export default function PumpTimeline({ vehicleId }) {
  const { t } = useTranslation();
  const C = useChartTheme();
  const [days, setDays] = useState([]);
  const [day, setDay] = useState(null);
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => { setDay(null); }, [vehicleId]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getPtoTimeline(day, vehicleId)
      .then((r) => {
        if (!live) return;
        setDays(r.days);
        if (r.day !== day) setDay(r.day);
        setPoints(r.points);
        setErr(null);
      })
      .catch((e) => live && setErr(String(e)))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [day, vehicleId]); // eslint-disable-line

  const i = days.indexOf(day);
  const go = (delta) => setDay(days[i + delta]);
  const noData = !loading && days.length === 0;

  const tMin = points.length ? toMs(points[0].ts) : 0;
  const tMax = points.length ? toMs(points[points.length - 1].ts) : 1;
  const laneOf = (idx) => (SERIES.length - 1 - idx) * LANE_GAP;

  return (
    <div className="panel">
      <div className="panel-head">{t("pumps.timeline.title")}</div>
      <div className="panel-sub">{t("pumps.timeline.subtitle")}</div>

      {noData ? (
        <div className="empty">{t("pumps.timeline.noData")}</div>
      ) : (
        <>
          <div className="route-nav">
            <button className="navbtn" disabled={loading || i <= 0} onClick={() => go(-1)}>‹ {t("common.nav.prev")}</button>
            <span className="route-day">{day ? fmtDay(day) : ""}</span>
            <button className="navbtn" disabled={loading || i < 0 || i >= days.length - 1} onClick={() => go(1)}>{t("common.nav.next")} ›</button>
          </div>

          {loading ? (
            <SkelBar style={{ marginTop: 14 }} />
          ) : err ? (
            <div className="err">{err}</div>
          ) : points.length === 0 ? (
            <div className="empty">{t("pumps.timeline.noDayData")}</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke={C.grid} strokeDasharray="5 5" vertical={false} />
                  <XAxis dataKey="x" type="number" domain={[tMin, tMax]} tickFormatter={fmtTimeOfDay}
                    minTickGap={40} tick={{ fill: C.tick, fontSize: 11, fontFamily: "DM Mono" }}
                    tickLine={false} axisLine={{ stroke: C.axis }} />
                  <YAxis hide domain={[0, SERIES.length * LANE_GAP]} />
                  <Tooltip
                    labelFormatter={fmtTimeOfDay}
                    formatter={(value, name) => [value == null ? t("pumps.timeline.off") : t("pumps.timeline.on"), name]}
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)",
                      borderRadius: 12, fontFamily: "DM Mono", fontSize: 12, color: "var(--ink)" }}
                    labelStyle={{ color: "var(--ink-dim)" }} />
                  {SERIES.map((s, idx) => (
                    <Line key={s.field} data={onSegments(points, s.field, laneOf(idx))}
                      dataKey="y" name={t(s.labelKey)} type="linear"
                      stroke={C[s.colorRole] || C.green} strokeWidth={6} dot={false}
                      connectNulls={false} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              <div className="coords">
                {SERIES.map((s) => (
                  <span key={s.field}><i className={`sw ${s.field === "pto" ? "active" : s.field}`} /> {t(s.labelKey)}</span>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
