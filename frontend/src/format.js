// Number formatting shared across the charts.
//
// Compact axis ticks keep the Y axis narrow so large values (e.g. 12,000 L)
// aren't clipped by the axis width: 12000 -> "12k", 1500 -> "1.5k", 800 -> "800".
export function fmtAxisTick(v) {
  if (v == null || Number.isNaN(v)) return "";
  const a = Math.abs(v);
  if (a >= 1000) {
    const k = v / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return `${v}`;
}
