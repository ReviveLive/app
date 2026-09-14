import { useTranslation } from "react-i18next";

// Water level — reads the vehicle's tank sensor(s). The real Warrior 75 unit
// reports two separate percentage tags (front/rear); the original demo fleet
// reports one cumulative volume instead. Prefer the real percentage tags when
// present; otherwise fall back to the demo fleet's single volume-based gauge
// so nothing about the existing demo display changes.
const TANK_CAPACITY_M3 = 8;
const LOW_PCT = 20;

function Vessel({ label, pct }) {
  const { t } = useTranslation();
  const low = pct <= LOW_PCT;
  return (
    <div className="tank-gauge-body">
      <div className="tank-vessel" role="img" aria-label={t("overview.tankLevels.fullAria", { label, pct: pct.toFixed(0) })}>
        <div className="tank-ticks">
          {[25, 50, 75].map((t) => (
            <span className="tank-tick" key={t} style={{ bottom: `${t}%` }} />
          ))}
        </div>
        <div className={"tank-fill" + (low ? " low" : "")} style={{ height: `${pct}%` }}>
          <span className="tank-wave" />
        </div>
      </div>
      <div className="tank-meta">
        <div className="tank-value">{pct.toFixed(0)}<span className="u">%</span></div>
        <div className="tank-pct">{label}</div>
      </div>
    </div>
  );
}

export default function TankLevel({ readings }) {
  const { t } = useTranslation();
  const front = readings?.["front_level_pcent_revlive"]?.value;
  const rear = readings?.["rear_level_pcent_revlive"]?.value;
  const hasSplit = front != null || rear != null;

  const volumeReading = readings?.["Water Level Volume (m3)"];
  const knownVolume = volumeReading?.value != null;

  if (!hasSplit && !knownVolume) {
    return (
      <div className="panel">
        <div className="panel-head">{t("overview.tankLevels.title")}</div>
        <div className="empty">{t("overview.tankLevels.noData")}</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="tank-head">{t("overview.tankLevels.title")}</div>
      <div className="tank">
        {hasSplit ? (
          <>
            <Vessel label={t("overview.tankLevels.frontWater")} pct={Math.max(0, Math.min(100, front ?? 0))} />
            <Vessel label={t("overview.tankLevels.rearSludge")} pct={Math.max(0, Math.min(100, rear ?? 0))} />
          </>
        ) : (
          <Vessel label={t("overview.tankLevels.frontCompartmentWater")}
            pct={Math.max(0, Math.min(100, (volumeReading.value / TANK_CAPACITY_M3) * 100))} />
        )}
      </div>
    </div>
  );
}
