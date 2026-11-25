import './musicPage.css'
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Disc3,
  FolderOpen,
  Heart,
  History,
  ListMusic,
  ListPlus,
  Mic2,
  Music,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
  X,
  FolderSearch,
  ListEnd,
  ListStart,
  Tag,
  Copy,
  Wand2,
  FilePlus2,
  Sparkle,
  Download,
  ListChecks,
  PictureInPicture2,
  BarChart3,
  Maximize2,
  SlidersHorizontal,
  Smartphone,
  Lightbulb,
  Radio
} from 'lucide-react'
import ListeningStats from './ListeningStats'
import { openFullPlayer } from './FullPlayer'
import { RemotePanel, SoundPanel } from './SoundPanel'
import { filterSongs, localArtUrl, plainText, type LocalSong } from '@shared/localMusic'
import { recommendSongs, songsLike } from '@shared/musicRecommend'
import { formatTime } from '@shared/spotify'
import {
  albumsOf,
  artistsOf,
  likedSongs,
  mostPlayed,
  playlistSongs,
  recentlyAdded,
  songsByPath,
  songsWithTag,
  allTags,
  sortSongsBy,
  totalLength,
  type MusicPlaylist,
  type SongSort
} from '@shared/musicLibrary'
import {
  addToQueue,
  clearUpNext,
  loadLocalLibrary,
  localJump,
  moveInQueue,
  playLocal,
  playNext,
  removeFromQueue,
  resumeLastSession,
  useLocalMusic
} from '../../store/localMusic'
import { currentPosition, musicControl, musicSeek, setMusicMini, useMusic } from '../../store/music'
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  isLiked,
  moveInPlaylist,
  rateSong,
  removeFromPlaylist,
  renamePlaylist,
  startMusicData,
  toggleLike,
  useMusicData
} from '../../store/musicData'
import ContextMenu, { type MenuItem } from '../ContextMenu'
import { VolumeSlider } from './MusicPlayer'
import MusicSearch from './MusicSearch'
import FromSpotify from './FromSpotify'
import { droppedPicture, DuplicatesView, hasPicture, MusicDialogs, openMusicDialog, TagMenu } from './MusicTools'
import { deleteSongs, fillFromNames, importSongs, setCover } from '../../store/musicFiles'
import SaveMp3 from './SaveMp3'
import { onMusicLinkDone } from '../../store/musicLink'
import { notify } from '../../store/notify'

/**
 * The Music page: your own music files as a full music app, laid out like Spotify. Your library on
 * the left (songs, albums, artists, liked, playlists), the list in the middle, what's playing and
 * Up next on the right, and the controls along the bottom.
 */

type View =
  | { kind: 'search' }
  | { kind: 'spotify' }
  | { kind: 'songs' }
  | { kind: 'albums' }
  | { kind: 'album'; key: string }
  | { kind: 'artists' }
  | { kind: 'artist'; name: string }
  | { kind: 'liked' }
  | { kind: 'recent' }
  | { kind: 'most' }
  | { kind: 'recommended' }
  | { kind: 'history' }
  | { kind: 'stats' }
  | { kind: 'playlist'; id: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'duplicates' }

const VIEW_KEY = 'orbit.musicPageView'
const SONGS_MIME = 'application/x-orbit-songs'

function savedView(): View {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null')
    if (v && typeof v.kind === 'string') return v as View
  } catch {
    // Only a convenience.
  }
  return { kind: 'songs' }
}

/** A cover by its song's path, new as soon as the file changes. */
let indexFor: LocalSong[] | null = null
let index = new Map<string, LocalSong>()
function artUrl(path: string): string {
  const songs = useLocalMusic.getState().library?.songs ?? null
  if (songs !== indexFor) {
    indexFor = songs
    index = songsByPath(songs ?? [])
  }
  return localArtUrl(path, index.get(path)?.added)
}

const sameView = (a: View, b: View): boolean => JSON.stringify(a) === JSON.stringify(b)

export default function MusicPage() {
  const library = useLocalMusic((s) => s.library)
  const loading = useLocalMusic((s) => s.loading)
  const error = useLocalMusic((s) => s.error)
  const [view, setViewState] = useState<View>(savedView)
  const [filesOver, setFilesOver] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const setView = (v: View): void => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(v))
    } catch {
      // Only a convenience.
    }
  }

  // A song saved from a link: say so, wherever you are.
  useEffect(
    () =>
      onMusicLinkDone((p) => {
        if (p.stage === 'done') notify(`“${p.title}” is in your music.`, 'info')
        else if (p.error) notify(p.error)
      }),
    []
  )

  useEffect(() => {
    startMusicData()
    void (async () => {
      if (!useLocalMusic.getState().library) await loadLocalLibrary()
      await resumeLastSession()
    })()
  }, [])

  if (!library) return <div className="mp-page mp-center">{error ?? 'Looking for your music…'}</div>
  if (!library.folder) {
    return (
      <div className="mp-page mp-center" data-music-page>
        <Music size={40} />
        <h2>Your music</h2>
        <p>Choose the folder your music files are in (MP3, M4A, FLAC, WAV, OGG). If it’s in Google Drive, your playlists come with you to the Orbit Music phone app too.</p>
        <button className="btn btn-primary" onClick={() => loadLocalLibrary(true, true)} data-music-page-choose>
          <FolderOpen size={14} /> Choose music folder
        </button>
      </div>
    )
  }

  return (
    <div
      className="mp-page"
      data-music-page
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files') || e.defaultPrevented) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setFilesOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFilesOver(false)
      }}
      onDrop={(e) => {
        setFilesOver(false)
        if (e.defaultPrevented || !e.dataTransfer.files.length) return
        e.preventDefault()
        const files = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)
        void importSongs(files).then((added) => added.length && setView({ kind: 'recent' }))
      }}
    >
      <Sidebar view={view} setView={setView} folder={library.folder} loading={loading} onSaveLink={() => setLinkOpen(!linkOpen)} linkOpen={linkOpen} />
      <main className={`mp-main ${linkOpen ? 'with-link' : ''}`}>
        {linkOpen && <SaveMp3 onClose={() => setLinkOpen(false)} />}
        <ViewContent view={view} setView={setView} songs={library.songs} folder={library.folder} />
      </main>
      <NowPlayingPanel setView={setView} />
      <PlayerBar setView={setView} />
      {filesOver && (
        <div className="mp-drop-overlay" data-mp-drop-overlay>
          <FilePlus2 size={36} />
          <strong>Drop to add to your music</strong>
          <span>The songs are copied into your music folder.</span>
        </div>
      )}
      <MusicDialogs />
    </div>
  )
}

// ---------- Left: your library ----------

