// Chart palette — the single source of truth for every colour a Recharts / SVG
// chart draws with. Recharts sets colours as literal SVG attributes and can't
// read CSS custom properties, so the chart colours live here as JS values and
// are MIRRORED by the --series-* / --chart-* tokens in styles.css (used by the
// non-chart UI: legends, swatches, KPI accents). Keep the two in step.
//
// The categorical order and the two-series pairings were validated with the
// dataviz palette checker (CVD-safe, contrast-checked against the real panel
// surfaces). Brand REI green leads; a well-separated violet is its partner for
// the only two-series charts (RPM off/on, activity work/travel). Single-series
// charts each take one hue — they never sit adjacent, so only contrast matters,
// and every chart ships a legend/tooltip as the required "relief".

import { useSyncExternalStore } from "react";

// role -> { light, dark }. Series 1 is the brand green.
const PALETTE = {
  // Categorical series
  green:  { light: "#14b053", dark: "#2ecc71" }, // brand / primary
  blue:   { light: "#2a78d6", dark: "#4d9bf0" },
  violet: { light: "#6d5ae0", dark: "#9b87f5" }, // green's two-series partner
  amber:  { light: "#ea8c1c", dark: "#eaa93a" },
  teal:   { light: "#0d9488", dark: "#26c6ad" },
  red:    { light: "#dc2626", dark: "#f2726f" }, // safety only
  // Chart chrome
  grid:   { light: "#e8edf3", dark: "#232e40" },
  axis:   { light: "#cbd5e1", dark: "#33415a" },
  tick:   { light: "#64748b", dark: "#8595ab" },
};

function resolve(mode) {
  return Object.fromEntries(
    Object.entries(PALETTE).map(([k, v]) => [k, v[mode]]),
  );
}

export const chartColors = (dark) => resolve(dark ? "dark" : "light");

// Subscribe to the `.dark` class on <html> so charts re-read their palette the
// instant the theme flips — no prop-drilling through every panel.
function subscribe(cb) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}
const isDark = () => document.documentElement.classList.contains("dark");

// Hook: returns the resolved chart palette for the current theme, re-rendering
// on theme change. getServerSnapshot returns the light set (SSR-safe default).
export function useChartTheme() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  return chartColors(dark);
}
