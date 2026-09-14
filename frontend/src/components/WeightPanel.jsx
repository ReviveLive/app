import { useTranslation } from "react-i18next";

// Axle weight (spec section 2, feature 4) — real trial vehicle only, no
// demo-fleet equivalent. Total vehicle weight is live and well-populated
// (confirmed 2026-09-09); the per-axle breakdown the spec also calls for
// needs scania_axel_weight_revlive / scania_axel_location_revlive, both
// still missing from the feed (contractor follow-up) - shown as a pending
// note rather than blocking the panel, since the total is already usable.
export default function WeightPanel({ readings }) {
  const { t } = useTranslation();
  const total = readings?.["scania_total_weight_revlive"]?.value;
  const known = total != null;

  return (
    <div className="panel">
      <div className="tank-head">{t("overview.vehicleWeight.title")}</div>
      {!known ? (
        <div className="empty">{t("overview.vehicleWeight.noData")}</div>
      ) : (
        <>
          <div className="tank-value">{Math.round(total).toLocaleString("en-GB")}<span className="u">kg</span></div>
          <div className="tank-pct">{t("overview.vehicleWeight.total")}</div>
        </>
      )}
    </div>
  );
}
