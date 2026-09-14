// Platform-wide date format is DD-MM-YYYY (zero-padded, dash-separated). These
// helpers are the single source of that format; use them instead of ad-hoc
// Intl calls so every date on the platform reads the same way. The numeric
// DD-MM-YYYY part is deliberately locale-invariant (Joe's own platform-wide
// choice), but weekday/month NAMES should follow the active UI language -
// see weekdayShort/monthShort below.
import i18n from "./i18n.js";

export const pad2 = (n) => String(n).padStart(2, "0");

// Manual overrides for locales where Joe wants specific abbreviations rather
// than Intl's own CLDR short form (2026-09-14: Intl's "ga" gives "Luan"/
// "Céad"/"Déar" for three of these - close, but not what he asked for).
// Indexed Sun=0..Sat=6, matching Date#getUTCDay(). Add an entry here for any
// future locale that needs the same kind of override; anything absent just
// falls through to Intl, which already covers en/fr (and ga's other four
// days) correctly.
const WEEKDAY_OVERRIDE = {
  "ga-IE": ["Domh", "Luain", "Máirt", "Céa", "Déa", "Aoine", "Sath"],
  // Joe's own preferred style (2026-09-14): capitalised, no trailing period -
  // Intl's own fr-FR short form gives lowercase "dim." etc.
  "fr-FR": ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"],
};

function weekdayShort(date) {
  const loc = i18n.language;
  const override = WEEKDAY_OVERRIDE[loc];
  if (override) return override[date.getUTCDay()];
  return date.toLocaleDateString(loc, { weekday: "short", timeZone: "UTC" });
}

function monthShort(date, opts = {}) {
  return date.toLocaleDateString(i18n.language, { month: "short", timeZone: "UTC", ...opts });
}

// "2026-04-02" -> "Thu 02-04-2026". These are plain calendar dates already in
// the vehicle's local time (the API buckets by its timezone), so no tz math.
// The weekday prefix is context, not part of the DD-MM-YYYY format itself.
export function fmtDay(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = weekdayShort(new Date(Date.UTC(y, m - 1, d)));
  return `${weekday} ${pad2(d)}-${pad2(m)}-${y}`;
}

// "2026-04-10" -> "10-04-2026". A plain calendar-date string (already in the
// vehicle's local time) with no weekday — for inline date ranges like the
// Costing period. The API sends zero-padded ISO, so the parts are already 2-digit.
export function fmtDayShort(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

// An absolute timestamp -> "DD-MM-YYYY" in the given IANA timezone (UTC if none).
export function fmtDMY(iso, tz) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz || "UTC",
    }).format(new Date(iso)).replace(/\//g, "-");
  } catch { return iso; }
}

// An absolute timestamp -> "DD-MM-YYYY, HH:MM" (24h) in the given timezone.
// formatToParts keeps the pieces in our order regardless of locale quirks.
export function fmtDMYTime(iso, tz) {
  if (!iso) return "—";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz || "UTC",
    }).formatToParts(new Date(iso));
    const g = (t) => parts.find((p) => p.type === t)?.value;
    return `${g("day")}-${g("month")}-${g("year")}, ${g("hour")}:${g("minute")}`;
  } catch { return iso; }
}

// Monday (as a YYYY-MM-DD string) of the week containing `iso`. Weeks start
// Monday, matching Postgres date_trunc('week', ...) used for the weekly buckets.
export function mondayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const fromMon = (dt.getUTCDay() + 6) % 7; // 0 = Mon … 6 = Sun
  dt.setUTCDate(dt.getUTCDate() - fromMon);
  return dt.toISOString().slice(0, 10);
}

// "2026-04-13" (a Monday) -> "13–19 Apr 2026" (its Mon–Sun range). The month is
// repeated on the left only when the week straddles two months.
export function fmtWeek(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const mon = new Date(Date.UTC(y, m - 1, d));
  const sun = new Date(Date.UTC(y, m - 1, d + 6));
  const sameMonth = mon.getUTCMonth() === sun.getUTCMonth();
  const left = sameMonth
    ? mon.toLocaleDateString(i18n.language, { day: "numeric", timeZone: "UTC" })
    : monthShort(mon, { day: "numeric" });
  const right = monthShort(sun, { day: "numeric" });
  return `${left}–${right} ${sun.getUTCFullYear()}`;
}

// An absolute timestamp -> "YYYY-MM-DD" calendar date in the given IANA timezone
// (UTC if none). Used to bucket event times into vehicle-local days so the
// day-scoped Overview tiles agree with the day the route navigator is showing.
// en-CA renders the parts in ISO order.
export function localDate(iso, tz) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz || "UTC",
    }).format(new Date(iso));
  } catch { return null; }
}

// "2026-04-01" -> "Apr 2026" (month buckets arrive as the 1st of the month).
export function fmtMonth(iso) {
  if (!iso) return "—";
  const [y, m] = iso.split("-").map(Number);
  return monthShort(new Date(Date.UTC(y, m - 1, 1)), { year: "numeric" });
}

// Compact chart-axis ticks. Daily and weekly deliberately read differently so a
// daily chart can't be mistaken for a weekly one at a glance:
//   fmtDayAxis  "2026-04-06" -> "Mon 06"  (weekday + day-of-month)
//   fmtWeekAxis "2026-04-06" -> "06 Apr"  (day + short month of the week start)
export function fmtDayAxis(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const wd = weekdayShort(new Date(Date.UTC(y, m - 1, d)));
  return `${wd} ${pad2(d)}`;
}
export function fmtWeekAxis(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return monthShort(new Date(Date.UTC(y, m - 1, d)), { day: "2-digit" });
}
