import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { periodRange, todayLocal, trialRange } from "../period.js";
import { fmtDayShort } from "../dates.js";

const MODES = ["day", "week", "month", "range"];
const STORAGE_PREFIX = "revive-range-";

// Range mode's starting point: the last [start, end] the user entered here
// (remembered per `storageKey`, e.g. across reloads), falling back to the
// trial window the very first time there's nothing saved yet.
function loadSavedRange(storageKey, tz) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_PREFIX + storageKey));
    if (saved?.start && saved?.end) return [saved.start, saved.end];
  } catch { /* ignore - malformed/blocked storage falls back below */ }
  return trialRange(tz);
}

// Day / week / month / range period picker. Emits the resolved
// { mode, start, end } (inclusive, vehicle-local calendar dates) on every
// change, including once on mount, so the caller never has to duplicate the
// default-resolution logic in period.js.
//
// Range mode remembers the last dates entered (localStorage, keyed by
// `storageKey` so multiple pickers on different pages don't collide) and
// starts from the trial window (spec section 1) before anything's been
// saved. Day/week/month each take a single date input (the containing
// week/month is derived from it); range takes two.
export default function PeriodPicker({ tz, storageKey = "default", defaultMode = "range", onChange }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState(defaultMode);
  const today = todayLocal(tz);
  const [day, setDay] = useState(today);
  const [week, setWeek] = useState(today);
  const [monthDay, setMonthDay] = useState(today);
  const [rangeStart, setRangeStart] = useState(() => loadSavedRange(storageKey, tz)[0]);
  const [rangeEnd, setRangeEnd] = useState(() => loadSavedRange(storageKey, tz)[1]);

  const [start, end] = periodRange(mode, { day, week, monthDay, rangeStart, rangeEnd }, tz);

  // Re-emit whenever the resolved range actually changes. `onChange` is
  // deliberately left out of the deps - it's a plain state setter in every
  // caller, so re-running only on a real range change (not a new function
  // identity each render) avoids an update loop without losing anything.
  useEffect(() => {
    onChange({ mode, start, end });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, start, end]);

  // Remember the range as the user edits it, so it's still there next visit.
  useEffect(() => {
    localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify({ start: rangeStart, end: rangeEnd }));
  }, [storageKey, rangeStart, rangeEnd]);

  return (
    <div className="period-picker">
      <div className="toggle">
        {MODES.map((m) => (
          <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
            {t(`health.periodPicker.${m}`)}
          </button>
        ))}
      </div>
      {mode === "day" && (
        <input className="cost-input period-input" type="date" value={day} max={today}
          onChange={(e) => setDay(e.target.value)} />
      )}
      {mode === "week" && (
        <input className="cost-input period-input" type="date" value={week} max={today}
          onChange={(e) => setWeek(e.target.value)} />
      )}
      {mode === "month" && (
        <input className="cost-input period-input" type="date" value={monthDay} max={today}
          onChange={(e) => setMonthDay(e.target.value)} />
      )}
      {mode === "range" && (
        <>
          <input className="cost-input period-input" type="date" value={rangeStart} max={rangeEnd}
            onChange={(e) => setRangeStart(e.target.value)} />
          <span className="period-sep">→</span>
          <input className="cost-input period-input" type="date" value={rangeEnd} min={rangeStart} max={today}
            onChange={(e) => setRangeEnd(e.target.value)} />
        </>
      )}
      <span className="period-range">
        {mode === "day" ? fmtDayShort(start) : `${fmtDayShort(start)} → ${fmtDayShort(end)}`}
      </span>
    </div>
  );
}
