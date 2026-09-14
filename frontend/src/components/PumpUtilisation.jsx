import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchPumpUsage, PUMPS, computeUtilisation } from "../pumps.js";
import { fmtDur } from "../activity.js";
import { usePeriodPaging } from "../usePeriodPaging.js";
import GrainToggle from "./GrainToggle.jsx";
import PeriodNav from "./PeriodNav.jsx";
import InfoTip from "./InfoTip.jsx";

// How PTO time is spent, for the chosen day / week / month. The grain toggle
// picks the period length; the Prev/Next stepper picks WHICH one, so you can
// look back rather than only ever seeing the latest. The headline split bar
// partitions that period's PTO into WORKING (≥1 pump running) vs IDLE (PTO on,
// no pump engaged) — the inefficiency at a glance. Below, each pump's share of
// PTO time is shown independently (they overlap in time, so they're never summed).
export default function PumpUtilisation({ vehicleId, vehicle }) {
  const { t } = useTranslation();
  const [grain, setGrain] = useState("week");
  const [rows, setRows] = useState([]);
  const [present, setPresent] = useState({ vacuum: false, jet: false, recycle: false });
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!vehicleId) return;
    let live = true;
    fetchPumpUsage(vehicleId, grain, vehicle)
      .then(({ rows, present }) => live && (setRows(rows), setPresent(present), setErr(null)))
      .catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [vehicleId, grain, vehicle]);

  // One period at a time, stepped with Prev/Next. Figures are scoped to that
  // single bucket, so the durations read as a real period — not an inflated
  // whole-dataset total.
  const { view, label, go, atOldest, atNewest } = usePeriodPaging(rows, grain, { single: true });
  const bucket = view[0] ?? null;
  const u = useMemo(() => computeUtilisation(bucket ? [bucket] : []), [bucket]);
  const noPto = u.workingPct == null;

  return (
    <div className="panel util-panel">
      <div className="usage-head">
        <h2 style={{ margin: 0 }}>{t("pumps.utilisation.title")}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <GrainToggle grain={grain} onChange={setGrain} />
          <InfoTip label={t("pumps.utilisation.title")} text={t("pumps.utilisation.note")} />
        </div>
      </div>
      <div className="panel-sub">{t("pumps.utilisation.subtitle")}</div>

      {rows.length > 0 && !err && (
        <PeriodNav label={label} onPrev={() => go(-1)} onNext={() => go(1)}
          atStart={atOldest} atEnd={atNewest} />
      )}

      {err ? (
        <div className="err">{err}</div>
      ) : rows.length === 0 ? (
        <div className="empty">{t("pumps.utilisation.noPto")}</div>
      ) : noPto ? (
        <div className="empty">{t("pumps.utilisation.noPtoPeriod")}</div>
      ) : (
        <div className="util-body">
          {/* Headline: working vs idle — a true partition, so the bar is honest. */}
          <div className="pto-split">
            <div className="activity-bar">
              <div className={"activity-seg active" + (u.workingPct < 14 ? " edge" : "")}
                style={{ flexBasis: `${u.workingPct}%` }}>
                {u.workingPct >= 1 ? `${u.workingPct.toFixed(0)}%` : ""}
              </div>
              <div className={"activity-seg idle" + (u.idlePct < 14 ? " edge" : "")}
                style={{ flexBasis: `${Math.max(2, u.idlePct)}%` }}>
                {u.idlePct >= 1 ? `${u.idlePct.toFixed(0)}%` : ""}
              </div>
            </div>
            <div className="activity-legend">
              <span className="activity-stat"><span className="v">{fmtDur(u.workingMinutes)}</span>
                <span className="lg"><i className="active" /> {t("pumps.utilisation.pumpsActive")}</span></span>
              <span className="activity-stat"><span className="v">{fmtDur(u.idleMinutes)}</span>
                <span className="lg"><i className="idle" /> {t("pumps.utilisation.ptoIdle")}</span></span>
            </div>
          </div>

          {/* Per-pump share of PTO time — measured independently (overlap-safe). */}
          <div className="util-rows">
            {PUMPS.map((p) => {
              // Absent pump (e.g. no recycle on some vehicles): a muted note, never
              // a 0% bar that would falsely claim it exists but never ran. `present`
              // is judged over the whole dataset, so it means "not fitted", not
              // "didn't run this period".
              if (!present[p.field]) {
                return (
                  <div className="util-row" key={p.field}>
                    <div className="util-head"><span className="util-lbl">{t(p.labelKey)}</span></div>
                    <div className="util-empty">{t("pumps.utilisation.notFitted")}</div>
                  </div>
                );
              }
              const { pct, minutes } = u.pumps[p.field];
              // Clamp the BAR to 100% but keep the label truthful; a sliver stays
              // visible when a pump barely runs.
              const width = pct == null ? 0 : Math.max(2, Math.min(100, pct));
              return (
                <div className="util-row" key={p.field}>
                  <div className="util-head">
                    <span className="util-lbl"><i className={`sw ${p.sw}`} /> {t(p.labelKey)}</span>
                    <span className="util-val">
                      {pct == null ? "—" : `${Math.round(pct)}%`}
                      <span className="util-sub">{fmtDur(minutes)}</span>
                    </span>
                  </div>
                  <div className="util-track">
                    <div className={`util-fill ${p.sw}`} style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
