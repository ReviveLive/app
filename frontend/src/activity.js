// Route-derived activity — turns a day's GPS/PTO fixes into the numbers the
// Overview shows (time at work vs travel, jobs, stops). The stop-clustering here
// is the single source used by both RoutePanel (to draw stop dots) and the
// Overview activity panel, so the "N stops" they report always agree.
//
// Honesty note: with no speed channel we can't split idling from driving, so
// "travel" means "PTO not engaged" (moving OR idling), mirroring the RPM tab's
// PTO-off caveat. Only real fixes are grouped — no geometry is invented.

const STOP_RADIUS_M = 50;
const MIN_DWELL_MIN = 8;

// Haversine distance in metres between [lat, lng] pairs.
export function metres(a, b) {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad, dLng = (b[1] - a[1]) * toRad;
  const la1 = a[0] * toRad, la2 = b[0] * toRad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Collapse a day's fixes into ordered stops (stationary clusters) and legs
// (movement between them). Anchor-based clustering: each fix is compared to the
// cluster's FIRST fix so slow drift can't smear one stop across a wide area.
export function groupStops(points) {
  const clusters = [];
  for (let i = 0; i < points.length; i++) {
    const ll = [points[i].lat, points[i].lng];
    const cur = clusters[clusters.length - 1];
    if (cur && metres(cur.anchor, ll) <= STOP_RADIUS_M) cur.idx.push(i);
    else clusters.push({ idx: [i], anchor: ll });
  }

  const segs = [];
  let pendingLeg = [];
  let lastStopLastIdx = null;
  const flushLeg = (nextStopFirstIdx) => {
    const idx = [];
    if (lastStopLastIdx !== null) idx.push(lastStopLastIdx);
    idx.push(...pendingLeg);
    if (nextStopFirstIdx !== null) idx.push(nextStopFirstIdx);
    if (idx.length >= 2) segs.push({ type: "leg", idx });
    pendingLeg = [];
  };

  for (const c of clusters) {
    const spanMin =
      (new Date(points[c.idx[c.idx.length - 1]].ts) - new Date(points[c.idx[0]].ts)) / 60000;
    if (c.idx.length >= 2 && spanMin >= MIN_DWELL_MIN) {
      flushLeg(c.idx[0]);
      const lat = c.idx.reduce((s, j) => s + points[j].lat, 0) / c.idx.length;
      const lng = c.idx.reduce((s, j) => s + points[j].lng, 0) / c.idx.length;
      segs.push({
        type: "stop",
        center: [lat, lng],
        startTs: points[c.idx[0]].ts,
        endTs: points[c.idx[c.idx.length - 1]].ts,
        pto: c.idx.some((j) => points[j].pto === 1),
      });
      lastStopLastIdx = c.idx[c.idx.length - 1];
    } else {
      pendingLeg.push(...c.idx);
    }
  }
  flushLeg(null);
  return segs;
}

// Derive the day's activity summary. Working time = elapsed between consecutive
// fixes while PTO is engaged; travel = the rest. A gap longer than GAP_CAP_MIN
// (feed dropout / end of shift) isn't counted as either.
const GAP_CAP_MIN = 30;

export function deriveActivity(points) {
  if (!points || points.length < 2) {
    return { workMin: 0, travelMin: 0, totalMin: 0, jobs: 0, stops: 0, workPct: 0 };
  }
  let workMin = 0, travelMin = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dt = (new Date(points[i + 1].ts) - new Date(points[i].ts)) / 60000;
    if (dt <= 0 || dt > GAP_CAP_MIN) continue;
    if (points[i].pto === 1) workMin += dt;
    else travelMin += dt;
  }
  const segs = groupStops(points);
  const stops = segs.filter((s) => s.type === "stop").length;
  const jobs = segs.filter((s) => s.type === "stop" && s.pto).length;
  const totalMin = workMin + travelMin;
  const workPct = totalMin > 0 ? (workMin / totalMin) * 100 : 0;
  return { workMin, travelMin, totalMin, jobs, stops, workPct };
}

// "8 h 12 m" / "45 m" from minutes.
export function fmtDur(min) {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} m` : `${m} m`;
}
