// Resolves a vehicle's last-known GPS fix from `readings`, preferring the
// real trial vehicle's actual tag names (confirmed 2026-09-08) and falling
// back to the original demo fleet's channel names. A given vehicle only ever
// reports under one pair, so there's no ambiguity in trying both.
//
// `readings` only ever holds each parameter's own single latest value (no
// history), so lat and lng are two INDEPENDENT "latest reading" lookups -
// nothing here guarantees they came from the same actual fix. Real telemetry
// always reports both together at the same timestamp (confirmed against the
// trial vehicle's history), but a single bad/isolated write to just one of
// the two (e.g. a stray test insert, 2026-09-13: two lat-only rows landed
// with no matching lon, pairing a fresh bad latitude with a 3-day-stale
// longitude and placing the truck off the coast of Africa) would otherwise
// silently combine into a nonsense coordinate. FIX_TOLERANCE_MS rejects that:
// if the two timestamps are further apart than one real reporting interval
// would ever be, treat it as no fix rather than fabricate a location from
// two readings that were never actually part of the same fix.
const FIX_TOLERANCE_MS = 5 * 60 * 1000; // one real reporting interval, per the data above

export function getGpsFix(readings) {
  const latR = readings?.["gps_lat_revlive"] ?? readings?.["Latitude Decimal Degrees"];
  const lngR = readings?.["gps_lon_revlive"] ?? readings?.["Longitude Decimal Degrees"];
  if (!latR || !lngR) return { lat: null, lng: null, ts: null };

  const latTs = new Date(latR.ts).getTime();
  const lngTs = new Date(lngR.ts).getTime();
  if (Math.abs(latTs - lngTs) > FIX_TOLERANCE_MS) return { lat: null, lng: null, ts: null };

  return { lat: latR.value, lng: lngR.value, ts: latR.ts > lngR.ts ? latR.ts : lngR.ts };
}
