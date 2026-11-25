import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Download, ExternalLink, Music, Pause, Play, Youtube } from 'lucide-react'
import type { LocalSong } from '@shared/localMusic'
import { formatTime } from '@shared/spotify'
import { songKey, type FoundTrack } from '@shared/songSearch'
import { errorMessage } from '../../lib/paths'
import { notify } from '../../store/notify'
import { localPause, playLocal } from '../../store/localMusic'
import { useMusic } from '../../store/music'
import ContextMenu, { type MenuItem } from '../ContextMenu'
import { saveMp3 } from '../../store/musicLink'

/**
 * Songs from the music catalogues (Search, and new songs in Recommended): a 30-second sample, the
 * song's YouTube video (right-click to copy the link), Save MP3 to my music, and a Play button when
 * the song is already in your own music.
 */

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
    const { url, exact } = await youtubeLink(t)
    if (!exact) notify(`Couldn’t find the exact video, so opened YouTube’s search for “${t.title}”.`, 'info')
    window.open(url)
  } catch (err) {
    notify(errorMessage(err))
  }
}

let sample: HTMLAudioElement | null = null


export function FoundTable({ tracks, songs, notes, credit }: { tracks: FoundTrack[]; songs: LocalSong[]; notes?: Map<string, string>; credit?: boolean }) {
  const [menu, setMenu] = useState<{ x: number; y: number; track: FoundTrack } | null>(null)
  const [sampling, setSampling] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [looking, setLooking] = useState<string | null>(null)
  // Your own songs, to say "In your music" and play yours instead.
  const mine = useMemo(() => new Map(songs.map((s) => [songKey(s.artist, s.title), s])), [songs])

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
    const mine = sample
    sample.addEventListener('ended', () => setSampling(null))
    void sample.play().catch((err) => {
      if (sample !== mine) return
      stopSample()
      notify(err instanceof DOMException && err.name === 'AbortError' ? 'The sample stopped.' : 'That sample wouldn’t play. Try another song.')
    })
    setSampling(t.id)
  }

  // Finding the video takes a moment the first time, so the button says so meanwhile.
  const withLookup = async (t: FoundTrack, job: () => Promise<void>): Promise<void> => {
    if (!videoLinks.has(t.id)) setLooking(t.id)
    try {
      await job()
    } finally {
      setLooking((l) => (l === t.id ? null : l))
    }
  }
  const copy = async (t: FoundTrack): Promise<void> => {
    await withLookup(t, () => copyYouTube(t))
    setCopied(t.id)
    setTimeout(() => setCopied((c) => (c === t.id ? null : c)), 1500)
  }
  const open = (t: FoundTrack): Promise<void> => withLookup(t, () => openYouTube(t))
  // Looked up as soon as you point at the button, so a click opens it straight away.
  const prefetch = (t: FoundTrack): void => void youtubeLink(t).catch(() => undefined)

  const menuItems = (t: FoundTrack): MenuItem[] => {
    const own = mine.get(songKey(t.artist, t.title))
    const items: MenuItem[] = [
      { label: 'Copy YouTube link', icon: <Copy size={14} />, onClick: () => void copy(t) },
      { label: 'Open on YouTube', icon: <Youtube size={14} />, onClick: () => void open(t) },
      {
        label: 'Save MP3 to my music',
        icon: <Download size={14} />,
        onClick: () =>
          void withLookup(t, async () => {
            const { url, exact } = await youtubeLink(t)
            if (!exact) return notify(`Couldn’t find the video for “${t.title}”, so it can’t be saved.`)
            notify(`Saving “${t.title}” to your music…`, 'info')
            await saveMp3(url, t)
          })
      },
      { label: 'Copy song name', icon: <Copy size={14} />, onClick: () => void navigator.clipboard.writeText(`${t.artist} – ${t.title}`) }
    ]
    if (t.preview) items.unshift({ label: sampling === t.id ? 'Stop the sample' : 'Play a 30-second sample', icon: <Play size={14} />, onClick: () => playSample(t) })
    if (own) items.unshift({ label: 'Play from your music', icon: <Music size={14} />, onClick: () => void playLocal([own], 0) }, 'separator')
    return items
  }

  return (
    <>
        <div className="mp-table mp-found">
          {tracks.map((t, i) => {
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
                    {notes?.get(t.id) && <em className="mp-row-note">{notes.get(t.id)}</em>}
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
                  <button
                    className={`icon-btn mp-yt ${looking === t.id ? 'busy' : ''}`}
                    onClick={() => void open(t)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      void copy(t)
                    }}
                    onMouseEnter={() => prefetch(t)}
                    title="Click to open the video on YouTube. Right-click to copy its link."
                    data-mp-yt
                  >
                    {copied === t.id ? <Check size={14} /> : <Youtube size={14} />}
                    <span className="mp-yt-label">{copied === t.id ? 'Copied' : looking === t.id ? 'Finding…' : 'YouTube'}</span>
                  </button>
                </span>
                <span className="mp-col-time">{t.durationMs ? formatTime(t.durationMs) : ''}</span>
              </div>
            )
          })}
          {credit && <p className="mp-search-note mp-search-credit">
            Song details from the iTunes Search API. <ExternalLink size={11} />
          </p>}
        </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.track)} onClose={() => setMenu(null)} />}
    </>
  )
}
