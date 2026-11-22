import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { Check, Download, ExternalLink, FileUp, Heart, ListPlus, Loader2, Music, Play, Square } from 'lucide-react'
import { formatTime } from '@shared/spotify'
import { LIKED_SONGS_URI } from '@shared/spotify'
import { cleanTitle, findInLibrary, parseSongList, titleIndex, type SpotifyList, type SpotifyTrack } from '@shared/spotifyImport'
import type { LocalSong } from '@shared/localMusic'
import { errorMessage } from '../../lib/paths'
import { playLocal } from '../../store/localMusic'
import { refreshMusicStatus, useMusic } from '../../store/music'
import { createPlaylist } from '../../store/musicData'
import { onMusicLinkDone, saveMp3, useMusicLinks } from '../../store/musicLink'
import { notify } from '../../store/notify'

/**
 * From Spotify: a Spotify playlist, album or your Liked Songs checked against your own music, with
 * the songs you're missing ready to save as MP3s (one at a time, or all of them).
 */

const KEY = 'orbit.musicFromSpotify'

function savedList(): SpotifyList | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return v && Array.isArray(v.tracks) ? (v as SpotifyList) : null
  } catch {
    return null
  }
}
function keep(list: SpotifyList | null): void {
  try {
    if (list) localStorage.setItem(KEY, JSON.stringify(list))
    else localStorage.removeItem(KEY)
  } catch {
    // Only a convenience.
  }
}

