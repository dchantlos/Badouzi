/* ============================================================
   Badouzi Port Digital Twin — live local weather panel
   Open-Meteo (https://open-meteo.com): open data, no API key,
   CORS-enabled, free for non-commercial use.
   ============================================================ */

// Badouzi fishing port, Keelung, Taiwan.
const SITE = { lat: 25.1476, lon: 121.7965, tz: "Asia/Taipei", place: "Badouzi \u00b7 Keelung" };

// Current conditions + a 5-day daily forecast in one request.
const FORECAST_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${SITE.lat}&longitude=${SITE.lon}` +
  "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day," +
  "precipitation,weather_code,wind_speed_10m,wind_direction_10m" +
  "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
  `&timezone=${encodeURIComponent(SITE.tz)}&forecast_days=5&wind_speed_unit=ms`;

const REFRESH_MS = 10 * 60 * 1000; // Open-Meteo updates hourly at most; poll every 10 min
const FETCH_TIMEOUT_MS = 8000; // abort a stalled request so the fallback kicks in fast
const MAX_AGE_MS = 3 * 60 * 60 * 1000; // trust the last good reading for up to 3h
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
const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ` +
  `stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

// WMO weather code → { label, icon }. isDay swaps clear/partly to night glyphs.
function describe(code, isDay) {
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
  return { label: "\u2014", icon: "cloud" };
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
    if (!data || !data.current || !data.daily) return null;
    return data;
  } catch {
    return null; // offline / blocked / timeout — caller falls back to cache
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Live local-weather panel. Populates the #weatherPanel shell, polls Open-Meteo
 * every REFRESH_MS, caches the last good reading (memory + localStorage) and
 * degrades gracefully: fresh cache keeps the panel alive through a short outage,
 * and a hard failure with no usable cache shows an unobtrusive "Offline" state.
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

  function setStatus(mode) {
    const s = el("weatherStatus");
    if (!s) return;
    s.classList.remove("stale", "off");
    if (mode === "live") s.textContent = "Live";
    else if (mode === "stale") {
      s.textContent = "Cached";
      s.classList.add("stale");
    } else {
      s.textContent = "Offline";
      s.classList.add("off");
    }
  }

  function render(data, ts, mode) {
    const c = data.current;
    const info = describe(c.weather_code, c.is_day === 1);
    const icon = el("weatherIcon");
    if (icon) icon.innerHTML = svg(ICONS[info.icon] || ICONS.cloud);

    const temp = finite(c.temperature_2m);
    const feels = finite(c.apparent_temperature);
    const hum = finite(c.relative_humidity_2m);
    const wind = finite(c.wind_speed_10m);
    const dir = finite(c.wind_direction_10m);
    const precip = finite(c.precipitation);

    set("weatherTemp", temp == null ? "\u2014" : `${Math.round(temp)}\u00b0`);
    set("weatherCond", info.label);
    set("weatherFeels", feels == null ? "\u2014" : `${Math.round(feels)}\u00b0`);
    set("weatherHum", hum == null ? "\u2014" : `${Math.round(hum)}%`);
    set(
      "weatherWind",
      wind == null ? "\u2014" : `${Math.round(wind)} m/s${dir == null ? "" : " " + compass(dir)}`
    );
    set("weatherPrecip", precip == null ? "\u2014" : `${precip.toFixed(1)} mm`);

    // 5-day forecast strip.
    const strip = el("weatherForecast");
    const d = data.daily;
    if (strip && d && Array.isArray(d.time)) {
      strip.innerHTML = d.time
        .map((iso, i) => {
          const day =
            i === 0
              ? "Today"
              : new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
                  weekday: "short",
                  timeZone: SITE.tz
                });
          const fi = describe(d.weather_code[i], true);
          const hi = finite(d.temperature_2m_max[i]);
          const lo = finite(d.temperature_2m_min[i]);
          const pop = finite(d.precipitation_probability_max[i]);
          return (
            `<div class="wx-day${i === 0 ? " today" : ""}">` +
            `<span class="wx-day-name">${day}</span>` +
            `<span class="wx-day-icon">${svg(ICONS[fi.icon] || ICONS.cloud)}</span>` +
            `<span class="wx-day-pop">${pop == null || pop === 0 ? "" : pop + "%"}</span>` +
            `<span class="wx-day-hilo"><b>${hi == null ? "\u2014" : Math.round(hi) + "\u00b0"}</b> ` +
            `${lo == null ? "\u2014" : Math.round(lo) + "\u00b0"}</span>` +
            "</div>"
          );
        })
        .join("");
    }

    setStatus(mode);
    const t = new Date(ts).toLocaleTimeString("en-GB", {
      timeZone: SITE.tz,
      hour: "2-digit",
      minute: "2-digit"
    });
    set("weatherUpdated", `Updated ${t} \u00b7 Open-Meteo`);
    panel.classList.add("ready");
  }

  function renderOffline() {
    setStatus("off");
    set("weatherUpdated", "Weather unavailable \u2014 retrying\u2026");
  }

  async function refresh() {
    const data = await fetchWeather();
    if (data) {
      cache = { data, ts: Date.now() };
      saveCache(cache);
      render(cache.data, cache.ts, "live");
    } else if (cache && Date.now() - cache.ts < MAX_AGE_MS) {
      render(cache.data, cache.ts, "stale");
    } else {
      renderOffline();
    }
  }

  // Instant paint from a still-fresh cache, then refresh from the network.
  if (cache && Date.now() - cache.ts < MAX_AGE_MS) render(cache.data, cache.ts, "stale");
  refresh();
  setInterval(refresh, REFRESH_MS);
}
