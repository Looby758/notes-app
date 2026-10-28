import { app, ipcMain, net } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { forecastUrl, parseForecast, type WeatherPlace, type WeatherState } from '@shared/weather'
import { logError } from './log'

/**
 * The forecast for your town, from Open-Meteo (free, no key). Your town and the last forecast are
 * kept in weather.json in the settings folder, so the weather still shows when you're offline.
 */

/** Forecasts change slowly; ask again after this long. */
const FRESH_MS = 30 * 60_000

const file = (): string => join(app.getPath('userData'), 'weather.json')

let state: WeatherState | null = null
let fetching: Promise<WeatherState> | null = null

function load(): WeatherState {
  if (state) return state
  state = { place: null, forecast: null }
  try {
    if (existsSync(file())) {
      const saved = JSON.parse(readFileSync(file(), 'utf8'))
      const p = saved?.place
      if (p && typeof p.name === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
        state.place = { name: p.name, lat: p.lat, lon: p.lon }
        state.forecast = saved.forecast ? parseSaved(saved.forecast) : null
      }
    }
  } catch (err) {
    logError('reading weather.json', err)
  }
  return state
}

/** A forecast we saved ourselves: trust its shape, but not blindly. */
function parseSaved(f: unknown): WeatherState['forecast'] {
  const ok = f && typeof f === 'object' && Array.isArray((f as { days?: unknown }).days) && Array.isArray((f as { hours?: unknown }).hours)
  return ok ? (f as WeatherState['forecast']) : null
}

function save(): void {
  try {
    const tmp = `${file()}.tmp`
    writeFileSync(tmp, JSON.stringify({ place: state?.place ?? null, forecast: state?.forecast ?? null }), 'utf8')
    renameSync(tmp, file())
  } catch (err) {
    logError('saving weather.json', err)
  }
}

async function fetchForecast(place: WeatherPlace): Promise<WeatherState> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 10_000)
  try {
    const res = await net.fetch(forecastUrl(place), {
      signal: abort.signal,
      headers: { 'User-Agent': `${app.getName()}/${app.getVersion()} (desktop notes app)`, Accept: 'application/json' }
    })
    if (!res.ok) throw new Error(`The weather service answered ${res.status}.`)
    const forecast = parseForecast(await res.json())
    if (!forecast) throw new Error('The weather service sent something unexpected.')
    // You may have picked another town while this was on its way.
    if (state?.place !== place) return load()
    state = { place, forecast }
    save()
  } catch (err) {
    logError('weather', err)
    if (state?.place === place) {
      state = { ...state, error: state.forecast ? "Offline: showing the last forecast." : "Couldn't get the weather. Check you're online." }
    }
  } finally {
    clearTimeout(timer)
  }
  return load()
}

/** The weather now, fetching a new forecast first if the saved one is old (or `force`). */
function get(force: boolean): Promise<WeatherState> {
  const s = load()
  if (!s.place) return Promise.resolve(s)
  if (!force && s.forecast && Date.now() - s.forecast.at < FRESH_MS) return Promise.resolve(s)
  fetching ??= fetchForecast(s.place).finally(() => (fetching = null))
  return fetching
}

export function setupWeather(): void {
  ipcMain.handle('weather:get', (_e, force?: boolean) => get(force === true))
  ipcMain.handle('weather:setPlace', (_e, place: WeatherPlace | null) => {
    load()
    const valid = place && typeof place.name === 'string' && Number.isFinite(place.lat) && Number.isFinite(place.lon)
    state = { place: valid ? { name: place.name.slice(0, 120), lat: place.lat, lon: place.lon } : null, forecast: null }
    save()
    fetching = null
    return get(true)
  })
}
