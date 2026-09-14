import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getForecast, wmo } from "../weather.js";
import { reverseRegion } from "../geocode.js";
import { getGpsFix } from "../gps.js";

// Weather — an external live forecast (Open-Meteo) for the vehicle's last-known
// GPS location. Embedded directly in the Overview grid - there's no longer a
// standalone Weather tab (folded into RoutesPage.jsx's Work Locations log as
// a per-entry reference instead, 2026-09-11).
//
// The red .gps-pending border (styles.css) only applies when THIS vehicle has
// no location data at all — not unconditionally — so it correctly stays off
// for any vehicle whose GPS already works (e.g. the original demo fleet) and
// only shows for one that's genuinely missing it (the real trial vehicle,
// pending the contractor's GPS tags). It clears itself automatically once a
// vehicle's GPS starts reporting — no code change needed then.
//
// Honesty (CLAUDE.md #3): the weather is NOT telemetry — it's an external live
// forecast, labelled "Live local forecast" so it's never confused with the
// vehicle's own channels. Real summer weather never triggers the blowdown or
// storm warnings, so to keep both demoable ONE vehicle each is pinned to an
// illustrative value; those cases are marked "(illustrative)".
const BLOWDOWN_DEMO = /152|london/i;
const STORM_DEMO = /151|manchester/i;
const DEMO_OVERNIGHT_LOW = -2;
const GALE_GUST_KMH = 70; // gusts at/above this flag a storm (≈ Beaufort 8+)

const fmtTemp = (n) => (n == null ? "—" : `${Math.round(n)}°C`);

export default function WeatherPanel({ readings, vehicle }) {
  const { t } = useTranslation();
  const { lat, lng } = getGpsFix(readings);
  const hasLoc = lat != null && lng != null; // a vehicle may have no GPS at all

  const [wx, setWx] = useState(null);        // null = loading, false = failed
  const [ready, setReady] = useState(false);
  const [region, setRegion] = useState(null); // county/region for the rain caption

  useEffect(() => {
    if (!hasLoc) return;
    let live = true;
    setWx(null); setReady(false); setRegion(null);
    getForecast(lat, lng)
      .then((r) => { if (live) { setWx(r); setReady(true); } })
      .catch(() => { if (live) { setWx(false); setReady(true); } });
    reverseRegion(lat, lng)
      .then((p) => { if (live) setRegion(p); })
      .catch(() => {}); // caption is a nicety — the rain figures stand alone
    return () => { live = false; };
  }, [lat, lng]);

  const header = <div className="panel-head">{t("common.weatherPanel.title")}</div>;

  if (!hasLoc) {
    return <div className="panel gps-pending">{header}<div className="wx-note">{t("common.weatherPanel.noLocation")}</div></div>;
  }
  if (!ready) {
    return <div className="panel">{header}<div className="skel-line" style={{ width: 120, height: 14 }} /></div>;
  }
  if (!wx) {
    return <div className="panel">{header}<div className="wx-note">{t("common.weatherPanel.unavailable")}</div></div>;
  }

  const id = `${vehicle?.name || ""} ${vehicle?.vehicle_id || ""}`;

  // Winter-blowdown demo override (see BLOWDOWN_DEMO above).
  const coldDemo = BLOWDOWN_DEMO.test(id);
  const overnight = coldDemo ? DEMO_OVERNIGHT_LOW : wx.overnightLow;
  const blowdown = overnight != null && overnight < 0;

  // Storm: a real thunderstorm code (95/96/99) or gale-force gusts. STORM_DEMO
  // forces one vehicle so the warning is always demoable.
  const stormDemo = STORM_DEMO.test(id);
  const realStorm = (wx.dayCode != null && wx.dayCode >= 95)
    || (wx.windGust != null && wx.windGust >= GALE_GUST_KMH);
  const storm = stormDemo || realStorm;

  const cond = wmo(wx.code);
  const rainChance = wx.rainChance;
  const hasRain = rainChance != null;
  const rainMm = wx.rainSum;

  return (
    <div className="panel">
      {header}

      <div className="wx-row">
        <span className="wx-icon" role="img" aria-label={t(cond.labelKey)} title={t(cond.labelKey)}>{cond.emoji}</span>
        <span className="wx-temp">{fmtTemp(wx.tempNow)}</span>
        <span className="wx-lbl">{t("common.weatherPanel.now")} · {t(cond.labelKey)}</span>
      </div>

      <div className="wx-row">
        <span className="wx-temp wx-temp-sm">{fmtTemp(overnight)}</span>
        <span className="wx-lbl">{t("common.weatherPanel.overnightLow")}</span>
      </div>

      {blowdown && (
        <div className="tank-warn">
          ⚠ {t("common.weatherPanel.blowdown")}
          {coldDemo && <span className="wx-illustrative"> {t("common.weatherPanel.illustrative")}</span>}
        </div>
      )}

      {storm && (
        <div className="tank-warn storm">
          ⛈️ {t("common.weatherPanel.storm")}
          {stormDemo && !realStorm && <span className="wx-illustrative"> {t("common.weatherPanel.illustrative")}</span>}
        </div>
      )}

      <div className="wx-rain">
        {t("common.weatherPanel.rainIn", { region: region || t("common.weatherPanel.theArea") })}:{" "}
        {!hasRain ? t("common.weatherPanel.outlookUnavailable") : rainChance < 10 ? t("common.weatherPanel.unlikelyToday") : t("common.weatherPanel.chance", { pct: Math.round(rainChance) })}
        {rainMm != null && (
          <><br /><b>{t("common.weatherPanel.mm", { mm: rainMm.toFixed(1) })}</b> {t("common.weatherPanel.expectedToday")}
            {rainMm > 0.1 && wx.rainPeakLabel ? t("common.weatherPanel.heaviestAt", { time: t(`common.weatherPanel.peak.${wx.rainPeakLabel}`) }) : ""}</>
        )}
      </div>
    </div>
  );
}
