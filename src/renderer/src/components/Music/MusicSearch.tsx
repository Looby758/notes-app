import { useEffect, useRef, useState } from 'react'
import { Globe, Search, X } from 'lucide-react'
import type { LocalSong } from '@shared/localMusic'
import type { FoundTrack } from '@shared/songSearch'
import { errorMessage } from '../../lib/paths'
import { FoundTable } from './FoundSongs'

/**
 * The Music page's Search: any song there is (Deezer's and Apple's free search, no account needed), with a
 * 30-second sample, its YouTube video (right-click to copy the link), and a Play button when the
 * song is already in your own music.
 */

// Kept between visits, so going back to Search shows what you'd found.
let lastQuery = ''
let lastResults: FoundTrack[] | null = null

export default function MusicSearch({ songs }: { songs: LocalSong[] }) {
  const [query, setQuery] = useState(lastQuery)
  const [results, setResults] = useState<FoundTrack[] | null>(lastResults)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

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
          <Globe size={12} /> Searches every song (Deezer’s and Apple’s free music catalogues). Click YouTube to watch a song’s video, or right-click it to copy the link.
        </p>
      </div>
      {error && <p className="mp-empty">{error}</p>}
      {busy && !results && <p className="mp-empty">Searching…</p>}
      {results && results.length === 0 && !busy && <p className="mp-empty">Nothing found.</p>}
      {results && results.length > 0 && <FoundTable tracks={results} songs={songs} credit />}
    </div>
  )
}