const clean = (err: unknown): string => errorMessage(err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Which save each song started (by the song's place in the list), kept while you look at other pages. */
const started = new Map<string, string>()
const trackKey = (t: SpotifyTrack): string => `${t.artists.join(',')}|${t.title}`
let stopAll = false
let savingAll = false

async function saveTrack(t: SpotifyTrack): Promise<string | null> {
  const title = cleanTitle(t.title)
  const { url, exact } = await window.api.songYouTube(t.artists[0] ?? '', title)
  if (!exact) {
    notify(`Couldn’t find a video for “${title}”. Try Search on the Music page.`)
    return null
  }
  const id = await saveMp3(url, { id: '', title, artist: t.artists.join(', '), album: '', year: '', genre: '', durationMs: t.durationMs })
  if (id) started.set(trackKey(t), id)
  return id
}

/** Waits for one save to finish. */
const finished = (id: string): Promise<void> =>
  new Promise((resolve) => {
    const off = onMusicLinkDone((p) => {
      if (p.id !== id) return
      off()
      resolve()
    })
    // A save that already ended (or was stopped) doesn't hold the rest up.
    const job = useMusicLinks.getState().jobs.find((j) => j.id === id)
    if (job && job.stage !== 'downloading' && job.stage !== 'details') {
      off()
      resolve()
    }
  })

export default function FromSpotify({ songs, setPlaylistView }: { songs: LocalSong[]; setPlaylistView: (id: string) => void }) {
  const [list, setListState] = useState<SpotifyList | null>(savedList)
  const [link, setLink] = useState('')
  const [pasted, setPasted] = useState('')
  const [showPaste, setShowPaste] = useState(false)
  const [showLikedHelp, setShowLikedHelp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'missing' | 'all' | 'have'>('missing')
  const [dropping, setDropping] = useState(false)
  const [, rerender] = useState(0)
  const jobs = useMusicLinks((s) => s.jobs)
  const status = useMusic((s) => s.status)
  useEffect(() => {
    if (!useMusic.getState().status) void refreshMusicStatus().catch(() => undefined)
  }, [])
  const setList = (l: SpotifyList | null): void => {
    setListState(l)
    keep(l)
    setFilter('missing')
    setError(null)
    setShowLikedHelp(false)
  }

  const index = useMemo(() => titleIndex(songs), [songs])
  const rows = useMemo(() => (list?.tracks ?? []).map((t, i) => ({ t, i, mine: findInLibrary(t, songs, index) })), [list, songs, index])
  const missing = rows.filter((r) => !r.mine)
  const have = rows.filter((r) => r.mine)
  const shown = filter === 'missing' ? missing : filter === 'have' ? have : rows

  const fromLink = async (): Promise<void> => {
    if (!link.trim()) return
    setBusy(true)
    setError(null)
    try {
      setList(await window.api.spotifyList(link))
      setLink('')
    } catch (err) {
      setError(clean(err))
    } finally {
      setBusy(false)
    }
  }
  const fromLiked = async (): Promise<void> => {
    if (!status?.connected) return setShowLikedHelp(!showLikedHelp)
    setBusy(true)
    setError(null)
    try {
      const items = await window.api.musicPlaylistSongs(LIKED_SONGS_URI)
      setList({ name: 'Liked Songs (Spotify)', tracks: items.map((it) => ({ title: it.name, artists: it.detail.split(/\s*,\s*/).filter(Boolean), durationMs: 0 })) })
    } catch (err) {
      setError(clean(err))
    } finally {
      setBusy(false)
    }
  }
  const fromText = (text: string, name?: string): void => {
    const l = parseSongList(text, name)
    if (!l.tracks.length) return setError('No songs found in that. Paste one song a line as “Artist - Title”, or a CSV from Exportify.')
    setList(l)
    setPasted('')
    setShowPaste(false)
  }
  const onDrop = async (e: DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setDropping(false)
    const file = [...e.dataTransfer.files].find((f) => /\.(csv|txt)$/i.test(f.name))
    if (file) fromText(await file.text(), file.name.replace(/\.(csv|txt)$/i, '').replace(/_/g, ' '))
    else if (e.dataTransfer.getData('text/plain')) {
      const text = e.dataTransfer.getData('text/plain')
      if (/open\.spotify\.com/.test(text)) {
        setLink(text)
      } else fromText(text)
    }
  }

  const saveOne = async (t: SpotifyTrack): Promise<void> => {
    try {
      await saveTrack(t)
      rerender((n) => n + 1)
    } catch (err) {
      notify(clean(err))
    }
  }
  const saveAll = async (): Promise<void> => {
    if (savingAll) {
      stopAll = true
      return
    }
    savingAll = true
    stopAll = false
    rerender((n) => n + 1)
    // One at a time, so the computer and YouTube aren't swamped.
    for (const r of missing) {
      if (stopAll) break
      const already = started.get(trackKey(r.t))
      const job = already ? useMusicLinks.getState().jobs.find((j) => j.id === already) : undefined
      if (job && job.stage !== 'error' && job.stage !== 'cancelled') continue
      try {
        const id = await saveTrack(r.t)
        rerender((n) => n + 1)
        if (id) await finished(id)
      } catch (err) {
        notify(clean(err))
      }
    }
    savingAll = false
    rerender((n) => n + 1)
  }
  const makePlaylist = async (): Promise<void> => {
    if (!list || !have.length) return
    const id = await createPlaylist(list.name, have.map((r) => r.mine!))
    if (id) setPlaylistView(id)
  }

  const jobFor = (t: SpotifyTrack) => {
    const id = started.get(trackKey(t))
    return id ? jobs.find((j) => j.id === id) : undefined
  }

  return (
    <div
      className={`mp-scroll mp-spotify ${dropping ? 'drop' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropping(false)}
      onDrop={(e) => void onDrop(e)}
      data-mp-spotify
    >
      <div className="mp-search-top">
        <h1>From Spotify</h1>
        <p className="mp-search-note">See which songs from a Spotify playlist you have, and save the rest as MP3s.</p>
        <form
          className="mp-spotify-link"
          onSubmit={(e) => {
            e.preventDefault()
            void fromLink()
          }}
        >
          <label className="mp-find mp-search-box">
            <ExternalLink size={15} />
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a Spotify playlist or album link" spellCheck={false} data-mp-spotify-link />
          </label>
          <button className="btn btn-primary" disabled={busy || !link.trim()} data-mp-spotify-check>
            {busy ? <Loader2 size={13} className="spin" /> : null} Check
          </button>
        </form>
        <div className="mp-spotify-more">
          <button className="btn" onClick={() => void fromLiked()} disabled={busy} data-mp-spotify-liked>
            <Heart size={13} /> My Liked Songs
          </button>
          <button className="btn" onClick={() => setShowPaste(!showPaste)} data-mp-spotify-paste>
            <FileUp size={13} /> Paste or drop a list
          </button>
        </div>
        {showLikedHelp && (
          <div className="mp-spotify-help" data-mp-liked-help>
            <p>
              <strong>Liked Songs is private</strong>, so it has no link Orbit can read. The easy way:
            </p>
            <ol>
              <li>
                Open{' '}
                <button className="link-btn" onClick={() => window.open('https://exportify.app/')}>
                  exportify.app <ExternalLink size={11} />
                </button>{' '}
                (free) and sign in with Spotify.
              </li>
              <li>
                Press <strong>Export</strong> next to <strong>Liked Songs</strong>. It saves a CSV file.
              </li>
              <li>Drop that file anywhere on this page.</li>
            </ol>
            <p className="mp-nav-note">Exportify does every playlist this way too, including ones over 100 songs.</p>
          </div>
        )}
        {showPaste && (
          <div className="mp-spotify-help">
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={'One song a line, like:\nThe Killers - Mr. Brightside\nSeether - Broken\n\nor paste a CSV from Exportify.'} rows={6} data-mp-spotify-text />
            <button className="btn btn-primary" disabled={!pasted.trim()} onClick={() => fromText(pasted)}>
              Check these songs
            </button>
          </div>
        )}
        {error && <p className="setting-warning">{error}</p>}
      </div>

      {list && (
        <>
          <header className="mp-header mp-spotify-head">
            <div className="mp-header-art">{list.art ? <img src={list.art} alt="" /> : <Music size={42} />}</div>
            <div className="mp-header-text">
              <span className="mp-kicker">From Spotify</span>
              <h1>{list.name}</h1>
              <span className="mp-header-sub" data-mp-spotify-count>
                You have {have.length} of {rows.length} {rows.length === 1 ? 'song' : 'songs'}
                {missing.length ? ` · ${missing.length} missing` : ' · all of them'}
              </span>
              {list.capped && <span className="mp-nav-note">Spotify only shows the first 100 songs of a link. For the rest, use Exportify (My Liked Songs shows how).</span>}
            </div>
          </header>
          <div className="mp-actions">
            <div className="mp-play-buttons">
              {missing.length > 0 && (
                <button className="btn btn-primary" onClick={() => void saveAll()} data-mp-save-all>
                  {savingAll ? <Square size={13} /> : <Download size={13} />} {savingAll ? 'Stop saving' : `Save all ${missing.length} missing`}
                </button>
              )}
              {have.length > 0 && (
                <button className="btn" onClick={() => void makePlaylist()} title="A playlist of your own with the songs you have, in this order" data-mp-make-playlist>
                  <ListPlus size={13} /> Make it a playlist ({have.length})
                </button>
              )}
            </div>
            <div className="mp-tabs">
              {(['missing', 'all', 'have'] as const).map((f) => (
                <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)} data-mp-spotify-filter={f}>
                  {f === 'missing' ? `Missing (${missing.length})` : f === 'have' ? `Have (${have.length})` : `All (${rows.length})`}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 && <p className="mp-empty">{filter === 'missing' ? 'You have every song on this list.' : 'None of these are in your music yet.'}</p>}
          <div className="mp-table mp-found mp-spotify-table">
            {shown.map(({ t, i, mine }) => {
              const job = jobFor(t)
              return (
                <div key={`${i}:${t.title}`} className={`mp-tr ${mine ? '' : 'mp-missing-row'}`} onDoubleClick={() => mine && void playLocal([mine], 0)} data-mp-spotify-row={t.title}>
                  <span className="mp-num">{i + 1}</span>
                  <span className="mp-col-title">
                    <span className="mp-row-text">
                      <strong title={t.title}>{t.title}</strong>
                      <span title={t.artists.join(', ')}>{t.artists.join(', ') || 'Unknown artist'}</span>
                    </span>
                  </span>
                  <span className="mp-col-album">{mine ? <span className="mp-spotify-yours" title={mine.path}>{mine.path}</span> : ''}</span>
                  <span className="mp-found-actions">
                    {mine ? (
                      <button className="mp-chip" onClick={() => void playLocal([mine], 0)} title="Play your copy" data-mp-spotify-have>
                        <Check size={11} /> In your music <Play size={10} fill="currentColor" />
                      </button>
                    ) : job && (job.stage === 'downloading' || job.stage === 'details') ? (
                      <span className="mp-spotify-saving">
                        <Loader2 size={12} className="spin" /> {job.stage === 'details' ? 'Finishing…' : typeof job.done === 'number' ? `${Math.round(job.done * 100)}%` : 'Starting…'}
                      </span>
                    ) : (
                      <button className="btn mp-spotify-save" onClick={() => void saveOne(t)} title={job?.stage === 'error' ? job.error : 'Find it on YouTube and save it as an MP3 in your music'} data-mp-spotify-save>
                        <Download size={12} /> {job?.stage === 'error' ? 'Try again' : 'Save MP3'}
                      </button>
                    )}
                  </span>
                  <span className="mp-col-time">{t.durationMs ? formatTime(t.durationMs) : ''}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
      {!list && !showLikedHelp && !showPaste && (
        <p className="mp-empty">
          In Spotify, right-click a playlist → Share → Copy link to playlist, then paste it above. Lists of songs (or CSV files) can be dropped here too.
        </p>
      )}
    </div>
  )
}
