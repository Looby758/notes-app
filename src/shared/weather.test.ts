import { describe, expect, it } from 'vitest'
import { degrees, describeWeather, forecastUrl, isOutdoor, parseForecast, weatherFor, weatherSentence } from './weather'

const sample = {
  current: { temperature_2m: 11.6, apparent_temperature: 9.2, weather_code: 61, is_day: 1, wind_speed_10m: 12.4 },
  hourly: {
    time: ['2026-10-28T09:00', '2026-10-28T10:00', '2026-10-29T14:00'],
    temperature_2m: [9.1, 10.4, 13],
    weather_code: [3, 61, 0],
    precipitation_probability: [20, 70, 0]
  },
  daily: {
    time: ['2026-10-28', '2026-10-29'],
    weather_code: [61, 0],
    temperature_2m_max: [13.2, 15.8],
    temperature_2m_min: [6.4, -1.4],
    precipitation_probability_max: [80, 5]
  }
}

describe('weather', () => {
  it('reads an Open-Meteo forecast', () => {
    const f = parseForecast(sample, 1000)!
    expect(f.at).toBe(1000)
    expect(f.current).toEqual({ temp: 11.6, feels: 9.2, code: 61, isDay: true, wind: 12.4 })
    expect(f.days).toEqual([
      { date: '2026-10-28', code: 61, max: 13.2, min: 6.4, rain: 80 },
      { date: '2026-10-29', code: 0, max: 15.8, min: -1.4, rain: 5 }
    ])
    expect(f.hours[1]).toEqual({ time: '2026-10-28T10:00', code: 61, temp: 10.4, rain: 70 })
  })

  it('rejects answers that are not forecasts', () => {
    expect(parseForecast(null)).toBeNull()
    expect(parseForecast({ error: true, reason: 'bad' })).toBeNull()
  })

  it('asks for the right things', () => {
    const url = forecastUrl({ name: 'Leeds', lat: 53.79648, lon: -1.54785 })
    expect(url).toContain('latitude=53.7965&longitude=-1.5478')
    expect(url).toContain('timezone=auto')
    expect(url).toContain('forecast_days=14')
    expect(url).toContain('wind_speed_unit=mph')
  })

  it('finds the forecast for an event: by the hour, else the whole day', () => {
    const f = parseForecast(sample)!
    expect(weatherFor(f, '2026-10-28', '10:30')).toEqual({ code: 61, rain: 70, temp: 10.4 })
    expect(weatherFor(f, '2026-10-29')).toEqual({ code: 0, rain: 5, max: 15.8, min: -1.4 })
    // An hour the forecast doesn't cover falls back to the day.
    expect(weatherFor(f, '2026-10-29', '20:00')).toEqual({ code: 0, rain: 5, max: 15.8, min: -1.4 })
    expect(weatherFor(f, '2026-11-30')).toBeNull()
    expect(weatherFor(null, '2026-10-28')).toBeNull()
  })

  it('tells outdoor events from indoor ones', () => {
    for (const t of ['Dog walk', 'Football with Sam', 'BBQ at mum’s', 'Parkrun', 'Lunch (outside)', 'Picnic in the park', 'Golf']) {
      expect(isOutdoor(t), t).toBe(true)
    }
    for (const t of ['Dentist', 'Parking permit renewal', 'Team meeting', 'Walkthrough of slides', 'Call the bank']) {
      expect(isOutdoor(t), t).toBe(false)
    }
  })

  it('describes the weather in words', () => {
    expect(describeWeather(0)).toEqual({ label: 'Clear', kind: 'clear' })
    expect(describeWeather(63).kind).toBe('rain')
    expect(describeWeather(95).kind).toBe('storm')
    expect(degrees(-1.4)).toBe('−1°')
    expect(degrees(12.6)).toBe('13°')
    expect(weatherSentence({ code: 61, rain: 70, temp: 10.4 })).toBe('Light rain, 10°, 70% chance of rain')
    expect(weatherSentence({ code: 0, rain: 5, max: 15.8, min: -1.4 })).toBe('Clear, 16° / −1°')
  })
})
