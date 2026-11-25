import { useMemo, useState } from 'react'
import { BarChart3, ChevronLeft, ChevronRight, Music, Play } from 'lucide-react'
import type { LocalSong } from '@shared/localMusic'
import { localArtUrl } from '@shared/localMusic'
import { listenedFor, listeningStats, type StatsPeriod } from '@shared/musicStats'
import { useMusicData } from '../../store/musicData'
import { usePrefs } from '../../store/prefs'
import { playLocal } from '../../store/localMusic'

const PERIODS: { id: StatsPeriod; label: string }[] = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
  { id: 'all', label: 'All time' }
]

/**
 * The Music page's Listening stats: plays and time listened for a week, month or year (step back
 * with the arrows) or all time, a chart of when, and your top songs, artists and albums. Plays on
 * the phone app and your other computer count too (they're all in orbit-music.json).
 */
export default function ListeningStats({ songs, openArtist, openAlbum }: { songs: LocalSong[]; openArtist: (name: string) => void; openAlbum: (key: string) => void }) {
  const data = useMusicData((s) => s.data)
  const weekStart = usePrefs((s) => s.prefs.weekStart)
  const [period, setPeriod] = useState<StatsPeriod>('month')
  const [offset, setOffset] = useState(0)
  const stats = useMemo(() => listeningStats(data, songs, period, offset, Date.now(), weekStart), [data, songs, period, offset, weekStart])
  const max = Math.max(1, ...stats.chart.map((b) => b.plays))
  const [hover, setHover] = useState<number | null>(null)
  const playable = stats.topSongs.filter((s) => s.song).map((s) => s.song!)

  return (
    <div className="mp-view mp-stats" data-mp-stats>
      <header className="mp-stats-head">
        <div>
          <span className="mp-kicker">Your listening</span>
          <h1>Listening stats</h1>
        </div>
        <div className="mp-stats-periods" role="tablist">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={period === p.id}
              className={period === p.id ? 'on' : ''}
              onClick={() => {
                setPeriod(p.id)
                setOffset(0)
              }}
              data-stats-period={p.id}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {period !== 'all' && (
        <div className="mp-stats-step">
          <button className="icon-btn" onClick={() => setOffset(offset + 1)} disabled={!stats.hasEarlier} title="Before this" data-stats-back>
            <ChevronLeft size={16} />
          </button>
          <strong data-stats-label>{stats.range.label}</strong>
          <button className="icon-btn" onClick={() => setOffset(Math.max(0, offset - 1))} disabled={offset === 0} title="After this" data-stats-forward>
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      <div className="mp-stats-tiles">
        <Tile label="Plays" value={stats.plays.toLocaleString()} />
        <Tile label="Time listened" value={listenedFor(stats.ms)} />
        <Tile label="Songs" value={stats.songs.toLocaleString()} />
        <Tile label="Artists" value={stats.artists.toLocaleString()} />
      </div>

      {stats.plays === 0 ? (
        <div className="mp-stats-empty">
          <BarChart3 size={36} />
          <p>No plays {period === 'all' ? 'yet' : `in ${stats.range.label.toLowerCase().startsWith('this') ? stats.range.label.toLowerCase() : stats.range.label}`}. A song counts after 30 seconds, on any of your devices.</p>
        </div>
      ) : (
        <>
          {stats.chart.length > 1 && (
            <section className="mp-stats-chart-wrap">
              <h3>Plays by {period === 'week' || period === 'month' ? 'day' : period === 'year' ? 'month' : 'year'}</h3>
              <div className="mp-stats-chart" onMouseLeave={() => setHover(null)} data-stats-chart>
                {stats.chart.map((b, i) => (
                  <div key={i} className={`mp-stats-col ${hover === i ? 'hover' : ''}`} onMouseEnter={() => setHover(i)} title={`${b.label}: ${b.plays} ${b.plays === 1 ? 'play' : 'plays'}`}>
                    {hover === i && <span className="mp-stats-tip">{b.plays.toLocaleString()} {b.plays === 1 ? 'play' : 'plays'}</span>}
                    <div className="mp-stats-bar" style={{ height: `${(b.plays / max) * 100}%` }} />
                    <span className="mp-stats-x">{stats.chart.length > 16 && i % 5 !== 0 && i !== stats.chart.length - 1 ? '' : b.label}</span>
                  </div>
                ))}
              </div>
              {stats.chartPartial && <p className="mp-nav-note">The chart only has days from your latest 2,000 plays; the totals above count everything.</p>}
            </section>
          )}

          <div className="mp-stats-lists">
            <section>
              <div className="mp-stats-list-head">
                <h3>Top songs</h3>
                {playable.length > 0 && (
                  <button className="link-btn" onClick={() => void playLocal(playable, 0)} data-stats-play-top>
                    <Play size={12} /> Play them
                  </button>
                )}
              </div>
              <ol className="mp-stats-list">
                {stats.topSongs.slice(0, 15).map((s, i) => (
                  <li key={s.path} onDoubleClick={() => s.song && void playLocal(playable, Math.max(0, playable.indexOf(s.song)))} title={s.song ? 'Double-click to play' : 'No longer in your music'}>
                    <span className="mp-stats-rank">{i + 1}</span>
                    <span className="mp-row-art">{s.song?.art ? <img src={localArtUrl(s.path, s.song.added)} alt="" loading="lazy" /> : <Music size={13} />}</span>
                    <span className="mp-row-text">
                      <strong>{s.title}</strong>
                      <span>{s.artist || 'Unknown artist'}</span>
                    </span>
                    <em>{s.plays}×</em>
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h3>Top artists</h3>
              <ol className="mp-stats-list">
                {stats.topArtists.slice(0, 10).map((a, i) => (
                  <li key={a.name} onClick={() => openArtist(a.name)} className="link" title={`${listenedFor(a.ms)} listened`}>
                    <span className="mp-stats-rank">{i + 1}</span>
                    <span className="mp-row-art round">{a.art ? <img src={localArtUrl(a.art)} alt="" loading="lazy" /> : <Music size={13} />}</span>
                    <span className="mp-row-text">
                      <strong>{a.name}</strong>
                      <span>{listenedFor(a.ms)}</span>
                    </span>
                    <em>{a.plays}×</em>
                  </li>
                ))}
              </ol>
              {stats.topAlbums.length > 0 && <h3>Top albums</h3>}
              <ol className="mp-stats-list">
                {stats.topAlbums.slice(0, 5).map((a, i) => (
                  <li key={`${a.name}/${a.sub}`} onClick={() => openAlbum(`${a.name.toLowerCase()}\u0000${(a.sub ?? '').toLowerCase()}`)} className="link">
                    <span className="mp-stats-rank">{i + 1}</span>
                    <span className="mp-row-art">{a.art ? <img src={localArtUrl(a.art)} alt="" loading="lazy" /> : <Music size={13} />}</span>
                    <span className="mp-row-text">
                      <strong>{a.name}</strong>
                      <span>{a.sub || 'Unknown artist'}</span>
                    </span>
                    <em>{a.plays}×</em>
                  </li>
                ))}
              </ol>
            </section>
          </div>
          <p className="mp-nav-note">Time listened is worked out from the songs’ lengths. Plays from the phone app and your other computer are included.</p>
        </>
      )}
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="mp-stats-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
