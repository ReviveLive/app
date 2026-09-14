// Live local weather via Open-Meteo — a free, keyless forecast API. Fetched
// client-side by the vehicle's lat/lng, exactly like geocode.js reverse-geocodes
// the location, so it runs identically in the live-API (Docker) build and the
// static/Vercel build with no backend or snapshot involvement.
//
// This is NOT vehicle telemetry — it is an external forecast for wherever the
// vehicle last reported. The UI labels it "Live local forecast" to keep that
// distinction honest (CLAUDE.md #3).
//
// Results are cached in localStorage keyed on rounded coords + the current
// date-hour, so a parked vehicle costs one lookup per hour (Open-Meteo asks for
// non-commercial fair use; hourly caching is well within it).
const KEY = "revive-weather-cache-v1";

function loadCache() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

// WMO weather code -> a weather-app-style emoji + short label. Codes per the
// Open-Meteo docs (https://open-meteo.com/en/docs). Thunderstorm codes (95/96/99)
// also drive the storm warning in the UI. `label` stays plain English (no other
// consumer needs it as-is); `labelKey` is what the live UI translates via t().
export function wmo(code) {
  const c = Number(code);
  if (c === 0) return { emoji: "☀️", label: "Clear", labelKey: "common.weatherConditions.clear" };
  if (c === 1) return { emoji: "🌤️", label: "Mainly clear", labelKey: "common.weatherConditions.mainlyClear" };
  if (c === 2) return { emoji: "⛅", label: "Partly cloudy", labelKey: "common.weatherConditions.partlyCloudy" };
  if (c === 3) return { emoji: "☁️", label: "Overcast", labelKey: "common.weatherConditions.overcast" };
  if (c === 45 || c === 48) return { emoji: "🌫️", label: "Fog", labelKey: "common.weatherConditions.fog" };
  if (c >= 51 && c <= 57) return { emoji: "🌦️", label: "Drizzle", labelKey: "common.weatherConditions.drizzle" };
  if (c === 61 || c === 66) return { emoji: "🌧️", label: "Light rain", labelKey: "common.weatherConditions.lightRain" };
  if (c === 63) return { emoji: "🌧️", label: "Rain", labelKey: "common.weatherConditions.rain" };
  if (c === 65 || c === 67) return { emoji: "🌧️", label: "Heavy rain", labelKey: "common.weatherConditions.heavyRain" };
  if (c >= 71 && c <= 77) return { emoji: "🌨️", label: "Snow", labelKey: "common.weatherConditions.snow" };
  if (c === 80 || c === 81) return { emoji: "🌦️", label: "Showers", labelKey: "common.weatherConditions.showers" };
  if (c === 82) return { emoji: "🌧️", label: "Heavy showers", labelKey: "common.weatherConditions.heavyShowers" };
  if (c === 85 || c === 86) return { emoji: "🌨️", label: "Snow showers", labelKey: "common.weatherConditions.snowShowers" };
  if (c >= 95) return { emoji: "⛈️", label: "Thunderstorm", labelKey: "common.weatherConditions.thunderstorm" };
  return { emoji: "🌥️", label: "Cloudy", labelKey: "common.weatherConditions.cloudy" };
}

// A slug for when in the day the rain peaks, from a 0-23 hour - translated by
// the caller via common.weatherPanel.peak.{slug} (not display text itself, so
// it stays a stable key regardless of locale).
function peakLabel(hour) {
  if (hour == null) return null;
  if (hour < 6) return "overnight";
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  if (hour < 18) return "afternoon";
  if (hour < 22) return "evening";
  return "overnight";
}

export async function getForecast(lat, lng) {
  if (lat == null || lng == null) return null;

  // Cache cell: ~110 m coords + the current hour, so it refreshes hourly.
  const now = new Date();
  const stamp = `${now.toISOString().slice(0, 13)}`; // YYYY-MM-DDTHH
  const k = `${lat.toFixed(3)},${lng.toFixed(3)}@${stamp}`;
  const cache = loadCache();
  if (k in cache) return cache[k];

  const url = "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat}&longitude=${lng}` +
    "&current=temperature_2m,weather_code" +
    "&hourly=temperature_2m,precipitation,precipitation_probability" +
    "&daily=temperature_2m_min,precipitation_probability_max,precipitation_sum," +
    "weather_code,wind_gusts_10m_max" +
    "&timezone=auto&forecast_days=2";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`weather -> ${res.status}`);
  const j = await res.json();

  const daily = j.daily || {};
  const hourly = j.hourly || {};
  const times = hourly.time || [];
  const temps = hourly.temperature_2m || [];
  const precip = hourly.precipitation || [];

  // Overnight low: the coldest hourly temp in the coming-night window (from ~9pm
  // tonight through ~9am tomorrow, in the location's own local time — Open-Meteo
  // returns local timestamps because we asked for timezone=auto). Falls back to
  // the API's daily minimum if the window can't be resolved.
  const today = (times[0] || "").slice(0, 10);
  let overnightLow = null;
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const date = t.slice(0, 10);
    const hour = Number(t.slice(11, 13));
    const nightTonight = date === today && hour >= 21;
    const nightTomorrow = date > today && hour <= 9;
    if (nightTonight || nightTomorrow) {
      const v = temps[i];
      if (v != null && (overnightLow == null || v < overnightLow)) overnightLow = v;
    }
  }
  if (overnightLow == null) overnightLow = daily.temperature_2m_min?.[0] ?? null;

  const rainChance = daily.precipitation_probability_max?.[0] ?? null;
  const rainSum = daily.precipitation_sum?.[0] ?? null;

  // When it rains hardest today — the hour of peak hourly precipitation. Only
  // meaningful if there's actually rain in the forecast.
  let rainPeakLabel = null;
  if ((rainSum ?? 0) > 0.1 && (rainChance ?? 0) >= 20) {
    let bestHour = null, best = 0;
    for (let i = 0; i < times.length; i++) {
      if (times[i].slice(0, 10) !== today) continue;
      const mm = precip[i] ?? 0;
      if (mm > best) { best = mm; bestHour = Number(times[i].slice(11, 13)); }
    }
    rainPeakLabel = peakLabel(bestHour);
  }

  const out = {
    tempNow: j.current?.temperature_2m ?? null,
    code: j.current?.weather_code ?? daily.weather_code?.[0] ?? null,
    dayCode: daily.weather_code?.[0] ?? null,
    windGust: daily.wind_gusts_10m_max?.[0] ?? null, // km/h, today
    overnightLow,
    rainChance,
    rainSum,
    rainPeakLabel,
  };

  cache[k] = out;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* best-effort */ }
  return out;
}
