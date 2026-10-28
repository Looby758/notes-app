import { useEffect, useState } from 'react'
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, MapPin, Moon, Sun, Umbrella, Wind } from 'lucide-react'
import type { Place } from '@shared/places'
import { degrees, describeWeather, isOutdoor, weatherFor, weatherSentence, type WeatherKind } from '@shared/weather'
import { usePrefs } from '../../store/prefs'
import { retryWeather, setWeatherPlace, useForecast } from '../../store/weather'
import { dayKey, formatDate, fromDayKey } from '../../lib/dates'
import { HomeBox } from '../Home/HomePage'

export function WeatherIcon({ code, size = 14, night = false }: { code: number; size?: number; night?: boolean }) {
  const kind: WeatherKind = describeWeather(code).kind
  const props = { size, className: `weather-icon weather-${kind}`, 'aria-hidden': true }
  switch (kind) {
    case 'clear':
      return night ? <Moon {...props} /> : <Sun {...props} />
    case 'partly':
      return night ? <CloudMoon {...props} /> : <CloudSun {...props} />
    case 'fog':
      return <CloudFog {...props} />
    case 'drizzle':
      return <CloudDrizzle {...props} />
    case 'rain':
      return <CloudRain {...props} />
    case 'snow':
      return <CloudSnow {...props} />
    case 'storm':
      return <CloudLightning {...props} />
    default:
      return <Cloud {...props} />
  }
}

/** Finding your town: OpenStreetMap's search, as typing pauses. */
function TownSearch({ onDone }: { onDone?: () => void }) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Place[]>([])
  const [error, setError] = useState('')
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    const q = query.trim()
    setError('')
    if (q.length < 2) {
      setFound([])
      setSearching(false)
      return
    }
    let stale = false
    setSearching(true)
    const timer = setTimeout(() => {
      window.api
        .searchPlaces(q)
        .then((res) => {
          if (stale) return
          setFound(res.places.slice(0, 5))
          setError(res.error ?? (res.places.length ? '' : 'No towns found with that name.'))
        })
        .finally(() => !stale && setSearching(false))
    }, 600)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query])
  return (
    <div className="weather-search">
      <input
        className="text-input"
        // Only when you've asked to change town: on first sight the Home page shouldn't grab the keyboard.
        autoFocus={!!onDone}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onDone?.()}
        placeholder="Your town or postcode, e.g. Leeds"
        aria-label="Your town"
      />
      {searching && <p className="home-empty">Searching…</p>}
      {!searching && error && <p className="home-empty">{error}</p>}
      {found.map((p, i) => (
        <button
          key={`${i}:${p.lat},${p.lon}`}
          className="home-row"
          onClick={() => {
            onDone?.()
            void setWeatherPlace({ name: p.name, lat: p.lat, lon: p.lon })
          }}
        >
          <span className="home-row-icon">
            <MapPin size={13} />
          </span>
          <span className="home-row-title">{p.name}</span>
          <span className="home-row-folder weather-search-address">{p.address}</span>
        </button>
      ))}
      {onDone && (
        <button className="link-button weather-cancel" onClick={onDone}>
          Cancel
        </button>
      )}
    </div>
  )
}

const WEEK = 7

