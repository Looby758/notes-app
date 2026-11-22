import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { create } from 'zustand'
import { Check, Copy, FileText, Globe, ImagePlus, Music, Plus, Search, Tag, Wand2 } from 'lucide-react'
import { canTag, duplicateGroups, filterSongs, guessFromName, localArtUrl, tidyMoves, type LocalSong, type SongTagPatch, type TidyLayout } from '@shared/localMusic'
import { formatTime } from '@shared/spotify'
import { allTags, cleanTag } from '@shared/musicLibrary'
import { useLocalMusic } from '../../store/localMusic'
import { tagSongs, useMusicData } from '../../store/musicData'
import { editSongs, fillFromNames, keepOne, moveSongs, relink, setCover } from '../../store/musicFiles'
import { notify } from '../../store/notify'

/**
 * The Music page's tools for your files (plan part 3): editing details and covers, tags, tidying
 * file names, spare copies and missing songs.
 */

type Dialog = { kind: 'edit'; songs: LocalSong[] } | { kind: 'tidy' } | { kind: 'relink'; path: string } | null

export const useMusicDialog = create<{ dialog: Dialog }>(() => ({ dialog: null }))
export const openMusicDialog = (dialog: Dialog): void => useMusicDialog.setState({ dialog })
const close = (): void => useMusicDialog.setState({ dialog: null })

export function MusicDialogs() {
  const dialog = useMusicDialog((s) => s.dialog)
  if (!dialog) return null
  if (dialog.kind === 'edit') return <EditDetails songs={dialog.songs} />
  if (dialog.kind === 'tidy') return <TidyFiles />
  return <FindMissing path={dialog.path} />
}

