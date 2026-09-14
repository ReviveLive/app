import { useTranslation } from "react-i18next";

// Loading skeletons — neumorphic shimmer placeholders shaped like the content
// they stand in for, so a panel holds its layout instead of flashing "Loading…"
// and then jumping when the real data lands. The shimmer sweep is defined once
// in styles.css (.skel-line); these components just compose it into the right
// shapes. Each carries a visually-hidden "Loading…" for screen readers.

// KPI / measured-card strip (Trends, Costing) — label line + value line per card.
export function SkelKpiStrip({ count = 4, className = "" }) {
  const { t } = useTranslation();
  return (
    <div className={`kpi-strip ${className}`.trim()} role="status">
      <span className="sr-only">{t("common.loading")}</span>
      {Array.from({ length: count }).map((_, i) => (
        <div className="kpi-card" key={i} aria-hidden="true">
          <div className="skel-line" style={{ width: "55%", height: 12 }} />
          <div className="skel-line" style={{ width: "78%", height: 22, marginTop: 14 }} />
        </div>
      ))}
    </div>
  );
}

// Event rows (Alerts) — mirrors .estop-row: leading dot, two text lines, a time.
export function SkelRows({ count = 3 }) {
  const { t } = useTranslation();
  return (
    <ul className="estop-list" role="status">
      <span className="sr-only">{t("common.loading")}</span>
      {Array.from({ length: count }).map((_, i) => (
        <li className="estop-row" key={i} aria-hidden="true">
          <span className="skel-dot" />
          <div className="estop-text" style={{ flex: 1 }}>
            <div className="skel-line" style={{ width: "42%", height: 13 }} />
            <div className="skel-line" style={{ width: "68%", height: 11, marginTop: 9 }} />
          </div>
          <span className="skel-line" style={{ width: 104, height: 11 }} />
        </li>
      ))}
    </ul>
  );
}

// A single full-width bar (Route coords strip) — shaped like an inset pill row.
export function SkelBar({ height = 48, style }) {
  const { t } = useTranslation();
  return (
    <div role="status" style={style}>
      <span className="sr-only">{t("common.loading")}</span>
      <div className="skel-line" style={{ width: "100%", height, borderRadius: 20 }} aria-hidden="true" />
    </div>
  );
}
