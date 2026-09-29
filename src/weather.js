// Weather via Open-Meteo (free, no API key). The server fetches and caches the data,
// so the display itself never talks to third parties.
import { config } from './config.js';
import { HttpError } from './errors.js';
import { getSettings, currentLanguage } from './service.js';

const CACHE_MS = 10 * 60 * 1000;
let cache = { key: null, at: 0, data: null };

// WMO weather codes → icon key used by the display. The display translates the code itself ("weather.codes.<code>").
const ICONS = {
  0: 'clear',
  1: 'mostly-clear',
  2: 'partly-cloudy',
  3: 'cloudy',
  45: 'fog',
  48: 'fog',
  51: 'drizzle',
  53: 'drizzle',
  55: 'drizzle',
  56: 'sleet',
  57: 'sleet',
  61: 'rain',
  63: 'rain',
  65: 'rain',
  66: 'sleet',
  67: 'sleet',
  71: 'snow',
  73: 'snow',
  75: 'snow',
  77: 'snow',
  80: 'showers',
  81: 'showers',
  82: 'showers',
  85: 'snow',
  86: 'snow',
  95: 'thunder',
  96: 'thunder',
  99: 'thunder',
};

function describe(code, isDay = 1) {
  const icon = ICONS[code] ?? 'cloudy';
  const night = !isDay && ['clear', 'mostly-clear', 'partly-cloudy'].includes(icon);
  return { code, icon: night ? `${icon}-night` : icon };
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'company-welcomescreen' } });
  if (!res.ok) throw new HttpError(502, 'errors.weatherStatus', { status: res.status });
  return res.json();
}

export async function getWeather() {
  const s = getSettings();
  if (s.weather_latitude == null || s.weather_longitude == null) throw new HttpError(404, 'errors.noWeatherLocation');
  const key = `${s.weather_latitude},${s.weather_longitude}`;
  if (cache.key === key && Date.now() - cache.at < CACHE_MS) return { ...cache.data, location: s.weather_location_name };

  const params = new URLSearchParams({
    latitude: s.weather_latitude,
    longitude: s.weather_longitude,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    forecast_days: 6,
    forecast_hours: 12,
    timezone: config.timeZone,
  });
  try {
    const raw = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
    const c = raw.current;
    const data = {
      updated_at: c.time,
      current: {
        temperature: c.temperature_2m,
        apparent_temperature: c.apparent_temperature,
        humidity: c.relative_humidity_2m,
        wind_speed: c.wind_speed_10m,
        ...describe(c.weather_code, c.is_day),
      },
      hourly: raw.hourly.time.map((time, i) => ({
        time,
        temperature: raw.hourly.temperature_2m[i],
        precipitation_probability: raw.hourly.precipitation_probability[i],
        ...describe(raw.hourly.weather_code[i], raw.hourly.is_day[i]),
      })),
      daily: raw.daily.time.map((date, i) => ({
        date,
        max: raw.daily.temperature_2m_max[i],
        min: raw.daily.temperature_2m_min[i],
        precipitation_probability: raw.daily.precipitation_probability_max[i],
        sunrise: raw.daily.sunrise[i],
        sunset: raw.daily.sunset[i],
        ...describe(raw.daily.weather_code[i]),
      })),
    };
    cache = { key, at: Date.now(), data };
    return { ...data, location: s.weather_location_name };
  } catch (err) {
    // Serve stale data rather than nothing when the weather service is briefly unreachable.
    if (cache.key === key && cache.data) return { ...cache.data, location: s.weather_location_name, stale: true };
    throw err instanceof HttpError ? err : new HttpError(502, 'errors.weatherUnreachable', { message: err.message });
  }
}

/** Looks up places by name (for the admin settings). */
export async function geocode(query) {
  const q = String(query ?? '').trim();
  if (q.length < 2) throw new HttpError(400, 'errors.geocodeTooShort');
  const params = new URLSearchParams({ name: q, count: 8, language: currentLanguage(), format: 'json' });
  const raw = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${params}`).catch((err) => {
    throw err instanceof HttpError ? err : new HttpError(502, 'errors.geocodeUnreachable', { message: err.message });
  });
  return (raw.results ?? []).map((r) => ({
    name: r.name,
    region: [r.admin1, r.country].filter(Boolean).join(', '),
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}
