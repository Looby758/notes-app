import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, Globe, Music, Pause, Play, Search, X, Youtube } from 'lucide-react'
import type { LocalSong } from '@shared/localMusic'
import { formatTime } from '@shared/spotify'
import { songKey, type FoundTrack } from '@shared/songSearch'
import { errorMessage } from '../../lib/paths'
import { notify } from '../../store/notify'
import { localPause, playLocal } from '../../store/localMusic'
import { useMusic } from '../../store/music'
import ContextMenu, { type MenuItem } from '../ContextMenu'

/**
 * The Music page's Search: any song there is (Apple's free iTunes Search, no account needed), with a
 * 30-second sample, its YouTube video (right-click to copy the link), and a Play button when the
 * song is already in your own music.
 */

// Kept between visits, so going back to Search shows what you'd found.
let lastQuery = ''
let lastResults: FoundTrack[] | null = null

/** Each song's YouTube link, once looked up. */
const videoLinks = new Map<string, { url: string; exact: boolean }>()

async function youtubeLink(t: FoundTrack): Promise<{ url: string; exact: boolean }> {
  const known = videoLinks.get(t.id)
  if (known) return known
  const found = await window.api.songYouTube(t.artist, t.title)
  videoLinks.set(t.id, found)
  return found
}

async function copyYouTube(t: FoundTrack): Promise<void> {
  try {
    const { url, exact } = await youtubeLink(t)
    await navigator.clipboard.writeText(url)
    notify(exact ? `Copied the YouTube link for “${t.title}”.` : `Couldn’t find the exact video, so copied YouTube’s search for “${t.title}”.`, 'info')
  } catch (err) {
    notify(errorMessage(err))
  }
}

async function openYouTube(t: FoundTrack): Promise<void> {
  try {
    window.open((await youtubeLink(t)).url)
  } catch (err) {
    notify(errorMessage(err))
  }
}

let sample: HTMLAudioElement | null = null

