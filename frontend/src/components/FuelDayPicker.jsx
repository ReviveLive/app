import { useState } from "react";
import { useTranslation } from "react-i18next";
import { pad2, fmtMonth } from "../dates.js";

// A calendar of selectable day "bubbles" for choosing which days feed the
// measured fuel cost. One month is shown at a time; ‹ › step between the months
// that have data. Only days that actually carry fuel data are selectable; days
// with none are shown faded and disabled, so the picker can never invent a day
// the telemetry doesn't have. Weeks start Monday (matching the rest of the
// platform). Click a day to toggle it; click the month name to toggle that whole
// month; All / Clear cover everything.
//
// `days` is [{ iso, litres }] in ascending date order; `selected` is a Set of
// iso strings; `onChange(nextSet)` is called with the new selection.

const WD_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// Build one entry per calendar month spanned by the data, each with a flat list
// of 7-column grid cells (null = leading blank before the 1st).
function buildMonths(isos) {
  if (!isos.length) return [];
  const [fy, fm] = isos[0].split("-").map(Number);
  const [ly, lm] = isos[isos.length - 1].split("-").map(Number);
  const months = [];
  let y = fy, m = fm;
  while (y < ly || (y === ly && m <= lm)) {
    const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Mon-based
    const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= nDays; d++) cells.push(`${y}-${pad2(m)}-${pad2(d)}`);
    months.push({ y, m, iso1: `${y}-${pad2(m)}-01`, cells });
    m++; if (m > 12) { m = 1; y++; }
  }
  return months;
}

export default function FuelDayPicker({ days, selected, onChange }) {
  const { t } = useTranslation();
  const available = new Set(days.map((d) => d.iso));
  const months = buildMonths(days.map((d) => d.iso));
  // Start on the most recent month (newest-first, like the route navigator).
  // State survives while mounted; a vehicle switch unmounts/remounts this and
  // re-seeds it. idx is clamped on render so it can never point out of range.
  const [idx, setIdx] = useState(months.length - 1);

  if (!months.length) return null;
  const cur = Math.min(Math.max(idx, 0), months.length - 1);
  const mo = months[cur];

  const toggleDay = (iso) => {
    const next = new Set(selected);
    next.has(iso) ? next.delete(iso) : next.add(iso);
    onChange(next);
  };
  const toggleMonth = () => {
    const mdays = mo.cells.filter((c) => c && available.has(c));
    const allOn = mdays.length > 0 && mdays.every((d) => selected.has(d));
    const next = new Set(selected);
    mdays.forEach((d) => (allOn ? next.delete(d) : next.add(d)));
    onChange(next);
  };

  return (
    <div className="daypick">
      <div className="daypick-head">
        <span className="daypick-count">{t("costing.dayPicker.daysOf", { selected: selected.size, available: available.size })}</span>
        <div className="daypick-actions">
          <button type="button" onClick={() => onChange(new Set(available))}>{t("costing.dayPicker.all")}</button>
          <button type="button" onClick={() => onChange(new Set())}>{t("costing.dayPicker.clear")}</button>
        </div>
      </div>

      <div className="daypick-nav">
        <button type="button" className="daypick-arrow" aria-label={t("costing.dayPicker.prevMonth")}
          disabled={cur === 0} onClick={() => setIdx(cur - 1)}>‹</button>
        <button type="button" className="daypick-month-lbl" onClick={toggleMonth}
          title={t("costing.dayPicker.toggleMonthTitle")}>{fmtMonth(mo.iso1)}</button>
        <button type="button" className="daypick-arrow" aria-label={t("costing.dayPicker.nextMonth")}
          disabled={cur === months.length - 1} onClick={() => setIdx(cur + 1)}>›</button>
      </div>

      <div className="daypick-grid">
        {WD_KEYS.map((k, i) => <span className="daypick-wd" key={`wd${i}`}>{t(`common.weekdaysShort.${k}`)}</span>)}
        {mo.cells.map((iso, i) => {
          if (!iso) return <span className="daypick-cell empty" key={i} />;
          const has = available.has(iso);
          const on = selected.has(iso);
          return (
            <button type="button" key={i} disabled={!has}
              className={"daypick-cell" + (has ? "" : " nodata") + (on ? " on" : "")}
              onClick={() => toggleDay(iso)}
              title={has ? iso : t("costing.dayPicker.noFuelData")}>
              {Number(iso.slice(8, 10))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