function Sidebar({ view, setView, folder, loading, onSaveLink, linkOpen }: { view: View; setView: (v: View) => void; folder: string; loading: boolean; onSaveLink: () => void; linkOpen: boolean }) {
  const playlists = useMusicData((s) => s.data.playlists)
  const data = useMusicData((s) => s.data)
  const songs = useLocalMusic((s) => s.library?.songs)
  // Only songs still in your music count (one deleted outside Orbit keeps its like, in case it comes back).
  const present = useMemo(() => new Set((songs ?? []).map((s) => s.path)), [songs])
  const tags = useMemo(() => allTags(data, present), [data, present])
  const likedCount = useMemo(() => Object.keys(data.liked).filter((p) => present.has(p)).length, [data, present])
  const [dropOn, setDropOn] = useState<string | null>(null)
  const [listMenu, setListMenu] = useState<{ x: number; y: number; playlist: MusicPlaylist } | null>(null)
  const listSongs = (p: MusicPlaylist): LocalSong[] => {
    const byPath = new Map((songs ?? []).map((s) => [s.path, s]))
    return p.songs.map((path) => byPath.get(path)).filter((s): s is LocalSong => !!s)
  }
  const item = (v: View, icon: React.ReactNode, label: string, extra?: string) => (
    <button className={`mp-nav-item ${sameView(view, v) ? 'active' : ''}`} onClick={() => setView(v)} data-mp-nav={v.kind}>
      {icon}
      <span>{label}</span>
      {extra && <em>{extra}</em>}
    </button>
  )
  const newPlaylist = async (): Promise<void> => {
    const id = await createPlaylist(`My playlist #${playlists.length + 1}`)
    if (id) setView({ kind: 'playlist', id })
  }
  const dropSongs = (e: DragEvent, id: string): void => {
    e.preventDefault()
    setDropOn(null)
    const songs = draggedSongs(e)
    if (songs.length) void addToPlaylist(id, songs)
  }
  return (
    <nav className="mp-sidebar">
      <div className="mp-nav-group">
        {item({ kind: 'search' }, <Search size={16} />, 'Search')}
        {item({ kind: 'spotify' }, <ListChecks size={16} />, 'From Spotify')}
        {item({ kind: 'songs' }, <Music size={16} />, 'Songs')}
        {item({ kind: 'albums' }, <Disc3 size={16} />, 'Albums')}
        {item({ kind: 'artists' }, <Mic2 size={16} />, 'Artists')}
        {item({ kind: 'liked' }, <Heart size={16} />, 'Liked songs', likedCount ? String(likedCount) : undefined)}
        {item({ kind: 'recommended' }, <Lightbulb size={16} />, 'Recommended')}
        {item({ kind: 'recent' }, <Sparkles size={16} />, 'Recently added')}
        {item({ kind: 'most' }, <TrendingUp size={16} />, 'Most played')}
        {item({ kind: 'history' }, <History size={16} />, 'History')}
        {item({ kind: 'stats' }, <BarChart3 size={16} />, 'Listening stats')}
      </div>
      <div className="mp-nav-heading">
        <span>Playlists</span>
        <button className="icon-btn" onClick={newPlaylist} title="New playlist" data-mp-new-playlist>
          <Plus size={15} />
        </button>
      </div>
      <div className="mp-nav-group mp-playlists">
        {playlists.length === 0 && <p className="mp-nav-note">Press + to make one, or right-click songs → Add to playlist.</p>}
        {playlists.map((p) => (
          <button
            key={p.id}
            className={`mp-nav-item ${view.kind === 'playlist' && view.id === p.id ? 'active' : ''} ${dropOn === p.id ? 'drop' : ''}`}
            onClick={() => setView({ kind: 'playlist', id: p.id })}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(SONGS_MIME)) return
              e.preventDefault()
              setDropOn(p.id)
            }}
            onDragLeave={() => setDropOn(null)}
            onDrop={(e) => dropSongs(e, p.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              setListMenu({ x: e.clientX, y: e.clientY, playlist: p })
            }}
            title={`${p.name}: drop songs here to add them`}
            data-mp-playlist={p.name}
          >
            <ListMusic size={16} />
            <span>{p.name}</span>
            <em>{p.songs.length}</em>
          </button>
        ))}
      </div>
      {tags.length > 0 && (
        <>
          <div className="mp-nav-heading">
            <span>Tags</span>
          </div>
          <div className="mp-nav-group mp-tags">
            {tags.map((t) => (
              <button key={t.tag} className={`mp-nav-item ${view.kind === 'tag' && view.tag === t.tag ? 'active' : ''}`} onClick={() => setView({ kind: 'tag', tag: t.tag })} data-mp-tag={t.tag}>
                <Tag size={15} />
                <span>{t.tag}</span>
                <em>{t.count}</em>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="mp-tools">
        <button className="icon-btn" onClick={() => void importSongs(null).then((added) => added.length && setView({ kind: 'recent' }))} title="Add songs (or drop music files anywhere on this page)" data-mp-add-songs>
          <FilePlus2 size={14} />
        </button>
        <button className={`icon-btn ${linkOpen ? 'mp-on' : ''}`} onClick={onSaveLink} title="Save an MP3 from a YouTube link" data-mp-save-link>
          <Download size={14} />
        </button>
        <button className="icon-btn" onClick={() => openMusicDialog({ kind: 'tidy' })} title="Tidy my files: rename them from their details" data-mp-tidy>
          <Sparkle size={14} />
        </button>
        <button className={`icon-btn ${view.kind === 'duplicates' ? 'mp-on' : ''}`} onClick={() => setView({ kind: 'duplicates' })} title="Find songs that are in your music twice" data-mp-nav="duplicates">
          <Copy size={14} />
        </button>
      </div>
      {listMenu && (
        <ContextMenu
          x={listMenu.x}
          y={listMenu.y}
          onClose={() => setListMenu(null)}
          items={[
            { label: 'Play', icon: <Play size={14} />, onClick: () => void playLocal(listSongs(listMenu.playlist), 0) },
            { label: 'Shuffle', icon: <Shuffle size={14} />, onClick: () => void playLocal(listSongs(listMenu.playlist), 'shuffle') },
            { label: 'Add to Up next', icon: <ListEnd size={14} />, onClick: () => void addToQueue(listSongs(listMenu.playlist)) },
            'separator',
            {
              label: 'Rename',
              icon: <Pencil size={14} />,
              onClick: () => {
                askRename(listMenu.playlist.id)
                setView({ kind: 'playlist', id: listMenu.playlist.id })
              }
            },
            {
              label: 'Delete playlist',
              icon: <Trash2 size={14} />,
              danger: true,
              onClick: () => {
                const id = listMenu.playlist.id
                void deletePlaylist(id).then((ok) => {
                  if (ok) notify(`Deleted “${listMenu.playlist.name}”. Ctrl+Z brings it back.`, 'info')
                  if (ok && view.kind === 'playlist' && view.id === id) setView({ kind: 'songs' })
                })
              }
            }
          ]}
        />
      )}
      <div className="mp-folder">
        <span title={folder}>{folder.split(/[\\/]/).pop()}</span>
        <button className="icon-btn" onClick={() => loadLocalLibrary(true)} disabled={loading} title="Look for new songs">
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
        </button>
        <button className="icon-btn" onClick={() => loadLocalLibrary(true, true)} title={`Your music folder: ${folder}. Press to choose another.`}>
          <FolderOpen size={13} />
        </button>
      </div>
    </nav>
  )
}

// ---------- Middle: what you picked ----------

let dragging: LocalSong[] = []
function draggedSongs(e: DragEvent): LocalSong[] {
  return e.dataTransfer.types.includes(SONGS_MIME) ? dragging : []
}

function ViewContent({ view, setView, songs, folder }: { view: View; setView: (v: View) => void; songs: LocalSong[]; folder: string }) {
  const data = useMusicData((s) => s.data)
  const byPath = useMemo(() => songsByPath(songs), [songs])
  const albums = useMemo(() => albumsOf(songs), [songs])
  const artists = useMemo(() => artistsOf(songs), [songs])

  switch (view.kind) {
    case 'search':
      return <MusicSearch songs={songs} />
    case 'spotify':
      return <FromSpotify songs={songs} setPlaylistView={(id) => setView({ kind: 'playlist', id })} />
    case 'albums':
      return (
        <CardGrid
          title="Albums"
          cards={albums.map((a) => ({ id: a.key, title: a.name, sub: a.artist || 'Unknown artist', art: a.art, songs: a.songs, open: () => setView({ kind: 'album', key: a.key }) }))}
        />
      )
    case 'artists':
      return (
        <CardGrid
          title="Artists"
          round
          cards={artists.map((a) => ({
            id: a.name,
            title: a.name,
            sub: `${a.songs.length} ${a.songs.length === 1 ? 'song' : 'songs'}${a.albums ? ` · ${a.albums} ${a.albums === 1 ? 'album' : 'albums'}` : ''}`,
            art: a.art,
            songs: a.songs,
            open: () => setView({ kind: 'artist', name: a.name })
          }))}
        />
      )
    case 'album': {
      const a = albums.find((x) => x.key === view.key)
      if (!a) return <Gone setView={setView} />
      return <SongView kicker="Album" title={a.name} sub={a.artist} art={a.art} songs={a.songs} setView={setView} folder={folder} showTrack album />
    }
    case 'artist': {
      const a = artists.find((x) => x.name === view.name)
      if (!a) return <Gone setView={setView} />
      return <SongView kicker="Artist" title={a.name} art={a.art} songs={a.songs} setView={setView} folder={folder} />
    }
    case 'liked':
      return <SongView kicker="Playlist" title="Liked songs" icon={<Heart size={42} fill="currentColor" />} songs={likedSongs(data, byPath)} setView={setView} folder={folder} empty="Songs you like (the heart) show up here." />
    case 'recent':
      return <SongView kicker="Your library" title="Recently added" icon={<Sparkles size={42} />} songs={recentlyAdded(songs)} setView={setView} folder={folder} defaultSort="added" />
    case 'most':
      return <SongView kicker="Your library" title="Most played" icon={<TrendingUp size={42} />} songs={mostPlayed(songs, data.stats)} setView={setView} folder={folder} empty="Songs you play show up here, counted after 30 seconds." />
    case 'recommended':
      return <RecommendedView songs={songs} setView={setView} folder={folder} />
    case 'history': {
      const list = [...data.history].reverse().map((h) => byPath.get(h.path)).filter((s): s is LocalSong => !!s).slice(0, 300)
      return <SongView kicker="Your library" title="History" icon={<History size={42} />} songs={list} setView={setView} folder={folder} empty="Songs you play show up here." />
    }
    case 'stats':
      return <ListeningStats songs={songs} openArtist={(name) => setView({ kind: 'artist', name })} openAlbum={(key) => setView({ kind: 'album', key })} />
    case 'tag':
      return <SongView kicker="Tag" title={view.tag} icon={<Tag size={42} />} songs={songsWithTag(songs, data, view.tag)} setView={setView} folder={folder} empty="No songs have this tag any more." />
    case 'duplicates':
      return <DuplicatesView songs={songs} />
    case 'playlist': {
      const p = data.playlists.find((x) => x.id === view.id)
      if (!p) return <Gone setView={setView} />
      return <PlaylistView playlist={p} byPath={byPath} setView={setView} folder={folder} />
    }
    default:
      return <SongView kicker="Your library" title="Songs" icon={<Music size={42} />} songs={songs} setView={setView} folder={folder} />
  }
}

function Gone({ setView }: { setView: (v: View) => void }) {
  return (
    <div className="mp-empty">
      <p>That isn’t in your library any more.</p>
      <button className="btn" onClick={() => setView({ kind: 'songs' })}>
        All songs
      </button>
    </div>
  )
}

interface Card {
  id: string
  title: string
  sub: string
  art?: string
  songs: LocalSong[]
  open: () => void
}

function CardGrid({ title, cards, round }: { title: string; cards: Card[]; round?: boolean }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = q ? cards.filter((c) => plainText(`${c.title} ${c.sub}`).includes(plainText(q))) : cards
  return (
    <div className="mp-scroll">
      <div className="mp-grid-head">
        <h1>{title}</h1>
        <FindBox value={query} onChange={setQuery} placeholder={`Find ${title.toLowerCase()}`} />
      </div>
      {shown.length === 0 && <p className="mp-empty">{q ? 'Nothing found.' : `No ${title.toLowerCase()} yet: songs need their album and artist filled in.`}</p>}
      <div className="mp-grid">
        {shown.map((c) => (
          <div key={c.id} className="mp-card" onClick={c.open} data-mp-card={c.title}>
            <div className={`mp-card-art ${round ? 'round' : ''}`}>
              {c.art ? <img src={artUrl(c.art)} alt="" loading="lazy" /> : round ? <Mic2 size={32} /> : <Disc3 size={32} />}
              <button
                className="mp-card-play"
                onClick={(e) => {
                  e.stopPropagation()
                  void playLocal(c.songs, 0)
                }}
                title={`Play ${c.title}`}
              >
                <Play size={18} fill="currentColor" />
              </button>
            </div>
            <strong title={c.title}>{c.title}</strong>
            <span title={c.sub}>{c.sub}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function FindBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="mp-find">
      <Search size={14} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} data-mp-find />
      {value && (
        <button className="icon-btn" onClick={() => onChange('')} title="Clear">
          <X size={12} />
        </button>
      )}
    </label>
  )
}

interface SongViewProps {
  kicker: string
  title: string
  sub?: string
  art?: string
  icon?: React.ReactNode
  songs: LocalSong[]
  setView: (v: View) => void
  folder: string
  empty?: string
  showTrack?: boolean
  defaultSort?: SongSort
  /** An album: its cover can be changed. */
  album?: boolean
}

function SongView({ kicker, title, sub, art, icon, songs, setView, folder, empty, showTrack, defaultSort, album }: SongViewProps) {
  const stats = useMusicData((s) => s.data.stats)
  const tags = useMusicData((s) => s.data.tags)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ by: SongSort; desc: boolean } | null>(defaultSort ? { by: defaultSort, desc: true } : null)
  const filtered = useMemo(() => filterSongs(songs, query, (s) => (tags[s.path] ?? []).join(' ')), [songs, query, tags])
  // Without a sort picked, the list keeps its own order (album tracks, most played, history…).
  const shown = useMemo(() => (sort ? sortSongsBy(filtered, sort.by, sort.desc, stats) : filtered), [filtered, sort, stats])
  return (
    <div className="mp-scroll">
      <Header kicker={kicker} title={title} sub={sub} art={art} icon={icon} songs={shown} editable={album ? songs : undefined} />
      <div className="mp-actions">
        <PlayButtons songs={shown} />
        <FindBox value={query} onChange={setQuery} placeholder="Find in this list" />
      </div>
      {shown.length === 0 ? (
        <p className="mp-empty">{query ? 'Nothing found.' : (empty ?? 'No songs here yet.')}</p>
      ) : (
        <SongTable rows={shown.map((song, i) => ({ song, key: `${song.path}:${i}` }))} setView={setView} folder={folder} sort={sort} onSort={setSort} showTrack={showTrack} />
      )}
    </div>
  )
}

/** A playlist to start renaming once it's open (Rename in its right-click menu). */
let renameOnOpen: string | null = null
const renameAsks = new Set<() => void>()
function askRename(id: string): void {
  renameOnOpen = id
  renameAsks.forEach((fn) => fn())
}

function Header({ kicker, title, sub, art, icon, songs, onRename, editable, renameId }: { kicker: string; title: string; sub?: string; art?: string; icon?: React.ReactNode; songs: LocalSong[]; onRename?: (name: string) => void; editable?: LocalSong[]; renameId?: string }) {
  const [editing, setEditing] = useState(false)
  /** When renaming was started from the right-click menu (the page and menu settling can take the focus away just after). */
  const askedAt = useRef(0)
  useEffect(() => {
    if (!renameId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = (): void => {
      if (renameOnOpen !== renameId) return
      renameOnOpen = null
      // After the right-click menu has closed, or its closing takes the focus from the name box (which ends renaming).
      askedAt.current = Date.now()
      timer = setTimeout(() => setEditing(true), 60)
    }
    check()
    // Asked while this playlist is already open.
    renameAsks.add(check)
    return () => {
      renameAsks.delete(check)
      clearTimeout(timer)
    }
  }, [renameId])
  const [coverOver, setCoverOver] = useState(false)
  const [name, setName] = useState(title)
  useEffect(() => setName(title), [title])
  const finish = (): void => {
    setEditing(false)
    if (onRename && name.trim() && name.trim() !== title) onRename(name.trim())
    else setName(title)
  }
  return (
    <header className="mp-header">
      <div
        className={`mp-header-art ${editable ? 'editable' : ''} ${coverOver ? 'drop' : ''}`}
        onDragOver={(e) => {
          if (!editable || !hasPicture(e)) return
          e.preventDefault()
          setCoverOver(true)
        }}
        onDragLeave={() => setCoverOver(false)}
        onDrop={(e) => {
          if (!editable) return
          e.preventDefault()
          setCoverOver(false)
          const pic = droppedPicture(e)
          if (pic) void setCover(editable, pic)
        }}
        onClick={() => editable && openMusicDialog({ kind: 'edit', songs: editable })}
        title={editable ? 'Change the cover: drop a picture here, or press to edit the album' : undefined}
        data-mp-header-art
      >
        {art ? <img src={artUrl(art)} alt="" /> : (icon ?? <ListMusic size={42} />)}
        {editable && (
          <span className="mp-header-art-edit">
            <Pencil size={18} /> Edit
          </span>
        )}
      </div>
      <div className="mp-header-text">
        <span className="mp-kicker">{kicker}</span>
        {editing ? (
          <input
            className="mp-title-input"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={(e) => {
              // Lost the focus to the page or menu settling, not to you: keep renaming.
              if (Date.now() - askedAt.current < 800) {
                const input = e.currentTarget
                setTimeout(() => input.isConnected && input.focus(), 0)
                return
              }
              finish()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finish()
              if (e.key === 'Escape') {
                setName(title)
                setEditing(false)
              }
            }}
            data-mp-rename-input
          />
        ) : (
          <h1 onDoubleClick={() => onRename && setEditing(true)} title={onRename ? 'Double-click to rename' : undefined}>
            {title}
            {onRename && (
              <button className="icon-btn mp-rename" onClick={() => setEditing(true)} title="Rename" data-mp-rename>
                <Pencil size={14} />
              </button>
            )}
          </h1>
        )}
        <span className="mp-header-sub">
          {sub ? `${sub} · ` : ''}
          {songs.length} {songs.length === 1 ? 'song' : 'songs'}
          {songs.length > 0 ? `, ${totalLength(songs)}` : ''}
        </span>
      </div>
    </header>
  )
}

function PlayButtons({ songs, extra }: { songs: LocalSong[]; extra?: React.ReactNode }) {
  return (
    <div className="mp-play-buttons">
      <button className="mp-big-play" disabled={!songs.length} onClick={() => playLocal(songs, 0)} title="Play" data-mp-play-all>
        <Play size={22} fill="currentColor" />
      </button>
      <button className="icon-btn mp-big-icon" disabled={!songs.length} onClick={() => playLocal(songs, 'shuffle')} title="Shuffle" data-mp-shuffle-all>
        <Shuffle size={20} />
      </button>
      {extra}
    </div>
  )
}

/** Plays a song and then songs that go with it (a song radio). */
function playLike(song: LocalSong): void {
  const { data } = useMusicData.getState()
  const songs = useLocalMusic.getState().library?.songs ?? []
  void playLocal([song, ...songsLike(song, data, songs, { now: Date.now(), seed: Date.now() })], 0)
}

/**
 * Songs from your music picked from how you listen (shared/musicRecommend.ts). The list stays put
 * while you play from it (plays would otherwise reshuffle it) until you press New picks.
 */
function RecommendedView({ songs, setView, folder }: { songs: LocalSong[]; setView: (v: View) => void; folder: string }) {
  const loaded = useMusicData((s) => s.loaded)
  const [seed, setSeed] = useState(() => Math.floor(Date.now() / 3_600_000))
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ by: SongSort; desc: boolean } | null>(null)
  const stats = useMusicData((s) => s.data.stats)
  const recs = useMemo(
    () => (loaded ? recommendSongs(useMusicData.getState().data, songs, { now: Date.now(), seed, limit: 50 }) : []),
    [loaded, songs, seed]
  )
  const shown = useMemo(() => {
    const keep = new Set(filterSongs(recs.map((r) => r.song), query))
    const found = recs.filter((r) => keep.has(r.song))
    if (!sort) return found
    const reasons = new Map(found.map((r) => [r.song, r.reason]))
    return sortSongsBy(found.map((r) => r.song), sort.by, sort.desc, stats).map((song) => ({ song, reason: reasons.get(song) ?? '' }))
  }, [recs, query, sort, stats])
  const list = shown.map((r) => r.song)
  const hasPlays = useMusicData((s) => s.data.history.length > 0 || Object.keys(s.data.liked).length > 0)
  return (
    <div className="mp-scroll">
      <Header kicker="Made for you" title="Recommended" sub="From your own music, picked from what you play, like and rate" icon={<Lightbulb size={42} />} songs={list} />
      <div className="mp-actions">
        <PlayButtons
          songs={list}
          extra={
            <button className="btn mp-add-songs mp-new-picks" onClick={() => setSeed((n) => n + 1)} title="A fresh set of recommendations" data-mp-new-picks>
              <RefreshCw size={14} /> New picks
            </button>
          }
        />
        <FindBox value={query} onChange={setQuery} placeholder="Find in this list" />
      </div>
      {!hasPlays && recs.length > 0 && <p className="mp-note">Play, like and rate some songs and these get more like you. For now, here are some to try.</p>}
      {shown.length === 0 ? (
        <p className="mp-empty">{query ? 'Nothing found.' : 'Add some music and recommendations show up here.'}</p>
      ) : (
        <SongTable rows={shown.map((r, i) => ({ song: r.song, key: `${r.song.path}:${i}`, note: r.reason }))} setView={setView} folder={folder} sort={sort} onSort={setSort} />
      )}
    </div>
  )
}

function PlaylistView({ playlist, byPath, setView, folder }: { playlist: MusicPlaylist; byPath: Map<string, LocalSong>; setView: (v: View) => void; folder: string }) {
  const entries = playlistSongs(playlist, byPath)
  const songs = entries.map((e) => e.song).filter((s): s is LocalSong => !!s)
  const missing = entries.length - songs.length
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ by: SongSort; desc: boolean } | null>(null)
  const stats = useMusicData((s) => s.data.stats)
  const q = query.trim()
  let rows = entries.map((e) => ({ song: e.song, key: `${e.path}:${e.position}`, position: e.position, path: e.path }))
  if (q) {
    const keep = new Set(filterSongs(songs, q))
    rows = rows.filter((r) => r.song && keep.has(r.song))
  }
  if (sort) {
    const order = sortSongsBy(rows.map((r) => r.song).filter((s): s is LocalSong => !!s), sort.by, sort.desc, stats)
    const rank = new Map(order.map((s, i) => [s, i]))
    rows = [...rows].sort((a, b) => (a.song ? (rank.get(a.song) ?? 0) : 1e9) - (b.song ? (rank.get(b.song) ?? 0) : 1e9))
  }
  const art = songs.find((s) => s.art)?.path
  return (
    <div className="mp-scroll">
      <Header kicker="Playlist" title={playlist.name} art={art} songs={songs} onRename={(name) => void renamePlaylist(playlist.id, name)} renameId={playlist.id} />
      <div className="mp-actions">
        <PlayButtons
          songs={songs}
          extra={
            <>
              <button className="btn mp-add-songs" onClick={() => openMusicDialog({ kind: 'addSongs', playlistId: playlist.id })} title="Pick songs from your music to add" data-mp-playlist-add>
                <Plus size={14} /> Add songs
              </button>
              <button className="icon-btn mp-big-icon" onClick={() => void deletePlaylist(playlist.id).then((ok) => ok && setView({ kind: 'songs' }))} title="Delete this playlist (Ctrl+Z brings it back)" data-mp-delete-playlist>
                <Trash2 size={18} />
              </button>
            </>
          }
        />
        <FindBox value={query} onChange={setQuery} placeholder="Find in this playlist" />
      </div>
      {missing > 0 && <p className="mp-note">{missing === 1 ? 'One song isn’t' : `${missing} songs aren’t`} in your music folder any more (moved, renamed or deleted), shown greyed out. Right-click one to find it again.</p>}
      {rows.length === 0 ? (
        <p className="mp-empty">{q ? 'Nothing found.' : 'Press Add songs to pick songs, drag songs onto this playlist on the left, or right-click songs → Add to playlist.'}</p>
      ) : (
        <SongTable
          rows={rows}
          setView={setView}
          folder={folder}
          sort={sort}
          onSort={setSort}
          playlist={{ id: playlist.id, canReorder: !sort && !q }}
        />
      )}
    </div>
  )
}

// ---------- The song list ----------

interface Row {
  song: LocalSong | null
  key: string
  /** Where it is in the playlist (playlist views only). */
  position?: number
  path?: string
  /** A line under the artist (why a song is recommended). */
  note?: string
}

interface TableProps {
  rows: Row[]
  setView: (v: View) => void
  folder: string
  sort: { by: SongSort; desc: boolean } | null
  onSort: (s: { by: SongSort; desc: boolean } | null) => void
  showTrack?: boolean
  playlist?: { id: string; canReorder: boolean }
}

function SongTable({ rows, setView, folder, sort, onSort, showTrack, playlist }: TableProps) {
  const data = useMusicData((s) => s.data)
  const playingPath = useLocalMusic((s) => s.queue[s.index]?.path)
  const local = useMusic((s) => s.local)
  const playing = useMusic((s) => s.state?.playing && s.local)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const [missingMenu, setMissingMenu] = useState<{ x: number; y: number; path: string; position?: number } | null>(null)
  const songs = rows.map((r) => r.song).filter((s): s is LocalSong => !!s)

  const selectedRows = rows.filter((r) => selected.has(r.key))
  const selectedSongs = selectedRows.map((r) => r.song).filter((s): s is LocalSong => !!s)

  const click = (e: ReactMouseEvent, i: number): void => {
    const key = rows[i].key
    if (e.shiftKey && anchor !== null) {
      const [a, b] = anchor < i ? [anchor, i] : [i, anchor]
      setSelected(new Set(rows.slice(a, b + 1).map((r) => r.key)))
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      setSelected(next)
      setAnchor(i)
    } else {
      setSelected(new Set([key]))
      setAnchor(i)
    }
  }
  const play = (i: number): void => {
    const song = rows[i].song
    if (!song) return
    void playLocal(songs, songs.indexOf(song))
  }

  const header = (by: SongSort, label: string, className = '') => (
    <button
      className={`mp-th ${className} ${sort?.by === by ? 'sorted' : ''}`}
      onClick={() => onSort(sort?.by === by ? (sort.desc ? null : { by, desc: true }) : { by, desc: by === 'plays' || by === 'added' })}
      title="Sort by this (press again to reverse, a third time for the list’s own order)"
    >
      {label}
      {sort?.by === by ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </button>
  )

  const menuItems = (): MenuItem[] => {
    const list = selectedSongs
    if (!list.length) return []
    const one = list.length === 1 ? list[0] : null
    const allLiked = list.every((s) => isLiked(data, s))
    const items: MenuItem[] = [
      { label: 'Play', icon: <Play size={14} />, onClick: () => playLocal(list, 0) },
      { label: 'Play next', icon: <ListStart size={14} />, onClick: () => void playNext(list) },
      { label: 'Add to Up next', icon: <ListEnd size={14} />, onClick: () => void addToQueue(list) },
      ...(one ? [{ label: 'Play songs like this', icon: <Radio size={14} />, onClick: () => playLike(one) }] : []),
      'separator',
      { label: allLiked ? 'Remove from Liked songs' : 'Add to Liked songs', icon: <Heart size={14} />, onClick: () => void toggleLike(list) },
      {
        custom: (close) => (
          <div className="mp-menu-playlists">
            <span className="mp-menu-label">
              <ListPlus size={14} /> Add to playlist
            </span>
            <button
              onClick={() => {
                close()
                void createPlaylist(one ? one.title : `New playlist (${list.length} songs)`, list).then((id) => id && setView({ kind: 'playlist', id }))
              }}
              data-mp-menu-new-playlist
            >
              <Plus size={12} /> New playlist
            </button>
            {data.playlists
              .filter((p) => p.id !== playlist?.id)
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    close()
                    void addToPlaylist(p.id, list)
                  }}
                  data-mp-menu-playlist={p.name}
                >
                  {p.name}
                </button>
              ))}
          </div>
        )
      }
    ]
    items.push({ custom: (close) => <TagMenu songs={list} onDone={close} /> })
    items.push('separator')
    items.push({ label: one ? 'Edit details…' : `Edit ${list.length} songs…`, icon: <Pencil size={14} />, onClick: () => openMusicDialog({ kind: 'edit', songs: list }) })
    if (list.some((s) => !s.album || /^\d+\s*[-.]/.test(s.path.split('/').pop() ?? ''))) {
      items.push({ label: 'Fill in from the file name', icon: <Wand2 size={14} />, onClick: () => void fillFromNames(list) })
    }
    if (playlist) {
      const positions = selectedRows.map((r) => r.position).filter((p): p is number => p !== undefined)
      items.push({ label: 'Remove from this playlist', icon: <X size={14} />, danger: true, onClick: () => void removeFromPlaylist(playlist.id, positions) })
    }
    items.push({ label: one ? 'Delete from my music…' : `Delete ${list.length} songs from my music…`, icon: <Trash2 size={14} />, danger: true, onClick: () => void deleteSongs(list) })
    if (one) {
      items.push('separator')
      if (one.album) {
        const key = `${one.album.toLowerCase()}\u0000${(one.artist || '').toLowerCase()}`
        items.push({ label: 'Go to album', icon: <Disc3 size={14} />, onClick: () => setView({ kind: 'album', key }) })
      }
      items.push({ label: 'Go to artist', icon: <Mic2 size={14} />, onClick: () => setView({ kind: 'artist', name: one.artist || 'Unknown artist' }) })
      items.push({ label: 'Show in Files', icon: <FolderSearch size={14} />, onClick: () => void window.api.explorerReveal(`${folder}/${one.path}`) })
      items.push({
        custom: (close) => (
          <div className="mp-menu-stars">
            <span className="mp-menu-label">Rating</span>
            <Stars value={data.ratings[one.path] ?? 0} onPick={(n) => (close(), void rateSong(one, n))} />
          </div>
        )
      })
    }
    return items
  }

  const onRowDragStart = (e: DragEvent, i: number): void => {
    const key = rows[i].key
    const keys = selected.has(key) ? selected : new Set([key])
    if (!selected.has(key)) setSelected(keys)
    dragging = rows.filter((r) => keys.has(r.key)).map((r) => r.song).filter((s): s is LocalSong => !!s)
    e.dataTransfer.setData(SONGS_MIME, JSON.stringify(dragging.map((s) => s.path)))
    e.dataTransfer.setData('text/plain', dragging.map((s) => `${s.title} – ${s.artist}`).join('\n'))
    e.dataTransfer.effectAllowed = 'copyMove'
    reorderFrom = playlist?.canReorder && keys.size === 1 ? (rows[i].position ?? null) : null
  }

  return (
    <div className={`mp-table ${showTrack ? 'with-track' : ''}`} data-mp-table onKeyDown={(e) => {
        if (e.key === 'Enter' && anchor !== null) play(anchor)
        if (e.key === 'Delete' && selectedSongs.length) {
          e.preventDefault()
          // In a playlist, Delete takes songs out of the playlist; elsewhere it deletes them (after asking).
          if (playlist) void removeFromPlaylist(playlist.id, selectedRows.map((r) => r.position).filter((p): p is number => p !== undefined))
          else void deleteSongs(selectedSongs)
        }
      }} tabIndex={-1}>
      <div className="mp-tr mp-thead">
        <span className="mp-th mp-num">#</span>
        {header('title', 'Title')}
        {header('album', 'Album', 'mp-col-album')}
        {header('plays', 'Plays', 'mp-col-plays')}
        <span className="mp-th" />
        {header('time', '', 'mp-col-time')}
      </div>
      {rows.map((r, i) => {
        const s = r.song
        const current = !!s && local && s.path === playingPath
        const liked = !!s && isLiked(data, s)
        return (
          <div
            key={r.key}
            className={`mp-tr ${selected.has(r.key) ? 'selected' : ''} ${current ? 'current' : ''} ${s ? '' : 'missing'} ${dropAt === i ? 'drop-above' : ''}`}
            onClick={(e) => click(e, i)}
            onDoubleClick={() => play(i)}
            onContextMenu={(e) => {
              e.preventDefault()
              if (!s) {
                if (r.path) setMissingMenu({ x: e.clientX, y: e.clientY, path: r.path, position: r.position })
                return
              }
              if (!selected.has(r.key)) {
                setSelected(new Set([r.key]))
                setAnchor(i)
              }
              setMenu({ x: e.clientX, y: e.clientY })
            }}
            draggable={!!s}
            onDragStart={(e) => onRowDragStart(e, i)}
            onDragOver={(e) => {
              if (!playlist?.canReorder || reorderFrom === null) return
              e.preventDefault()
              setDropAt(i)
            }}
            onDragLeave={() => setDropAt(null)}
            onDrop={(e) => {
              e.preventDefault()
              setDropAt(null)
              if (playlist && reorderFrom !== null && r.position !== undefined) void moveInPlaylist(playlist.id, reorderFrom, r.position)
              reorderFrom = null
            }}
            onDragEnd={() => {
              reorderFrom = null
              setDropAt(null)
            }}
            data-mp-row={s?.title ?? r.path}
          >
            <span className="mp-num">
              {current && playing ? <span className="mp-eq" aria-label="Playing"><i /><i /><i /></span> : showTrack && s?.track ? s.track : i + 1}
              <button className="mp-row-play" onClick={(e) => (e.stopPropagation(), play(i))} title="Play">
                <Play size={13} fill="currentColor" />
              </button>
            </span>
            <span className="mp-col-title">
              {!showTrack && <span className="mp-row-art">{s?.art ? <img src={localArtUrl(s.path, s.added)} alt="" loading="lazy" /> : <Music size={14} />}</span>}
              <span className="mp-row-text">
                <strong title={s?.title ?? r.path}>{s?.title ?? (r.path ?? '').split('/').pop()}</strong>
                {s ? (
                  <button
                    className="mp-link"
                    onClick={(e) => {
                      e.stopPropagation()
                      setView({ kind: 'artist', name: s.artist || 'Unknown artist' })
                    }}
                  >
                    {s.artist || 'Unknown artist'}
                  </button>
                ) : (
                  <span>Not in your music folder</span>
                )}
                {r.note && <em className="mp-row-note">{r.note}</em>}
              </span>
            </span>
            <span className="mp-col-album">
              {s?.album && (
                <button
                  className="mp-link"
                  onClick={(e) => {
                    e.stopPropagation()
                    setView({ kind: 'album', key: `${s.album.toLowerCase()}\u0000${(s.artist || '').toLowerCase()}` })
                  }}
                >
                  {s.album}
                </button>
              )}
            </span>
            <span className="mp-col-plays">{s ? data.stats[s.path]?.plays || '' : ''}</span>
            <span className="mp-col-like">
              {s && (
                <button className={`icon-btn mp-heart ${liked ? 'on' : ''}`} onClick={(e) => (e.stopPropagation(), void toggleLike([s]))} title={liked ? 'Remove from Liked songs' : 'Add to Liked songs'} data-mp-like={s.title}>
                  <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
                </button>
              )}
            </span>
            <span className="mp-col-time">{s && s.durationMs > 0 ? formatTime(s.durationMs) : ''}</span>
          </div>
        )
      })}
      {menu && selectedSongs.length > 0 && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />}
      {missingMenu && (
        <ContextMenu
          x={missingMenu.x}
          y={missingMenu.y}
          items={[
            { label: 'Find it again…', icon: <Search size={14} />, onClick: () => openMusicDialog({ kind: 'relink', path: missingMenu.path }) },
            ...(playlist && missingMenu.position !== undefined
              ? [{ label: 'Remove from this playlist', icon: <X size={14} />, danger: true, onClick: () => void removeFromPlaylist(playlist.id, [missingMenu.position!]) }]
              : [])
          ]}
          onClose={() => setMissingMenu(null)}
        />
      )}
    </div>
  )
}