function Modal({ title, wide, children, label }: { title: React.ReactNode; wide?: boolean; children: React.ReactNode; label: string }) {
  return (
    <div className="modal-backdrop mp-modal-backdrop" onMouseDown={close}>
      <div
        className={`modal mp-modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') close()
        }}
        data-mp-dialog={label}
      >
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

/** The picture being dropped, as a file on disk or a link from a web page. */
export function droppedPicture(e: DragEvent): { file?: string; url?: string } | null {
  const file = [...e.dataTransfer.files].find((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name))
  if (file) {
    const path = window.api.pathForFile(file)
    if (path) return { file: path }
  }
  const url = e.dataTransfer.getData('text/uri-list').split('\n').find((l) => /^https:\/\//i.test(l.trim()))
  return url ? { url: url.trim() } : null
}

export const hasPicture = (e: DragEvent): boolean => e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/uri-list')

// ---------- Edit details (one song or many) ----------

const FIELDS: { key: keyof SongTagPatch; label: string; one?: boolean }[] = [
  { key: 'title', label: 'Title', one: true },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'year', label: 'Year' },
  { key: 'genre', label: 'Genre' },
  { key: 'track', label: 'Track number', one: true }
]

const valueOf = (s: LocalSong, key: keyof SongTagPatch): string => {
  const v = key === 'track' ? (s.track || '') : s[key]
  return v === undefined ? '' : String(v)
}

function EditDetails({ songs: given }: { songs: LocalSong[] }) {
  const library = useLocalMusic((s) => s.library)
  // The songs as they are now (after a cover or a fill-in, their details change).
  const songs = useMemo(() => {
    const byPath = new Map((library?.songs ?? []).map((s) => [s.path, s]))
    return given.map((s) => byPath.get(s.path) ?? s)
  }, [given, library])
  const many = songs.length > 1
  const fields = FIELDS.filter((f) => !many || !f.one)
  // What all the songs share; '' with `mixed` when they differ.
  const start = useMemo(() => {
    const out: Record<string, { value: string; mixed: boolean }> = {}
    for (const f of fields) {
      const values = new Set(songs.map((s) => valueOf(s, f.key)))
      out[f.key] = values.size === 1 ? { value: [...values][0], mixed: false } : { value: '', mixed: true }
    }
    return out
    // Only the first time the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(start).map(([k, v]) => [k, v.value])))
  const [busy, setBusy] = useState(false)
  const [covers, setCovers] = useState<{ url: string; album: string; artist: string }[] | null>(null)
  const [finding, setFinding] = useState(false)
  const [dropping, setDropping] = useState(false)
  const notTaggable = songs.filter((s) => !canTag(s.path))
  const cover = songs.find((s) => s.art)

  const changed = fields.filter((f) => values[f.key] !== start[f.key].value && !(start[f.key].mixed && values[f.key] === ''))
  const save = async (): Promise<void> => {
    if (!changed.length) return close()
    const patch: SongTagPatch = {}
    for (const f of changed) {
      if (f.key === 'track') patch.track = Number(values.track) || 0
      else patch[f.key] = values[f.key]
    }
    setBusy(true)
    const ok = await editSongs(songs, patch)
    setBusy(false)
    if (ok) close()
  }
  const coverFrom = async (source: { file?: string; url?: string } | null): Promise<void> => {
    if (!source) return
    setBusy(true)
    await setCover(songs, source)
    setBusy(false)
  }
  const findOnline = async (): Promise<void> => {
    setFinding(true)
    try {
      const album = values.album || songs[0].album
      const artist = values.artist || songs[0].artist
      setCovers(await window.api.musicTagsFindCovers(artist, album || songs[0].title))
    } catch (err) {
      notify(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setFinding(false)
    }
  }
  const guess = !many ? guessFromName(songs[0].path) : null

  return (
    <Modal label="Edit details" wide title={many ? `Edit ${songs.length} songs` : 'Edit details'}>
      <div className="mp-edit">
        <div className="mp-edit-cover">
          <div
            className={`mp-edit-art ${dropping ? 'drop' : ''}`}
            onDragOver={(e) => {
              if (!hasPicture(e)) return
              e.preventDefault()
              setDropping(true)
            }}
            onDragLeave={() => setDropping(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDropping(false)
              const pic = droppedPicture(e)
              if (pic) void coverFrom(pic)
              else notify('Drop a JPG, PNG or WebP picture.')
            }}
            title="Drop a picture here for the cover"
            data-mp-edit-cover
          >
            {cover ? <img src={localArtUrl(cover.path, cover.added)} alt="" /> : <Music size={40} />}
            <span className="mp-edit-drop">Drop a picture</span>
          </div>
          <button className="btn" disabled={busy} onClick={() => void window.api.musicTagsChooseImage().then((file) => (file ? coverFrom({ file }) : undefined))}>
            <ImagePlus size={13} /> Choose picture…
          </button>
          <button className="btn" disabled={busy || finding} onClick={() => void findOnline()} data-mp-find-covers>
            <Globe size={13} /> {finding ? 'Looking…' : 'Find online'}
          </button>
        </div>
        <div className="mp-edit-fields">
          {fields.map((f) => (
            <label key={f.key} className={f.key === 'year' || f.key === 'track' ? 'short' : ''}>
              {f.label}
              <input
                value={values[f.key]}
                onChange={(e) => setValues({ ...values, [f.key]: f.key === 'track' || f.key === 'year' ? e.target.value.replace(/\D/g, '').slice(0, 4) : e.target.value })}
                placeholder={start[f.key].mixed ? 'Several (leave empty to keep each one’s)' : ''}
                onKeyDown={(e) => e.key === 'Enter' && void save()}
                spellCheck={false}
                autoFocus={f.key === (many ? 'artist' : 'title')}
                data-mp-edit-field={f.key}
              />
            </label>
          ))}
          {guess && (guess.artist || guess.track) ? (
            <button
              className="link-btn mp-edit-guess"
              onClick={() => setValues({ ...values, title: guess.title || values.title, artist: guess.artist || values.artist, ...(guess.track ? { track: String(guess.track) } : {}) })}
              title="Use what the file’s name says"
            >
              <Wand2 size={12} /> Fill from the file name ({songs[0].path.split('/').pop()})
            </button>
          ) : null}
          {many && (
            <button className="link-btn mp-edit-guess" onClick={() => void fillFromNames(songs)} title="For songs with no title or artist written in them, use what their file names say">
              <Wand2 size={12} /> Fill empty details from the file names
            </button>
          )}
        </div>
      </div>
      {covers && (
        <div className="mp-cover-results" data-mp-cover-results>
          {covers.length === 0 && <p className="mp-nav-note">No covers found. Check the album and artist, then try again.</p>}
          {covers.map((c) => (
            <button key={c.url} onClick={() => void coverFrom({ url: c.url }).then(() => setCovers(null))} title={`${c.album} – ${c.artist}`} disabled={busy}>
              <img src={c.url.replace('/600x600bb.', '/200x200bb.')} alt="" />
              <span>{c.album}</span>
            </button>
          ))}
        </div>
      )}
      {notTaggable.length > 0 && (
        <p className="setting-warning">
          {notTaggable.length === 1 ? 'One song isn’t an MP3' : `${notTaggable.length} songs aren’t MP3s`}, so {notTaggable.length === 1 ? 'it' : 'they'} can’t be changed.
        </p>
      )}
      <p className="mp-nav-note">Saved into the files themselves, so the phone app and other players show the same. Ctrl+Z puts the old details back.</p>
      <div className="mp-modal-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()} data-mp-edit-save>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="btn" onClick={close}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}

// ---------- Tags ----------

/** In a song's right-click menu: your tags to tick, and a box for a new one. */
export function TagMenu({ songs, onDone }: { songs: LocalSong[]; onDone: () => void }) {
  const data = useMusicData((s) => s.data)
  const [name, setName] = useState('')
  const tags = allTags(data).map((t) => t.tag)
  const has = (tag: string): boolean => songs.every((s) => data.tags[s.path]?.includes(tag))
  const add = (): void => {
    const tag = cleanTag(name)
    if (!tag) return
    void tagSongs(songs, tag, true)
    setName('')
    onDone()
  }
  return (
    <div className="mp-menu-playlists mp-menu-tags">
      <span className="mp-menu-label">
        <Tag size={14} /> Tags
      </span>
      {tags.map((t) => (
        <button key={t} onClick={() => void tagSongs(songs, t, !has(t))} data-mp-menu-tag={t}>
          <span className="mp-tick">{has(t) && <Check size={12} />}</span>
          {t}
        </button>
      ))}
      <form
        className="mp-tag-new"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <Plus size={12} />
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={tags.length ? 'New tag' : 'Add a tag, like gym or chill'} maxLength={40} data-mp-new-tag />
      </form>
    </div>
  )
}

// ---------- Tidy my files ----------

function TidyFiles() {
  const songs = useLocalMusic((s) => s.library?.songs ?? [])
  const [layout, setLayout] = useState<TidyLayout>('flat')
  const [busy, setBusy] = useState(false)
  const moves = useMemo(() => tidyMoves(songs, layout), [songs, layout])
  const apply = async (): Promise<void> => {
    setBusy(true)
    const ok = await moveSongs(moves, 'Tidied your music files')
    setBusy(false)
    if (ok) close()
  }
  return (
    <Modal label="Tidy my files" wide title="Tidy my files">
      <p className="mp-modal-intro">Renames your music files from their details. Playlists, likes and play counts follow each song, and Ctrl+Z puts every file back.</p>
      <div className="mp-tidy-choice">
        <label>
          <input type="radio" checked={layout === 'flat'} onChange={() => setLayout('flat')} />
          <span>
            <strong>All in one folder</strong> <code>Artist - Title.mp3</code>
          </span>
        </label>
        <label>
          <input type="radio" checked={layout === 'folders'} onChange={() => setLayout('folders')} data-mp-tidy-folders />
          <span>
            <strong>Artist and album folders</strong> <code>Artist/Album/01 Title.mp3</code>
          </span>
        </label>
      </div>
      {moves.length === 0 ? (
        <p className="mp-empty">Every file already has a tidy name.</p>
      ) : (
        <>
          <p className="mp-nav-note">
            {moves.length === 1 ? 'One file changes' : `${moves.length} files change`} (the rest are already right):
          </p>
          <ul className="mp-tidy-list" data-mp-tidy-list>
            {moves.slice(0, 300).map((m) => (
              <li key={m.from}>
                <span title={m.from}>{m.from}</span>
                <em>→</em>
                <span title={m.to}>{m.to}</span>
              </li>
            ))}
            {moves.length > 300 && <li className="mp-nav-note">…and {moves.length - 300} more</li>}
          </ul>
        </>
      )}
      <div className="mp-modal-actions">
        <button className="btn btn-primary" disabled={busy || !moves.length} onClick={() => void apply()} data-mp-tidy-apply>
          {busy ? 'Renaming…' : `Rename ${moves.length === 1 ? '1 file' : `${moves.length} files`}`}
        </button>
        <button className="btn" onClick={close}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}

// ---------- Missing songs ----------

function FindMissing({ path }: { path: string }) {
  const songs = useLocalMusic((s) => s.library?.songs ?? [])
  const name = path.split('/').pop() ?? path
  const guess = guessFromName(path)
  const [query, setQuery] = useState(`${guess.artist} ${guess.title}`.trim())
  // Most likely first: the same file name somewhere else, then what the name says.
  const sameName = songs.filter((s) => s.path.split('/').pop()?.toLowerCase() === name.toLowerCase())
  const found = filterSongs(songs, query).slice(0, 60)
  const list = [...sameName, ...found.filter((s) => !sameName.includes(s))]
  return (
    <Modal label="Find a missing song" title="Find a missing song">
      <p className="mp-modal-intro">
        <code>{path}</code> isn’t in your music folder any more. Pick the song it is now, and every playlist, like and play count moves to it.
      </p>
      <label className="mp-find mp-modal-find">
        <Search size={14} />
        <input value={query} autoFocus onChange={(e) => setQuery(e.target.value)} placeholder="Find the song" spellCheck={false} data-mp-relink-find />
      </label>
      <ul className="mp-pick-list">
        {list.length === 0 && <li className="mp-nav-note">Nothing found. Try fewer words.</li>}
        {list.map((s) => (
          <li key={s.path}>
            <button onClick={() => void relink(path, s).then(close)} data-mp-relink={s.title}>
              <span className="mp-row-art">{s.art ? <img src={localArtUrl(s.path, s.added)} alt="" loading="lazy" /> : <Music size={13} />}</span>
              <span className="mp-row-text">
                <strong>{s.title}</strong>
                <span>
                  {s.artist || 'Unknown artist'} · {s.path}
                </span>
              </span>
              {sameName.includes(s) && <em className="mp-chip">Same file name</em>}
            </button>
          </li>
        ))}
      </ul>
      <div className="mp-modal-actions">
        <button className="btn" onClick={close}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}

// ---------- Duplicates (a page of its own) ----------

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`

export function DuplicatesView({ songs }: { songs: LocalSong[] }) {
  const groups = useMemo(() => duplicateGroups(songs), [songs])
  const [quality, setQuality] = useState<Record<string, { bitrate: number; size: number }>>({})
  useEffect(() => {
    const paths = groups.flat().map((s) => s.path)
    if (paths.length) void window.api.localMusicQuality(paths).then(setQuality, () => undefined)
  }, [groups])
  const best = (g: LocalSong[]): LocalSong =>
    [...g].sort((a, b) => (quality[b.path]?.bitrate ?? 0) - (quality[a.path]?.bitrate ?? 0) || (quality[b.path]?.size ?? 0) - (quality[a.path]?.size ?? 0))[0]
  return (
    <div className="mp-scroll">
      <header className="mp-header">
        <div className="mp-header-art">
          <Copy size={42} />
        </div>
        <div className="mp-header-text">
          <span className="mp-kicker">Your library</span>
          <h1>Duplicates</h1>
          <span className="mp-header-sub">{groups.length === 0 ? 'No song is in your music twice.' : `${groups.length} ${groups.length === 1 ? 'song is' : 'songs are'} in your music more than once`}</span>
        </div>
      </header>
      <p className="mp-note">Same artist and title, and nearly the same length. Keep one copy and the others go in the Recycle Bin; their plays, likes and playlist places move to the one you keep.</p>
      {groups.map((g) => {
        const suggest = best(g)
        return (
          <section key={g.map((s) => s.path).join('|')} className="mp-dup" data-mp-dup={g[0].title}>
            <h3>
              {g[0].title} <span>{g[0].artist}</span>
            </h3>
            {g.map((s) => {
              const q = quality[s.path]
              return (
                <div key={s.path} className="mp-dup-row">
                  <span className="mp-row-art">{s.art ? <img src={localArtUrl(s.path, s.added)} alt="" loading="lazy" /> : <Music size={13} />}</span>
                  <span className="mp-dup-path" title={s.path}>
                    <FileText size={12} /> {s.path}
                  </span>
                  <span className="mp-dup-q">
                    {q ? `${q.bitrate ? `${q.bitrate} kbps · ` : ''}${mb(q.size)}` : ''}
                    {s.durationMs ? ` · ${formatTime(s.durationMs)}` : ''}
                  </span>
                  {s === suggest && Object.keys(quality).length > 0 && <em className="mp-chip">Best quality</em>}
                  <button className="btn" onClick={() => void keepOne(s, g.filter((o) => o !== s))} data-mp-keep={s.path}>
                    Keep this one
                  </button>
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