export default function MusicSearch({ songs }: { songs: LocalSong[] }) {
  const [query, setQuery] = useState(lastQuery)
  const [results, setResults] = useState<FoundTrack[] | null>(lastResults)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; track: FoundTrack } | null>(null)
  const [sampling, setSampling] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  // Your own songs, to say "In your music" and play yours instead.
  const mine = useMemo(() => new Map(songs.map((s) => [songKey(s.artist, s.title), s])), [songs])

  // Search as you type, once you pause.
  useEffect(() => {
    lastQuery = query
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      lastResults = null
      setError(null)
      return
    }
    let stale = false
    const id = setTimeout(() => {
      setBusy(true)
      window.api.songSearch(q).then(
        (r) => {
          if (stale) return
          setResults(r)
          lastResults = r
          setError(null)
        },
        (err) => !stale && setError(errorMessage(err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      ).finally(() => !stale && setBusy(false))
    }, 400)
    return () => {
      stale = true
      clearTimeout(id)
    }
  }, [query])

  // The sample stops when you leave Search.
  useEffect(() => () => stopSample(), [])
  const stopSample = (): void => {
    sample?.pause()
    sample = null
    setSampling(null)
  }
  const playSample = (t: FoundTrack): void => {
    if (sampling === t.id) return stopSample()
    stopSample()
    if (!t.preview) return
    if (useMusic.getState().state?.playing) localPause()
    sample = new Audio(t.preview)
    sample.volume = 0.8
    sample.addEventListener('ended', () => setSampling(null))
    void sample.play().catch((err) => notify(errorMessage(err)))
    setSampling(t.id)
  }

  const copy = async (t: FoundTrack): Promise<void> => {
    await copyYouTube(t)
    setCopied(t.id)
    setTimeout(() => setCopied((c) => (c === t.id ? null : c)), 1500)
  }

  const menuItems = (t: FoundTrack): MenuItem[] => {
    const own = mine.get(songKey(t.artist, t.title))
    const items: MenuItem[] = [
      { label: 'Copy YouTube link', icon: <Copy size={14} />, onClick: () => void copy(t) },
      { label: 'Open on YouTube', icon: <Youtube size={14} />, onClick: () => void openYouTube(t) },
      { label: 'Copy song name', icon: <Copy size={14} />, onClick: () => void navigator.clipboard.writeText(`${t.artist} – ${t.title}`) }
    ]
    if (t.preview) items.unshift({ label: sampling === t.id ? 'Stop the sample' : 'Play a 30-second sample', icon: <Play size={14} />, onClick: () => playSample(t) })
    if (own) items.unshift({ label: 'Play from your music', icon: <Music size={14} />, onClick: () => void playLocal([own], 0) }, 'separator')
    return items
  }

  return (
    <div className="mp-scroll" data-mp-search>
      <div className="mp-search-top">
        <h1>Search</h1>
        <label className="mp-find mp-search-box">
          <Search size={16} />
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Any song, artist or album" spellCheck={false} data-mp-search-input />
          {query && (
            <button className="icon-btn" onClick={() => setQuery('')} title="Clear">
              <X size={13} />
            </button>
          )}
        </label>
        <p className="mp-search-note">
          <Globe size={12} /> Searches every song (Apple’s free music catalogue). Right-click a song to copy its YouTube link.
        </p>
      </div>
      {error && <p className="mp-empty">{error}</p>}
      {busy && !results && <p className="mp-empty">Searching…</p>}
      {results && results.length === 0 && !busy && <p className="mp-empty">Nothing found.</p>}
      {results && results.length > 0 && (
        <div className="mp-table mp-found">
          {results.map((t, i) => {
            const own = mine.get(songKey(t.artist, t.title))
            return (
              <div
                key={t.id}
                className="mp-tr"
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ x: e.clientX, y: e.clientY, track: t })
                }}
                onDoubleClick={() => (own ? void playLocal([own], 0) : playSample(t))}
                data-mp-found={t.title}
              >
                <span className="mp-num">{sampling === t.id ? <span className="mp-eq" aria-label="Playing"><i /><i /><i /></span> : i + 1}</span>
                <span className="mp-col-title">
                  <span className="mp-row-art">{t.art ? <img src={t.art} alt="" loading="lazy" /> : <Music size={14} />}</span>
                  <span className="mp-row-text">
                    <strong title={t.title}>{t.title}</strong>
                    <span title={t.artist}>{t.artist}</span>
                  </span>
                </span>
                <span className="mp-col-album" title={t.album}>
                  {t.album}
                  {t.year && <em className="mp-year"> · {t.year}</em>}
                </span>
                <span className="mp-found-actions">
                  {own && (
                    <button className="mp-chip" onClick={() => void playLocal([own], 0)} title="It’s in your music: play your copy" data-mp-found-mine>
                      <Check size={11} /> In your music
                    </button>
                  )}
                  {t.preview && (
                    <button className={`icon-btn ${sampling === t.id ? 'mp-on' : ''}`} onClick={() => playSample(t)} title={sampling === t.id ? 'Stop the sample' : 'Play a 30-second sample'}>
                      {sampling === t.id ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                  )}
                  <button className="icon-btn mp-yt" onClick={() => void openYouTube(t)} onContextMenu={(e) => (e.preventDefault(), e.stopPropagation(), void copy(t))} title="Open on YouTube (right-click to copy the link)" data-mp-yt>
                    {copied === t.id ? <Check size={15} /> : <Youtube size={15} />}
                  </button>
                </span>
                <span className="mp-col-time">{t.durationMs ? formatTime(t.durationMs) : ''}</span>
              </div>
            )
          })}
          <p className="mp-search-note mp-search-credit">
            Song details from the iTunes Search API. <ExternalLink size={11} />
          </p>
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.track)} onClose={() => setMenu(null)} />}
    </div>
  )
}