/** The playlist position being dragged to a new place (only one song at a time, with the list in its own order). */
let reorderFrom: number | null = null

function Stars({ value, onPick }: { value: number; onPick: (n: number) => void }) {
  const [hover, setHover] = useState(0)
  return (
    <span className="mp-stars" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={(hover || value) >= n ? 'on' : ''} onMouseEnter={() => setHover(n)} onClick={() => onPick(n)} title={n === value ? 'Clear the rating' : `${n} star${n === 1 ? '' : 's'}`}>
          <Star size={14} fill={(hover || value) >= n ? 'currentColor' : 'none'} />
        </button>
      ))}
    </span>
  )
}

// ---------- Right: what's playing and Up next ----------

function NowPlayingPanel({ setView }: { setView: (v: View) => void }) {
  const queue = useLocalMusic((s) => s.queue)
  const index = useLocalMusic((s) => s.index)
  const local = useMusic((s) => s.local)
  const data = useMusicData((s) => s.data)
  const song = local ? queue[index] : undefined
  const [dropAt, setDropAt] = useState<number | null>(null)
  const from = useRef<number | null>(null)
  const next = local ? queue.slice(index + 1, index + 201) : []

  return (
    <aside className="mp-right" data-mp-now>
      {song ? (
        <>
          <div className="mp-now-art clickable" onClick={openFullPlayer} title="Full-screen Now playing, with lyrics" data-mp-now-art>
            {song.art ? <img src={localArtUrl(song.path, song.added)} alt="" /> : <Music size={48} />}
          </div>
          <div className="mp-now-text">
            <div>
              <strong title={song.title}>{song.title}</strong>
              <button className="mp-link" onClick={() => setView({ kind: 'artist', name: song.artist || 'Unknown artist' })}>
                {song.artist || 'Unknown artist'}
              </button>
            </div>
            <button className={`icon-btn mp-heart ${isLiked(data, song) ? 'on' : ''}`} onClick={() => void toggleLike([song])} title={isLiked(data, song) ? 'Remove from Liked songs' : 'Add to Liked songs'} data-mp-now-like>
              <Heart size={18} fill={isLiked(data, song) ? 'currentColor' : 'none'} />
            </button>
          </div>
          <Stars value={data.ratings[song.path] ?? 0} onPick={(n) => void rateSong(song, n)} />
        </>
      ) : (
        <div className="mp-now-empty">
          <Music size={32} />
          <p>Nothing playing. Double-click a song, or press play on an album or playlist.</p>
        </div>
      )}
      <div className="mp-queue-head">
        <h3>Up next</h3>
        {next.length > 0 && (
          <button className="link-btn" onClick={clearUpNext} data-mp-clear-queue>
            Clear
          </button>
        )}
      </div>
      {next.length === 0 && <p className="mp-nav-note">Right-click songs → Play next or Add to Up next.</p>}
      <ul className="mp-queue" data-mp-queue>
        {next.map((s, i) => {
          const at = index + 1 + i
          return (
            <li
              key={`${s.path}:${at}`}
              className={dropAt === at ? 'drop-above' : ''}
              draggable
              onDragStart={(e) => {
                from.current = at
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', s.title)
              }}
              onDragOver={(e) => {
                if (from.current === null) return
                e.preventDefault()
                setDropAt(at)
              }}
              onDragLeave={() => setDropAt(null)}
              onDrop={(e) => {
                e.preventDefault()
                if (from.current !== null) moveInQueue(from.current, at)
                from.current = null
                setDropAt(null)
              }}
              onDragEnd={() => {
                from.current = null
                setDropAt(null)
              }}
              onDoubleClick={() => void localJump(at)}
              title="Drag to change the order; double-click to play it now"
              data-mp-queue-song={s.title}
            >
              <span className="mp-row-art">{s.art ? <img src={localArtUrl(s.path, s.added)} alt="" loading="lazy" /> : <Music size={13} />}</span>
              <span className="mp-row-text">
                <strong>{s.title}</strong>
                <span>{s.artist}</span>
              </span>
              <button className="icon-btn mp-queue-x" onClick={() => removeFromQueue(at)} title="Take it out of Up next">
                <X size={13} />
              </button>
            </li>
          )
        })}
      </ul>
      {song && <UpNextSuggestions song={song} />}
    </aside>
  )
}

