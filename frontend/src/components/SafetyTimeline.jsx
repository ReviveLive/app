import { useTranslation } from "react-i18next";
import { pad2, fmtWeek, fmtMonth, fmtDay } from "../dates.js";

// Safety events are RARE, discrete incidents — not a continuous quantity — so a
// bar chart misrepresents them twice over: every bar is the same height (each
// period has ~1 event, nothing to compare), and the API returns only the periods
// that HAD an event, so the zero-periods silently vanish and the survivors sit
// shoulder-to-shoulder as if they were consecutive.
//
// This plots each event as a dot on the real time axis for the whole period, so
// the empty space between dots is itself the message: incidents are few and far
// between. `domain` is the full [firstBucket … lastBucket] range of the Trends
// period (derived from a full-coverage metric), NOT the safety buckets — that's
// what keeps the quiet weeks on the axis.
const SAFETY = "#dc2626"; // red — mirrors the safety_events colour in TrendsPage

const toMs = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

// The 1st of every month the domain touches, e.g. Apr 13 → Jul 6 gives
// Apr/May/Jun/Jul — used for the light month gridlines and axis labels.
function monthFirsts(start, end) {
  const [ys, ms] = start.split("-").map(Number);
  const [ye, me] = end.split("-").map(Number);
  const out = [];
  let y = ys, m = ms;
  while (y < ye || (y === ye && m <= me)) {
    out.push(`${y}-${pad2(m)}-01`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

export default function SafetyTimeline({ events = [], domain, grain = "week" }) {
  const { t } = useTranslation();
  const label = grain === "month" ? fmtMonth : grain === "week" ? fmtWeek : fmtDay;
  const total = events.reduce((s, e) => s + (e.value || 0), 0);

  // Guard: no range to plot against → fall back to a plain empty state.
  const ok = domain && domain[0] && domain[1];
  const t0 = ok ? toMs(domain[0]) : 0;
  const span = ok ? Math.max(1, toMs(domain[1]) - t0) : 1;
  const pos = (iso) => ((toMs(iso) - t0) / span) * 100;

  const months = ok ? monthFirsts(domain[0], domain[1]) : [];

  return (
    <div className="panel">
      <div className="usage-head">
        <h2 style={{ margin: 0 }}>{t("trends.safetyTimeline.title")} <span className="trend-unit">· events</span></h2>
        {ok && events.length > 0 && (
          <span className="safety-count">{t("trends.safetyTimeline.inThisPeriod", { count: total })}</span>
        )}
      </div>

      {!ok || events.length === 0 ? (
        <div className="empty">{t("trends.safetyTimeline.noEvents")}</div>
      ) : (
        <div className="safety-timeline">
          <div className="safety-track">
            {months.map((m) => {
              const p = pos(m);
              return p >= 0 && p <= 100 ? (
                <span className="safety-monthtick" key={m} style={{ left: `${p}%` }} />
              ) : null;
            })}
            <div className="safety-line" />
            {events.map((e, i) => {
              const p = Math.min(100, Math.max(0, pos(e.bucket)));
              // Keep the tooltip on-panel: pin it to the dot's edge near the ends
              // instead of centring it, so it can't clip past the panel border.
              const tip = p >= 80 ? "tip-end" : p <= 20 ? "tip-start" : "";
              return (
                <span key={i} className={`safety-dot ${tip}`.trim()} style={{ left: `${p}%` }}
                  data-tip={t("trends.safetyTimeline.tooltip", { count: e.value, when: label(e.bucket) })} />
              );
            })}
          </div>
          <div className="safety-axis">
            {months.map((m, i) => {
              const p = Math.min(100, Math.max(0, pos(m)));
              // First/last labels hug the edges so they don't clip off-panel.
              const anchor = i === 0 ? "start" : i === months.length - 1 ? "end" : "mid";
              return (
                <span className={`safety-monthlabel ${anchor}`} key={m} style={{ left: `${p}%` }}>
                  {fmtMonth(m)}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
