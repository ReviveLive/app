import { useEffect, useMemo, useState } from "react";
import { fmtDay, fmtDayShort, fmtWeek, fmtMonth } from "./dates.js";

// How many buckets show per page, by grain. Kept bounded so a bigger dataset can
// never crush the bars into an unreadable cluster — you page through with the
// stepper instead. Daily is ~2 weeks of weekday data, enough to read day-to-day
// variation while staying legible in the narrow charts.
const WINDOW = { day: 10, week: 8, month: 12 };

// Page a bucketed series so only a bounded slice shows at once, driven by a
// Prev/Next stepper. This is the shared engine behind the Overview/Trends
// time-series cards. `data` is [{ bucket, ... }] ascending, where `bucket` is a
// YYYY-MM-DD string already in vehicle-local time. Behaviour by grain:
//   single           — one bucket per page (a card that shows a single period)
//   "day"            — one calendar week per page (Mon–Sun), like the route card
//   "week" / "month" — fixed windows (WINDOW above) so bars stay readable
// Pages are oldest-first; it opens on the newest page and re-seeds there when
// the data or grain change.
//
// Returns:
//   view      — the buckets on the current page
//   label     — the page's period (a single label or a "first – last" range)
//   go        — step by ±delta pages
//   atOldest  — the current page is the earliest (disable Prev)
//   atNewest  — the current page is the latest (disable Next)
//   empty     — there are no pages at all
export function usePeriodPaging(data, grain, { single = false } = {}) {
  const pages = useMemo(() => {
    if (!data || data.length === 0) return [];
    if (single) return data.map((b) => [b]);
    const size = WINDOW[grain] || data.length;
    const out = [];
    for (let i = 0; i < data.length; i += size) out.push(data.slice(i, i + size));
    return out;
  }, [data, grain, single]);

  const [pi, setPi] = useState(0);
  // Open on (and re-seed to) the newest page whenever the pages change.
  useEffect(() => { setPi(Math.max(0, pages.length - 1)); }, [pages]);

  const idx = Math.min(Math.max(pi, 0), Math.max(0, pages.length - 1));
  const view = pages[idx] ?? [];
  const go = (delta) =>
    setPi((p) => Math.min(Math.max(0, p + delta), Math.max(0, pages.length - 1)));

  return {
    view,
    label: pageLabel(view, grain, single),
    go,
    atOldest: idx <= 0,
    atNewest: idx >= pages.length - 1,
    empty: pages.length === 0,
  };
}

// The heading for the shown page: a single period's label, or a "first – last"
// date range across the window (compact dates so multi-week windows stay short).
function pageLabel(view, grain, single) {
  if (!view.length) return "—";
  const first = view[0].bucket;
  const last = view[view.length - 1].bucket;
  if (single) {
    return grain === "month" ? fmtMonth(first)
      : grain === "week" ? fmtWeek(first) : fmtDay(first);
  }
  const fmt = grain === "month" ? fmtMonth : fmtDayShort;
  return first === last ? fmt(first) : `${fmt(first)} – ${fmt(last)}`;
}
