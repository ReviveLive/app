// Period resolution shared by any page with a day/week/month/range picker
// (see PeriodPicker.jsx) - pure date math, no React. Every function works in
// "YYYY-MM-DD" calendar-date strings, already in the vehicle's local time,
// matching the rest of the platform's date handling (see dates.js).
import { mondayOf } from "./dates.js";

// The Veolia trial window (spec section 1) - fixed for the life of this
// trial, not derived from any feed data. Used only as Range mode's starting
// default (see trialRange), before the user has entered a range of their own.
export const TRIAL_START = "2026-09-14";
export const TRIAL_END = "2026-11-06";

// Today as a "YYYY-MM-DD" calendar date in the given IANA timezone.
export function todayLocal(tz) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz || "UTC",
  }).format(new Date());
}

// Add `n` (possibly negative) days to a "YYYY-MM-DD" string. UTC-anchored
// calendar arithmetic, so it's unaffected by any DST shift in the caller's
// own timezone - the string in is always a plain calendar date, not a moment.
export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// [first, last] day of the month containing `iso`.
export function monthRange(iso) {
  const [y, m] = iso.split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return [first, last];
}

// The trial window, clamped to today at both ends: before the trial starts
// this is a single day (at TRIAL_START) rather than an inverted
// start-after-end range; once the trial ends it stops advancing past
// TRIAL_END. Range mode's default before anything has been entered/saved.
export function trialRange(tz) {
  const today = todayLocal(tz);
  const end = today < TRIAL_START ? TRIAL_START : today < TRIAL_END ? today : TRIAL_END;
  return [TRIAL_START, end];
}

// Resolve a picker's mode + its per-mode anchor value(s) to a [start, end]
// pair (inclusive, "YYYY-MM-DD"). Day/week/month anchors default to today
// when unset, so a freshly-switched mode always resolves to something
// sensible before the user has touched its date input(s); range has no such
// fallback here since PeriodPicker seeds it from localStorage/trialRange
// itself (see loadRange there).
export function periodRange(mode, anchors, tz) {
  const today = todayLocal(tz);
  const { day, week, monthDay, rangeStart, rangeEnd } = anchors || {};
  switch (mode) {
    case "day":
      return [day || today, day || today];
    case "week": {
      const mon = mondayOf(week || today);
      return [mon, addDays(mon, 6)];
    }
    case "month":
      return monthRange(monthDay || today);
    case "range":
    default:
      return [rangeStart || today, rangeEnd || today];
  }
}
