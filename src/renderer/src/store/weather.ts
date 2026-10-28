import { useEffect } from 'react'
import { create } from 'zustand'
import type { WeatherPlace, WeatherState } from '@shared/weather'

/**
 * Your town's forecast, shared by the Home page and the calendar. The main process does the
 * fetching (and keeps the last forecast for when you're offline); this asks it now and then.
 */
export const useWeather = create<WeatherState & { loaded: boolean }>(() => ({ place: null, forecast: null, loaded: false }))

let asking: Promise<void> | null = null

function refresh(force = false): Promise<void> {
  asking ??= window.api
    .weather(force)
    .then((s) => useWeather.setState({ ...s, error: s.error, loaded: true }))
    .catch(() => useWeather.setState({ loaded: true }))
    .finally(() => (asking = null))
  return asking
}

export async function setWeatherPlace(place: WeatherPlace | null): Promise<void> {
  useWeather.setState({ place, forecast: null, error: undefined })
  const s = await window.api.setWeatherPlace(place)
  useWeather.setState({ ...s, error: s.error, loaded: true })
}

let users = 0
let timer: ReturnType<typeof setInterval> | null = null
const onFocus = (): void => void refresh()

/** Loads the forecast while something on screen shows it, and keeps it up to date. */
export function useForecast(on = true): WeatherState & { loaded: boolean } {
  useEffect(() => {
    if (!on) return
    void refresh()
    if (users++ === 0) {
      // The main process only fetches again once its forecast is half an hour old.
      timer = setInterval(() => void refresh(), 10 * 60_000)
      window.addEventListener('focus', onFocus)
    }
    return () => {
      if (--users === 0) {
        if (timer) clearInterval(timer)
        window.removeEventListener('focus', onFocus)
      }
    }
  }, [on])
  return useWeather()
}

export const retryWeather = (): Promise<void> => refresh(true)