/** The Home page's weather: now, today's high and low, and the week ahead. */
export function WeatherHomeBox() {
  const on = usePrefs((s) => s.prefs.weatherHome)
  const { place, forecast, error, loaded } = useForecast(on)
  const [changing, setChanging] = useState(false)
  if (!on || !loaded) return null
  const title = place ? `Weather in ${place.name}` : 'Weather'
  const action = place && !changing && (
    <button className="link-button home-box-action" onClick={() => setChanging(true)}>
      Change town
    </button>
  )
  if (!place || changing) {
    return (
      <HomeBox icon={<Sun size={15} />} title={title}>
        {!place && <p className="home-empty">Type your town to see today’s weather and the week ahead.</p>}
        <TownSearch onDone={place ? () => setChanging(false) : undefined} />
      </HomeBox>
    )
  }
  if (!forecast) {
    return (
      <HomeBox icon={<Sun size={15} />} title={title} action={action}>
        <p className="home-empty">{error ?? 'Getting the forecast…'}</p>
        {error && (
          <button className="btn home-wide-btn" onClick={() => void retryWeather()}>
            Try again
          </button>
        )}
      </HomeBox>
    )
  }
  const now = forecast.current
  // A saved forecast (when offline) can start on an earlier day.
  const todayKey = dayKey(new Date())
  const week = forecast.days.filter((d) => d.date >= todayKey).slice(0, WEEK)
  const today = week[0]?.date === todayKey ? week[0] : undefined
  return (
    <HomeBox icon={<WeatherIcon code={now.code} size={15} night={!now.isDay} />} title={title} action={action}>
      <div className="weather-now">
        <WeatherIcon code={now.code} size={34} night={!now.isDay} />
        <strong>{degrees(now.temp)}</strong>
        <div className="weather-now-words">
          <span>{describeWeather(now.code).label}</span>
          <span className="weather-faint">
            Feels like {degrees(now.feels)}
            {today && ` · high ${degrees(today.max)}, low ${degrees(today.min)}`}
          </span>
          <span className="weather-faint">
            {today && today.rain >= 10 && (
              <>
                <Umbrella size={11} /> {Math.round(today.rain)}% chance of rain ·{' '}
              </>
            )}
            <Wind size={11} /> {Math.round(now.wind)} mph
          </span>
        </div>
      </div>
      <div className="weather-week">
        {week.map((d) => (
          <div key={d.date} className="weather-day" title={`${formatDate(fromDayKey(d.date)!, 'dddd D MMMM')}: ${weatherSentence(d)}`}>
            <span className="weather-day-name">{d.date === todayKey ? 'Today' : formatDate(fromDayKey(d.date)!, 'ddd')}</span>
            <WeatherIcon code={d.code} size={18} />
            <span className="weather-day-max">{degrees(d.max)}</span>
            <span className="weather-faint">{degrees(d.min)}</span>
            <span className={`weather-chance ${d.rain >= 50 ? 'likely' : ''}`}>{d.rain >= 20 ? `${Math.round(d.rain)}%` : ''}</span>
          </div>
        ))}
      </div>
      {error && <p className="weather-status">{error}</p>}
    </HomeBox>
  )
}

/** The forecast for an outdoor event, shown beside it in the calendar; nothing for indoor ones. */
export function EventWeather({ title, date, start, compact = false }: { title: string; date: string; start?: string; compact?: boolean }) {
  const on = usePrefs((s) => s.prefs.weatherCalendar)
  const outdoor = on && isOutdoor(title)
  const { forecast } = useForecast(outdoor)
  const w = outdoor ? weatherFor(forecast, date, start) : null
  if (!w) return null
  const temp = w.temp ?? w.max!
  return (
    <span className="event-weather" title={`Forecast: ${weatherSentence(w)}`}>
      <WeatherIcon code={w.code} size={compact ? 11 : 12} />
      {!compact && <span>{degrees(temp)}</span>}
      {!compact && w.rain >= 30 && <span className="weather-chance likely">{Math.round(w.rain)}%</span>}
    </span>
  )
}

/** A day's weather in small, for the day headings of the calendar. */
export function DayWeather({ date }: { date: string }) {
  const on = usePrefs((s) => s.prefs.weatherCalendar)
  const { forecast } = useForecast(on)
  const day = on ? forecast?.days.find((d) => d.date === date) : undefined
  if (!day) return null
  return (
    <span className="day-weather" title={`Forecast: ${weatherSentence(day)}`}>
      <WeatherIcon code={day.code} size={11} />
      {degrees(day.max)}
    </span>
  )
}
