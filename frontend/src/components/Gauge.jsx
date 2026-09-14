import { useTranslation } from "react-i18next";
import { formatPointValue } from "../maintenance.js";

// health.status.{status} mirrors maintenance.js's STATUS_TEXT (kept there,
// plain English, for ReportDialog.jsx - not yet translated).
const STATUS_KEY = { green: "ok", amber: "serviceSoon", red: "serviceDue", unknown: "noReading" };

// Semicircular maintenance gauge: a zoned arc (green -> amber -> red split at the
// warn/limit thresholds) with a needle at the current value. Read-only, last-known.
// Colours come from CSS classes (see styles.css) so dark mode themes for free.

// Gauge geometry (in SVG user units; the viewBox scales it responsively).
const CX = 100;          // centre x
const CY = 100;          // centre y (baseline of the semicircle)
const R = 80;            // arc radius
const STROKE = 16;       // arc thickness
const START = 180;       // left end of the semicircle (degrees)
const END = 0;           // right end

// Polar -> cartesian. 180deg = left, 0deg = right, measured so the arc sweeps
// across the top of the circle.
function polarToCartesian(cx, cy, r, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

// SVG path for the arc from startAngle to endAngle (angles decreasing 180 -> 0).
function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = Math.abs(startAngle - endAngle) > 180 ? 1 : 0;
  // sweep-flag 1 = clockwise, which draws over the top as angle decreases.
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

// Map a value on [0, max] to an angle on [180, 0], clamped to the arc.
function valueToAngle(v, max) {
  const frac = Math.max(0, Math.min(1, v / max));
  return START - frac * (START - END);
}

export default function Gauge({ value, warn, limit, kind, label, status, compact, pending }) {
  const { t } = useTranslation();
  // Scale runs a bit past the limit so the red "over limit" zone has room.
  const max = limit * 1.25;
  const known = value != null;

  const warnAngle = valueToAngle(warn, max);
  const limitAngle = valueToAngle(limit, max);
  const valueAngle = known ? valueToAngle(value, max) : null;

  // Needle endpoint (stops just inside the arc).
  const needle = known ? polarToCartesian(CX, CY, R - STROKE / 2 - 2, valueAngle) : null;
  // Limit tick: a short radial mark straddling the arc.
  const limitOuter = polarToCartesian(CX, CY, R + STROKE / 2 + 3, limitAngle);
  const limitInner = polarToCartesian(CX, CY, R - STROKE / 2 - 3, limitAngle);

  return (
    <div className={`gauge-card${compact ? " compact" : ""}${pending ? " gps-pending" : ""}`}>
      <svg className="gauge-svg" viewBox="0 0 200 124" role="img"
        aria-label={`${label}: ${formatPointValue(value, kind)} of limit ${formatPointValue(limit, kind)}`}>
        {/* Faint full track underneath everything */}
        <path className="gauge-track" d={describeArc(CX, CY, R, START, END)}
          fill="none" strokeWidth={STROKE} strokeLinecap="round" />

        {known ? (
          <>
            {/* Zone segments: green 0->warn, amber warn->limit, red limit->max */}
            <path className="gauge-zone green" d={describeArc(CX, CY, R, START, warnAngle)}
              fill="none" strokeWidth={STROKE} strokeLinecap="round" />
            <path className="gauge-zone amber" d={describeArc(CX, CY, R, warnAngle, limitAngle)}
              fill="none" strokeWidth={STROKE} />
            <path className="gauge-zone red" d={describeArc(CX, CY, R, limitAngle, END)}
              fill="none" strokeWidth={STROKE} strokeLinecap="round" />

            {/* Limit tick */}
            <line className="gauge-limit-tick"
              x1={limitInner.x} y1={limitInner.y} x2={limitOuter.x} y2={limitOuter.y} />

            {/* Needle + hub at the current value */}
            <line className={`gauge-needle ${status}`}
              x1={CX} y1={CY} x2={needle.x} y2={needle.y} />
            <circle className={`gauge-hub ${status}`} cx={CX} cy={CY} r={6} />
          </>
        ) : (
          // Unknown: a single greyed track, no needle.
          <path className="gauge-zone unknown" d={describeArc(CX, CY, R, START, END)}
            fill="none" strokeWidth={STROKE} strokeLinecap="round" />
        )}
      </svg>

      <div className="gauge-meta">
        <div className="gauge-label">{label}</div>
        <div className={`gauge-val ${status}`}>{formatPointValue(value, kind)}</div>
        <div className="gauge-sub">{t("health.gauge.limit")} {formatPointValue(limit, kind)}</div>
        <span className={`mnt-badge ${status}`}>{t(`health.status.${STATUS_KEY[status]}`)}</span>
      </div>
    </div>
  );
}
