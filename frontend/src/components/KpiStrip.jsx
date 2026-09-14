import { useEffect, useRef, useState } from "react";
import InfoTip from "./InfoTip.jsx";

// A full-bleed row of KPI tiles, reused at the top of every page. Each item:
//   { key, label, value, unit, Icon, delta, deltaTone, note, spark, accent, format }
// `value` may be a number (animated count-up) or a ready string (shown as-is).
// `spark` is an array of numbers for a tiny trend line. `deltaTone` is
// "good" | "bad" | undefined. `format(n)` renders the counting number.

const reduceMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Count from 0 → target once when the target changes. Returns the live value.
function useCountUp(target) {
  const [n, setN] = useState(typeof target === "number" ? target : 0);
  const raf = useRef(0);
  useEffect(() => {
    if (typeof target !== "number" || !isFinite(target)) return;
    if (reduceMotion()) { setN(target); return; }
    const dur = 550, t0 = performance.now(), from = 0;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(from + (target - from) * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target]);
  return n;
}

function Sparkline({ points, color = "var(--brand)" }) {
  if (!points || points.length < 2) return null;
  const w = 100, h = 24;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - 3 - ((v - min) / span) * (h - 6);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${w} ${h}`} width="100%" height="24"
      preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Kpi({ item }) {
  const isNum = typeof item.value === "number";
  const live = useCountUp(isNum ? item.value : null);
  const shown = isNum
    ? (item.format ? item.format(live) : Math.round(live).toLocaleString("en-GB"))
    : item.value;
  const { Icon } = item;
  // EXPERIMENTAL, see OverviewPage.jsx - `infoTip: true` moves `note` off the
  // always-visible line below the value and into an (i) disclosure instead.
  const noteInTip = item.infoTip && item.note;
  return (
    <div className={"kpi-card" + (item.accent ? " accent" : "") + (item.flagged ? " gps-pending" : "")}>
      <div className="kpi-top">
        {Icon && <span className="kpi-ico"><Icon /></span>}
        <span className="kpi-label">{item.label}</span>
        {noteInTip && <InfoTip label={item.label} text={item.note} />}
      </div>
      <div className="kpi-value">
        {shown}{item.unit && <span className="kpi-unit">{item.unit}</span>}
      </div>
      {item.spark ? (
        <Sparkline points={item.spark} color={item.sparkColor} />
      ) : item.delta != null ? (
        <div className={"kpi-delta" + (item.deltaTone ? " " + item.deltaTone : "")}>
          {item.delta}{item.note && !noteInTip && <span className="kpi-delta-note"> {item.note}</span>}
        </div>
      ) : item.note && !noteInTip ? (
        <div className="kpi-delta"><span className="kpi-delta-note">{item.note}</span></div>
      ) : null}
    </div>
  );
}

// `resetKey` (e.g. the vehicle id) forces every InfoTip to remount closed
// when it changes - otherwise an open tooltip would just sit there, still
// showing the PREVIOUS vehicle's note, after switching vehicles.
export default function KpiStrip({ items, className = "", resetKey }) {
  const k = items.length === 6 ? " k6" : "";
  return (
    <div className={`kpi-strip${k} ${className}`.trim()} role="list">
      {items.map((it) => <Kpi key={`${resetKey}-${it.key}`} item={it} />)}
    </div>
  );
}
