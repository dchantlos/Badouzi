/* ============================================================
   Badouzi Port Digital Twin — current-weather context panel
   Open-Meteo (https://open-meteo.com): open data, no API key,
   CORS-enabled, free for non-commercial use. Context only: the
   scene's clouds / rain and the water scenarios are illustrative
   and are not driven by this feed.
   ============================================================ */

// Badouzi fishing port, Keelung, Taiwan. Taiwan has no daylight saving, so
// UTC+8 is a safe fallback if a response omits utc_offset_seconds.
const SITE = {
  lat: 25.1476,
  lon: 121.7965,
  tz: "Asia/Taipei",
  utcOffsetSeconds: 8 * 3600,
  place: "Badouzi \u00b7 Keelung"
};

// Current conditions + a 5-day daily forecast in one request.
const FORECAST_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${SITE.lat}&longitude=${SITE.lon}` +
  "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day," +
  "precipitation,weather_code,wind_speed_10m,wind_direction_10m" +
  "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
  `&timezone=${encodeURIComponent(SITE.tz)}&forecast_days=5&wind_speed_unit=ms`;

const REFRESH_MS = 10 * 60 * 1000; // Open-Meteo current data steps every 15 min; poll every 10 min
const FETCH_TIMEOUT_MS = 8000; // abort a stalled request so the fallback kicks in fast
const MAX_AGE_MS = 3 * 60 * 60 * 1000; // show the last good reading for up to 3h after its data time
const DELAYED_AFTER_MS = 90 * 60 * 1000; // freshly fetched data older than this is flagged "Delayed"
const CACHE_KEY = "badouziWeatherCache"; // last good payload, to survive reloads

// Minimal line-art weather icons (24-view, stroke = currentColor so CSS tints).
const CLOUD = "M6 15a4 4 0 0 1 0-8 6 6 0 0 1 11.5-1.6A4.4 4.4 0 0 1 17.4 15H6z";
const ICONS = {
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.4V4M12 20v1.6M4 12H2.4M21.6 12H20M5.2 5.2 6.4 6.4M17.6 17.6l1.2 1.2M18.8 5.2 17.6 6.4M6.4 17.6 5.2 18.8"/>',
  moon: '<path d="M21 13.2A8.6 8.6 0 1 1 10.8 3 6.7 6.7 0 0 0 21 13.2z"/>',
  partly:
    '<circle cx="8" cy="8" r="3"/><path d="M8 2.6V1.4M3.5 3.5l-.9-.9M2.6 8H1.4M13.4 3.5l.9-.9"/>' +
    '<path d="M10 19.5a3.6 3.6 0 0 1 0-7.2 5 5 0 0 1 9.6-1.3A3.8 3.8 0 0 1 19 19.5H10z"/>',
  cloud: `<path d="${CLOUD}"/>`,
  fog: `<path d="${CLOUD}"/><path d="M4 18.4h16M7 21.2h11"/>`,
  rain: `<path d="${CLOUD}"/><path d="M8.5 17.6 7.5 20.4M12 17.6 11 20.4M15.5 17.6l-1 2.8"/>`,
  snow: `<path d="${CLOUD}"/><path d="M8.5 18h.02M12 19h.02M15.5 18h.02M10.2 20.6h.02M13.8 20.6h.02"/>`,
  storm: `<path d="${CLOUD}"/><path d="M12.5 16.5 10 20h3l-2.2 3.4"/>`
};

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (deg) => COMPASS[(Math.round(deg / 22.5) % 16 + 16) % 16];
const finite = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const at = (arr, i) => (Array.isArray(arr) ? arr[i] : undefined);
const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ` +
  `stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

/**
 * Open-Meteo returns timezone-less local wall-clock times ("2026-10-30T08:00")
 * for the requested timezone, plus utc_offset_seconds. Convert to an absolute
 * instant WITHOUT letting the presentation laptop's own timezone leak in.
 * Returns epoch ms, or null if the timestamp is missing / malformed.
 */
export function providerTimeToMs(iso, utcOffsetSeconds) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(iso || "");
  const offset = finite(utcOffsetSeconds);
  if (!m || offset === null) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return utc - offset * 1000;
}

/** "HH:MM" in Taipei time, regardless of the device timezone. */
export function formatSiteTime(ms) {
  return new Date(ms).toLocaleTimeString("en-GB", {
    timeZone: SITE.tz,
    hour: "2-digit",
    minute: "2-digit"
  });
}

/** Weekday ("Sat") of a provider calendar date ("2026-10-31"), device-timezone independent. */
export function weekdayOf(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC"
  });
}

/** Data-valid time of a payload (epoch ms) or null if it cannot be determined. */
export function dataValidTime(data) {
  if (!data || !data.current) return null;
  const offset = finite(data.utc_offset_seconds);
  return providerTimeToMs(data.current.time, offset === null ? SITE.utcOffsetSeconds : offset);
}

// WMO weather code → { label, icon }. isDay swaps clear/partly to night glyphs.
// A missing or unrecognised code gets no icon rather than an invented one.
function describe(code, isDay) {
  if (typeof code !== "number" || !isFinite(code)) return { label: "Conditions unavailable", icon: null };
  if (code === 0) return { label: "Clear", icon: isDay ? "sun" : "moon" };
  if (code === 1 || code === 2) return { label: "Partly cloudy", icon: isDay ? "partly" : "moon" };
  if (code === 3) return { label: "Overcast", icon: "cloud" };
  if (code === 45 || code === 48) return { label: "Fog", icon: "fog" };
  if (code >= 51 && code <= 57) return { label: "Drizzle", icon: "rain" };
  if (code >= 61 && code <= 67) return { label: "Rain", icon: "rain" };
  if (code >= 71 && code <= 77) return { label: "Snow", icon: "snow" };
  if (code >= 80 && code <= 82) return { label: "Showers", icon: "rain" };
  if (code === 85 || code === 86) return { label: "Snow showers", icon: "snow" };
  if (code >= 95) return { label: "Thunderstorm", icon: "storm" };
  return { label: "\u2014", icon: null };
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return c && c.data && c.ts ? c : null;
  } catch {
    return null;
  }
}

function saveCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* private mode / quota — non-fatal */
  }
}

// Fetch current + daily; resolves to the payload, or null on any failure.
async function fetchWeather() {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(FORECAST_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`weather ${res.status}`);
    const data = await res.json();
    if (!data || !data.current) return null;
    return data;
  } catch {
    return null; // offline / blocked / timeout — caller falls back to cache
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Current-weather context panel. Populates the #weatherPanel shell, polls
 * Open-Meteo every REFRESH_MS and caches the last good reading (memory +
 * localStorage). It always shows the provider's DATA-VALID time separately
 * from when the app last retrieved it, so re-fetching unchanged data never
 * makes it look newer. States: Live / Delayed (fetched, but old data) /
 * Cached (network failed, last-known data) / Offline (nothing usable).
 * This panel is context only — it does not drive the water scenario.
 */
export function createWeatherPanel() {
  const panel = document.getElementById("weatherPanel");
  if (!panel) return;

  const el = (id) => document.getElementById(id);
  const set = (id, text) => {
    const node = el(id);
    if (node) node.textContent = text;
  };

  let cache = loadCache();
  let lastFailureAt = null;

  // Age is measured from the data-valid time (falling back to retrieval time).
  const ageOf = (c) => Date.now() - (dataValidTime(c.data) ?? c.ts);
  const usable = (c) => !!c && ageOf(c) < MAX_AGE_MS;

  const STATUS = {
    live: { text: "Live", cls: "" },
    delayed: { text: "Delayed", cls: "stale" },
    cached: { text: "Cached", cls: "stale" },
    off: { text: "Offline", cls: "off" }
  };

  function setStatus(mode) {
    const s = el("weatherStatus");
    if (!s) return;
    s.classList.remove("pending", "stale", "off");
    s.textContent = STATUS[mode].text;
    if (STATUS[mode].cls) s.classList.add(STATUS[mode].cls);
  }

  function render(c, mode) {
    const data = c.data;
    const cur = data.current || {};
    const info = describe(cur.weather_code, cur.is_day !== 0);
    const icon = el("weatherIcon");
    if (icon) icon.innerHTML = info.icon ? svg(ICONS[info.icon]) : "";

    const temp = finite(cur.temperature_2m);
    const feels = finite(cur.apparent_temperature);
    const hum = finite(cur.relative_humidity_2m);
    const wind = finite(cur.wind_speed_10m);
    const dir = finite(cur.wind_direction_10m);
    const precip = finite(cur.precipitation);
    const interval = finite(cur.interval);
    const precipUnit = (data.current_units && data.current_units.precipitation) || "mm";

    set("weatherTemp", temp == null ? "\u2014" : `${Math.round(temp)}\u00b0`);
    set("weatherCond", info.label);
    set("weatherFeels", feels == null ? "\u2014" : `${Math.round(feels)}\u00b0`);
    set("weatherHum", hum == null ? "\u2014" : `${Math.round(hum)}%`);
    set(
      "weatherWind",
      wind == null ? "\u2014" : `${Math.round(wind)} m/s${dir == null ? "" : " " + compass(dir)}`
    );
    // Open-Meteo "current" precipitation is the total over the preceding
    // `interval` seconds (15 min for this feed), not an hourly or daily sum.
    set("weatherPrecipLabel", interval == null ? "" : `${Math.round(interval / 60)} min total`);
    set("weatherPrecip", precip == null ? "\u2014" : `${precip.toFixed(1)} ${precipUnit}`);

    // 5-day forecast strip (only days with a valid date are shown).
    const strip = el("weatherForecast");
    const d = data.daily;
    if (strip) {
      strip.innerHTML =
        d && Array.isArray(d.time)
          ? d.time
              .map((iso, i) => {
                const day = i === 0 ? "Today" : weekdayOf(iso);
                if (!day) return "";
                const fi = describe(at(d.weather_code, i), true);
                const hi = finite(at(d.temperature_2m_max, i));
                const lo = finite(at(d.temperature_2m_min, i));
                const pop = finite(at(d.precipitation_probability_max, i));
                return (
                  `<div class="wx-day${i === 0 ? " today" : ""}">` +
                  `<span class="wx-day-name">${day}</span>` +
                  `<span class="wx-day-icon">${fi.icon ? svg(ICONS[fi.icon]) : ""}</span>` +
                  `<span class="wx-day-pop" title="Max. precipitation probability">${
                    pop == null || pop === 0 ? "" : pop + "%"
                  }</span>` +
                  `<span class="wx-day-hilo"><b>${hi == null ? "\u2014" : Math.round(hi) + "\u00b0"}</b> ` +
                  `${lo == null ? "\u2014" : Math.round(lo) + "\u00b0"}</span>` +
                  "</div>"
                );
              })
              .join("")
          : "";
    }

    setStatus(mode);
    const valid = dataValidTime(data);
    const dataText = valid == null ? "data time unavailable" : `data ${formatSiteTime(valid)}`;
    const fetched = formatSiteTime(c.ts);
    set(
      "weatherUpdated",
      mode === "cached"
        ? `Open-Meteo \u00b7 ${dataText} \u00b7 retrieved ${fetched} Taipei`
        : `Open-Meteo \u00b7 ${dataText} \u00b7 checked ${fetched} Taipei`
    );
    set(
      "weatherNote",
      mode === "cached" && lastFailureAt
        ? `Refresh failed ${formatSiteTime(lastFailureAt)} \u2014 showing last-known data`
        : "Context only \u00b7 not linked to the water scenario"
    );
    panel.classList.add("ready");
  }

  // Nothing usable: clear the numbers so old readings never linger as current.
  function renderOffline() {
    setStatus("off");
    const icon = el("weatherIcon");
    if (icon) icon.innerHTML = "";
    ["weatherTemp", "weatherFeels", "weatherHum", "weatherWind", "weatherPrecip"].forEach((id) =>
      set(id, "\u2014")
    );
    set("weatherCond", "Weather unavailable");
    const strip = el("weatherForecast");
    if (strip) strip.innerHTML = "";
    set("weatherUpdated", "Open-Meteo unavailable \u2014 retrying every 10 min");
    set("weatherNote", "Context only \u00b7 not linked to the water scenario");
  }

  async function refresh() {
    const data = await fetchWeather();
    if (data) {
      cache = { data, ts: Date.now() };
      saveCache(cache);
      lastFailureAt = null;
      render(cache, ageOf(cache) > DELAYED_AFTER_MS ? "delayed" : "live");
    } else {
      lastFailureAt = Date.now();
      if (usable(cache)) render(cache, "cached");
      else renderOffline();
    }
  }

  // Instant paint from a still-usable cache (marked Cached), then refresh.
  if (usable(cache)) render(cache, "cached");
  refresh();
  setInterval(refresh, REFRESH_MS);
}
