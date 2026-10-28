/**
 * The weather on the Home page and beside outdoor events in the calendar. Forecasts come from
 * Open-Meteo, which is free and needs no account or key. You pick your town once (found with the
 * same OpenStreetMap search as places in notes); temperatures are in °C and wind in mph.
 */

export interface WeatherPlace {
  name: string
  lat: number
  lon: number
}

export interface WeatherDay {
  /** Day key, e.g. "2026-10-28". */
  date: string
  code: number
  max: number
  min: number
  /** Chance of rain (or snow), 0–100. */
  rain: number
}

export interface WeatherHour {
  /** Local time at the place, e.g. "2026-10-28T14:00". */
  time: string
  code: number
  temp: number
  rain: number
}

export interface Forecast {
  /** When it was fetched (ms). */
  at: number
  current: { temp: number; feels: number; code: number; isDay: boolean; wind: number }
  days: WeatherDay[]
  hours: WeatherHour[]
}

/** What the main process knows: your town, the last forecast (kept for when you're offline), and any problem. */
export interface WeatherState {
  place: WeatherPlace | null
  forecast: Forecast | null
  error?: string
}

export const FORECAST_DAYS = 14

export function forecastUrl(place: WeatherPlace): string {
  const q = new URLSearchParams({
    latitude: String(Math.round(place.lat * 1e4) / 1e4),
    longitude: String(Math.round(place.lon * 1e4) / 1e4),
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: String(FORECAST_DAYS),
    wind_speed_unit: 'mph'
  })
  return `https://api.open-meteo.com/v1/forecast?${q.toString().replace(/%2C/g, ',')}`
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Turns Open-Meteo's answer into a forecast; null if it isn't one. */
export function parseForecast(json: unknown, at = Date.now()): Forecast | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, Record<string, unknown> | undefined>
  const c = j.current ?? {}
  const temp = num(c.temperature_2m)
  if (temp === null) return null
  const d = j.daily ?? {}
  const days: WeatherDay[] = []
  list(d.time).forEach((date, i) => {
    const max = num(list(d.temperature_2m_max)[i])
    const min = num(list(d.temperature_2m_min)[i])
    if (typeof date !== 'string' || max === null || min === null) return
    days.push({
      date,
      code: num(list(d.weather_code)[i]) ?? 0,
      max,
      min,
      rain: num(list(d.precipitation_probability_max)[i]) ?? 0
    })
  })
  const h = j.hourly ?? {}
  const hours: WeatherHour[] = []
  list(h.time).forEach((time, i) => {
    const t = num(list(h.temperature_2m)[i])
    if (typeof time !== 'string' || t === null) return
    hours.push({ time, code: num(list(h.weather_code)[i]) ?? 0, temp: t, rain: num(list(h.precipitation_probability)[i]) ?? 0 })
  })
  return {
    at,
    current: {
      temp,
      feels: num(c.apparent_temperature) ?? temp,
      code: num(c.weather_code) ?? 0,
      isDay: c.is_day !== 0,
      wind: num(c.wind_speed_10m) ?? 0
    },
    days,
    hours
  }
}

export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm'

/** The weather codes Open-Meteo uses (WMO), in words, and which picture to show. */
export function describeWeather(code: number): { label: string; kind: WeatherKind } {
  if (code === 0) return { label: 'Clear', kind: 'clear' }
  if (code === 1) return { label: 'Mostly clear', kind: 'partly' }
  if (code === 2) return { label: 'Partly cloudy', kind: 'partly' }
  if (code === 3) return { label: 'Cloudy', kind: 'cloudy' }
  if (code === 45 || code === 48) return { label: 'Fog', kind: 'fog' }
  if (code >= 51 && code <= 57) return { label: 'Drizzle', kind: 'drizzle' }
  if (code === 61 || code === 80) return { label: 'Light rain', kind: 'rain' }
  if (code === 63 || code === 81) return { label: 'Rain', kind: 'rain' }
  if (code === 65 || code === 82) return { label: 'Heavy rain', kind: 'rain' }
  if (code === 66 || code === 67) return { label: 'Freezing rain', kind: 'rain' }
  if (code === 71 || code === 85) return { label: 'Light snow', kind: 'snow' }
  if (code === 73 || code === 75 || code === 86) return { label: 'Snow', kind: 'snow' }
  if (code === 77) return { label: 'Snow grains', kind: 'snow' }
  if (code >= 95) return { label: 'Thunderstorms', kind: 'storm' }
  return { label: 'Cloudy', kind: 'cloudy' }
}

/** Rounded, with a proper minus sign: "12°", "−3°". */
export function degrees(t: number): string {
  const r = Math.round(t)
  return `${r < 0 ? '−' : ''}${Math.abs(r)}°`
}

/**
 * Words that make an event sound like it's outside. Written as whole words (so "parking" isn't
 * "park"), and "outdoor"/"outside" in a title always counts, e.g. "Lunch (outside)".
 */
const OUTDOOR = [
  'outdoor', 'outdoors', 'outside', 'walk', 'walks', 'walking', 'dog walk', 'hike', 'hiking', 'ramble', 'run', 'running',
  'jog', 'jogging', 'parkrun', 'park', 'picnic', 'bbq', 'barbecue', 'barbeque', 'garden', 'gardening', 'allotment',
  'football', 'footy', 'golf', 'tennis', 'cricket', 'rugby', 'hockey', 'netball', 'cycle', 'cycling', 'bike', 'bike ride',
  'beach', 'seaside', 'camping', 'fishing', 'sailing', 'kayak', 'kayaking', 'paddleboard', 'climbing', 'zoo', 'safari',
  'festival', 'fair', 'funfair', 'market', 'car boot', 'bonfire', 'fireworks', 'match', 'marathon', 'school run',
  'sports day', 'day out', 'farm', 'stroll', 'horse riding', 'skiing', 'sledging'
]
const OUTDOOR_RE = new RegExp(`\\b(?:${OUTDOOR.map((w) => w.replace(/ /g, '\\s+')).join('|')})\\b`, 'i')

export function isOutdoor(title: string): boolean {
  return OUTDOOR_RE.test(title)
}

/** The weather for one event: at its start time if it has one, else the day's high and low. */
export interface EventWeather {
  code: number
  rain: number
  temp?: number
  max?: number
  min?: number
}

export function weatherFor(forecast: Forecast | null, date: string, start?: string): EventWeather | null {
  if (!forecast) return null
  if (start && /^\d{2}:\d{2}$/.test(start)) {
    const hour = forecast.hours.find((h) => h.time === `${date}T${start.slice(0, 2)}:00`)
    if (hour) return { code: hour.code, rain: hour.rain, temp: hour.temp }
  }
  const day = forecast.days.find((d) => d.date === date)
  return day ? { code: day.code, rain: day.rain, max: day.max, min: day.min } : null
}

/** "Light rain, 12°, 60% chance of rain": the words for a tooltip. */
export function weatherSentence(w: EventWeather): string {
  const parts = [describeWeather(w.code).label]
  if (w.temp !== undefined) parts.push(degrees(w.temp))
  else if (w.max !== undefined && w.min !== undefined) parts.push(`${degrees(w.max)} / ${degrees(w.min)}`)
  if (w.rain >= 10) parts.push(`${Math.round(w.rain)}% chance of rain`)
  return parts.join(', ')
}
