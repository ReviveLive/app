import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getPumpActivations } from "../api.js";
import { PUMPS } from "../pumps.js";
import InfoTip from "./InfoTip.jsx";

// Pump Activation Log — individual on/off cycles for the three pumps
// (vacuum, jet, recycle), newest first. Real trial vehicle only; the demo
// fleet has no per-pump on/off channels, only aggregate lifetime run-minute
// counters (same gap PumpTimeline's day view already has). The backend
// already caps this at LOG_LIMIT (5) and orders newest-first, so no
// client-side slicing is needed here (see /api/pump-activations).
const byField = Object.fromEntries(PUMPS.map((p) => [p.field, p]));

// "45s" under a minute, "2m 10s" otherwise — fmtDur's whole-minute rounding
// (elsewhere used for hour-plus durations) would show "0 m" for most of
// these cycles, which run seconds to low minutes.
function fmtCycleDur(min) {
  const totalSec = Math.round(min * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

export default function PumpActivationLog({ vehicleId, fmtTime }) {
  const { t } = useTranslation();
  const [cycles, setCycles] = useState(null); // null = loading
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!vehicleId) return;
    let live = true;
    setCycles(null);
    getPumpActivations(vehicleId)
      .then((r) => live && (setCycles(r.cycles || []), setErr(null)))
      .catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [vehicleId]);

  return (
    <div className="panel">
      <div className="usage-head">
        <div className="panel-head" style={{ margin: 0 }}>{t("pumps.activationLog.title")}</div>
        <InfoTip label={t("pumps.activationLog.title")}
          text={t("pumps.activationLog.note")} />
      </div>
      {err ? (
        <div className="err">{err}</div>
      ) : cycles === null ? (
        <div className="empty">{t("common.loading")}</div>
      ) : cycles.length === 0 ? (
        <div className="empty">{t("pumps.activationLog.noData")}</div>
      ) : (
        <ul className="estop-list">
          {cycles.map((c, i) => {
            const p = byField[c.pump];
            return (
              <li className="estop-row" key={i}>
                <span className="estop-dot" aria-hidden="true"
                  style={{ background: `var(--series-${p?.color || "blue"})` }} />
                <div className="estop-text">
                  <div className="estop-title">{p ? t(p.labelKey) : c.pump}</div>
                  <div className="estop-cause">
                    {fmtTime(c.start_ts)} – {c.end_ts ? fmtTime(c.end_ts) : t("pumps.activationLog.ongoing")}
                    {c.duration_min != null && ` (${fmtCycleDur(c.duration_min)})`}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