/** A few songs that go with what's playing, to add to Up next with one press. */
function UpNextSuggestions({ song }: { song: LocalSong }) {
  const songs = useLocalMusic((s) => s.library?.songs)
  const queue = useLocalMusic((s) => s.queue)
  const index = useLocalMusic((s) => s.index)
  const [seed, setSeed] = useState(1)
  const [hidden, setHidden] = useState(false)
  // Songs just played or coming up soon (playing a whole album or all your songs queues everything, so not the whole queue).
  const queued = useMemo(() => new Set(queue.slice(Math.max(0, index - 5), index + 11).map((s) => s.path)), [queue, index])
  // Worked out again only for a new song (not on every play counted), so the list doesn't jump about.
  const pool = useMemo(
    () => songsLike(song, useMusicData.getState().data, songs ?? [], { now: Date.now(), seed, limit: 20 }),
    [song.path, songs, seed]
  )
  const picks = pool.filter((s) => !queued.has(s.path)).slice(0, 4)
  if (!picks.length) return null
  return (
    <div className="mp-suggest" data-mp-suggest>
      <div className="mp-queue-head">
        <h3>Suggested</h3>
        <span>
          {!hidden && (
            <button className="icon-btn" onClick={() => setSeed((n) => n + 1)} title="Other suggestions" data-mp-suggest-more>
              <RefreshCw size={13} />
            </button>
          )}
          <button className="link-btn" onClick={() => setHidden(!hidden)}>
            {hidden ? 'Show' : 'Hide'}
          </button>
        </span>
      </div>
      {!hidden && (
        <ul className="mp-queue">
          {picks.map((s) => (
            <li key={s.path} onDoubleClick={() => void addToQueue([s])} title="Double-click or press + to add it to Up next" data-mp-suggest-song={s.title}>
              <span className="mp-row-art">{s.art ? <img src={localArtUrl(s.path, s.added)} alt="" loading="lazy" /> : <Music size={13} />}</span>
              <span className="mp-row-text">
                <strong>{s.title}</strong>
                <span>{s.artist}</span>
              </span>
              <button className="icon-btn" onClick={() => void addToQueue([s])} title="Add to Up next" data-mp-suggest-add>
                <Plus size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- Bottom: the controls ----------

function PlayerBar({ setView }: { setView: (v: View) => void }) {
  const state = useMusic((s) => s.state)
  const local = useMusic((s) => s.local)
  const at = useMusic((s) => s.at)
  const queue = useLocalMusic((s) => s.queue)
  const index = useLocalMusic((s) => s.index)
  const data = useMusicData((s) => s.data)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!state?.playing) return
    const id = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [state?.playing])
  const song = local ? queue[index] : undefined
  const live = local && state?.source === 'local' ? state : null
  const duration = live?.track?.durationMs ?? song?.durationMs ?? 0
  const pos = live ? currentPosition(live, at) : 0
  const [scrub, setScrub] = useState<number | null>(null)
  const shownPos = scrub ?? pos
  const miniOpen = useMusic((s) => s.miniOpen)
  const [panel, setPanel] = useState<'sound' | 'remote' | null>(null)

  return (
    <footer className="mp-bar" data-mp-bar>
      <div className="mp-bar-song">
        {song ? (
          <>
            <span className="mp-bar-art">{song.art ? <img src={localArtUrl(song.path, song.added)} alt="" /> : <Music size={18} />}</span>
            <span className="mp-row-text">
              <strong title={song.title}>{song.title}</strong>
              <button className="mp-link" onClick={() => setView({ kind: 'artist', name: song.artist || 'Unknown artist' })}>
                {song.artist || 'Unknown artist'}
              </button>
            </span>
            <button className={`icon-btn mp-heart ${isLiked(data, song) ? 'on' : ''}`} onClick={() => void toggleLike([song])} title="Liked songs">
              <Heart size={15} fill={isLiked(data, song) ? 'currentColor' : 'none'} />
            </button>
          </>
        ) : (
          <span className="mp-bar-idle">Nothing playing</span>
        )}
      </div>
      <div className="mp-bar-middle">
        <div className="mp-bar-buttons">
          <button className={`icon-btn ${live?.shuffle ? 'mp-on' : ''}`} onClick={() => musicControl('shuffle')} title={live?.shuffle ? 'Shuffle is on' : 'Shuffle'} disabled={!song}>
            <Shuffle size={16} />
          </button>
          <button className="icon-btn" onClick={() => musicControl('previous')} title="Previous" disabled={!song}>
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button className="mp-bar-play" onClick={() => musicControl('toggle')} title={live?.playing ? 'Pause' : 'Play'} data-mp-bar-toggle>
            {live?.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button className="icon-btn" onClick={() => musicControl('next')} title="Next" disabled={!song}>
            <SkipForward size={18} fill="currentColor" />
          </button>
          <button
            className={`icon-btn ${live?.repeat && live.repeat !== 'off' ? 'mp-on' : ''}`}
            onClick={() => musicControl('repeat')}
            title={live?.repeat === 'track' ? 'Repeating this song' : live?.repeat === 'context' ? 'Repeating all' : 'Repeat'}
            disabled={!song}
          >
            {live?.repeat === 'track' ? <Repeat1 size={16} /> : <Repeat size={16} />}
          </button>
        </div>
        <div className="mp-bar-progress">
          <span>{formatTime(shownPos)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            value={Math.min(shownPos, duration)}
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={() => {
              if (scrub !== null) void musicSeek(scrub)
              setScrub(null)
            }}
            onKeyUp={() => {
              if (scrub !== null) void musicSeek(scrub)
              setScrub(null)
            }}
            style={{ '--fill': `${duration ? (Math.min(shownPos, duration) / duration) * 100 : 0}%` } as React.CSSProperties}
            disabled={!song}
            aria-label="Where in the song"
            data-mp-seek
          />
          <span>{duration ? formatTime(duration) : '0:00'}</span>
        </div>
      </div>
      <div className="mp-bar-right">
        <button className={`icon-btn ${panel === 'remote' ? 'mp-on' : ''}`} onClick={() => setPanel(panel === 'remote' ? null : 'remote')} title="Phone remote: control this music from your phone" data-mp-remote>
          <Smartphone size={16} />
        </button>
        <button className={`icon-btn ${panel === 'sound' ? 'mp-on' : ''}`} onClick={() => setPanel(panel === 'sound' ? null : 'sound')} title="Sound: crossfade, equaliser and visualiser" data-mp-sound>
          <SlidersHorizontal size={16} />
        </button>
        <button className="icon-btn" onClick={openFullPlayer} title="Full-screen Now playing, with lyrics" data-mp-full>
          <Maximize2 size={15} />
        </button>
        {panel === 'sound' && <SoundPanel onClose={() => setPanel(null)} />}
        {panel === 'remote' && <RemotePanel onClose={() => setPanel(null)} />}
        <button
          className={`icon-btn ${miniOpen ? 'mp-on' : ''}`}
          onClick={() => void setMusicMini(!miniOpen)}
          title={miniOpen ? 'Close the mini player' : 'Open the mini player (floats on top of other apps)'}
          data-mp-mini
        >
          <PictureInPicture2 size={16} />
        </button>
        {live?.volume !== undefined && <VolumeSlider volume={live.volume} />}
      </div>
    </footer>
  )
}
