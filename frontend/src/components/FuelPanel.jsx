import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getFuelDay } from "../api.js";
import { fmtDay } from "../dates.js";
import { SkelBar } from "./Skeleton.jsx";

// Fuel consumed on the focused day, split by whether the PTO was engaged
// ("at work") vs not ("travel / idle") — the fuel companion to the activity
// card, mirroring its split bar and following the same selected day. The
// backend (api.py's fuel_day()) can fall back to the nearest day that
// actually has fuel data, same as /api/route does for GPS - surfaced here
// the same way OverviewPage's ActivityPanel and RoutePanel do for their own,
// differently-scoped data.
const fmtL = (n) => `${(n ?? 0).toFixed(1)} L`;

export default function FuelPanel({ vehicleId, day, requestedDay }) {
  const { t } = useTranslation();
  const [fuel, setFuel] = useState(null);

  useEffect(() => {
    if (!vehicleId) return;
    let live = true;
    setFuel(null);
    getFuelDay(day, vehicleId).then((r) => live && setFuel(r)).catch(() => live && setFuel({}));
    return () => { live = false; };
  }, [vehicleId, day]);

  const work = fuel?.work_litres ?? 0;
  const idle = fuel?.idle_litres ?? 0;
  const total = fuel?.total_litres ?? 0;
  const has = total > 0;
  const workPct = has ? (work / total) * 100 : 0;
  const workBasis = Math.max(2, workPct);       // keep a sliver visible
  const mismatch = fuel?.day && fuel.day !== (requestedDay ?? day)
    ? { requested: requestedDay ?? day, actual: fuel.day }
    : null;

  return (
    <div className="panel activity-panel">
      <div className="panel-head">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          {t("overview.fuelConsumed.title")}
        </span>
      </div>
      {mismatch && (
        <div className="mnt-note">
          {t("overview.fuelConsumed.noDataFallback", { requested: fmtDay(mismatch.requested), actual: fmtDay(mismatch.actual) })}
        </div>
      )}
      {fuel === null ? (
        <SkelBar style={{ marginTop: 8 }} />
      ) : !has ? (
        <div className="empty">{t("overview.fuelConsumed.noData")}</div>
      ) : (
        <div className="activity-body">
          <div className="activity-bar">
            <div className="activity-seg work" style={{ flexBasis: `${workBasis}%` }}>
              {workPct >= 12 ? `${workPct.toFixed(0)}%` : ""}
            </div>
            <div className="activity-seg travel" style={{ flexBasis: `${100 - workBasis}%` }}>
              {100 - workPct >= 12 ? `${(100 - workPct).toFixed(0)}%` : ""}
            </div>
          </div>
          <div className="activity-legend">
            <span className="activity-stat"><span className="v">{fmtL(work)}</span>
              <span className="lg"><i className="work" /> {t("overview.activity.atWork")}</span></span>
            <span className="activity-stat"><span className="v">{fmtL(idle)}</span>
              <span className="lg"><i className="travel" /> {t("overview.fuelConsumed.travelIdle")}</span></span>
          </div>
        </div>
      )}
    </div>
  );
}
