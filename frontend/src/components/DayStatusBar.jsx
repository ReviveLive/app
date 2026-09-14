import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { todayLocal, addDays } from "../period.js";
import { fmtDay, fmtDayShort } from "../dates.js";

// Compact, page-level day selector for Overview - sits between the topbar and
// the KPI strip so every day-scoped panel (Activity, Fuel, Route, the KPI
// tiles) shares one visible "which day am I looking at" status instead of
// each repeating "· this day" on its own label.
//
// Modelled on Grafana's compact time-range button: one small control that
// expands a popover, rather than a full toggle+date-input row (see Health's
// PeriodPicker) - far less space, and scales down to mobile much better.
//
// Deliberately dumb about which days actually have data (unlike RoutePanel,
// which fetches the real day list): stepping onto a day with nothing simply
// shows each panel's own "no data for this day" state, and RoutePanel's own
// fetch already snaps `day` back to the nearest valid one for any date it's
// given that doesn't match, so it self-corrects within a step or two.
export default function DayStatusBar({ vehicle, day, setDay }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const today = todayLocal(vehicle?.timezone);
  const shown = day ?? today;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const step = (n) => setDay(addDays(shown, n));

  return (
    <div className="daybar">
      <div className="daybar-title">
        {vehicle?.name ? t("overview.dayStatusBar.statusOnNamed", { vehicle: vehicle.name }) : t("overview.dayStatusBar.statusOnGeneric")}{" "}
        {/* Hidden on narrow screens (see .daybar-date) - the picker button
            beside it already shows the date, and there isn't room for both. */}
        <strong className="daybar-date">{fmtDay(shown)}</strong>
      </div>
      <div className={"daybar-pick" + (open ? " open" : "")} ref={ref}>
        <button className="daybar-btn" onClick={() => setOpen((o) => !o)}>
          🕐 {fmtDayShort(shown)} ▾
        </button>
        {open && (
          <div className="daybar-pop">
            <div className="daybar-steps">
              <button className="navbtn" onClick={() => step(-1)}>‹ {t("overview.dayStatusBar.prevDay")}</button>
              <button className="navbtn" onClick={() => step(1)} disabled={shown >= today}>{t("overview.dayStatusBar.nextDay")} ›</button>
            </div>
            <button className="daybar-latest" onClick={() => { setDay(null); setOpen(false); }}>{t("overview.dayStatusBar.latest")}</button>
            <input className="cost-input" type="date" value={shown} max={today}
              onChange={(e) => { setDay(e.target.value); setOpen(false); }} />
          </div>
        )}
      </div>
    </div>
  );
}
