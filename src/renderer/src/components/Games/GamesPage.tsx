import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Eye, EyeOff, FolderOpen, Gamepad2, Loader2, MoreHorizontal, Play, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { describeLastPlayed, describePlayed, sortGames, type Game, type GameSort, type GameSource, type GamesList } from '@shared/games'
import { FILE_MANAGER, IS_MAC } from '@shared/platform'
import ContextMenu, { type MenuItem } from '../ContextMenu'
import LaunchAnimation from './LaunchAnimation'
import { usePrefs } from '../../store/prefs'
import { notify } from '../../store/notify'

const SOURCE_NAMES: Record<GameSource, string> = { steam: 'Steam', epic: 'Epic Games', app: IS_MAC ? 'Mac app' : 'App', added: 'Added by you' }

const SORTS: { value: GameSort; label: string }[] = [
  { value: 'recent', label: 'Recently played' },
  { value: 'most', label: 'Most played' },
  { value: 'name', label: 'A to Z' }
]

const savedSort = (): GameSort => {
  try {
    const s = localStorage.getItem('games.sort')
    return s === 'most' || s === 'name' ? s : 'recent'
  } catch {
    return 'recent'
  }
}

/** The Games page: every game on this computer in one place, with time played, and a Play button. */
export default function GamesPage() {
  const [data, setData] = useState<GamesList | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<GameSort>(savedSort)
  const [source, setSource] = useState<GameSource | ''>('')
  const [showHidden, setShowHidden] = useState(false)
  const [starting, setStarting] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; game: Game } | null>(null)
  const [launching, setLaunching] = useState<Game | null>(null)
  const animate = usePrefs((s) => s.prefs.gameLaunchAnimation && s.prefs.motion !== 'off')

  const load = useCallback(async (rescan: boolean) => {
    if (rescan) setRefreshing(true)
    try {
      setData(await window.api.gamesList(rescan))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
    return window.api.onGamesChanged(() => void load(false))
  }, [load])

  const changeSort = (s: GameSort): void => {
    setSort(s)
    try {
      localStorage.setItem('games.sort', s)
    } catch {
      // remembered for now only
    }
  }

  const play = async (g: Game): Promise<void> => {
    setStarting(g.id)
    // The animation plays while the game starts; it doesn't hold the game back.
    if (animate) setLaunching(g)
    const error = await window.api.gamesPlay(g.id)
    if (error) {
      setLaunching(null)
      notify(error)
    }
    setTimeout(() => setStarting((s) => (s === g.id ? null : s)), 4000)
  }

  const endLaunch = useCallback(() => setLaunching(null), [])

  const setHidden = async (g: Game, hidden: boolean): Promise<void> => {
    await window.api.gamesSetHidden(g.id, hidden)
    await load(false)
  }

  const add = async (): Promise<void> => {
    const id = await window.api.gamesAdd()
    if (id) await load(false)
  }

  const games = data?.games ?? []
  const sources = useMemo(() => [...new Set(games.map((g) => g.source))], [games])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sortGames(
      games.filter((g) => !g.hidden && (!source || g.source === source) && (!q || g.name.toLowerCase().includes(q))),
      sort
    )
  }, [games, query, source, sort])
  const hidden = games.filter((g) => g.hidden)
  const week = games.reduce((sum, g) => sum + g.playedWeek, 0)
  const playing = games.filter((g) => g.running)
  const now = new Date()

  const openMenu = (e: MouseEvent, g: Game): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, game: g })
  }

  const menuItems = (g: Game): MenuItem[] => [
    { label: 'Play', icon: <Play size={14} />, onClick: () => void play(g) },
    { label: `Show in ${FILE_MANAGER}`, icon: <FolderOpen size={14} />, onClick: () => void window.api.gamesReveal(g.id) },
    'separator',
    g.hidden
      ? { label: 'Show on the list again', icon: <Eye size={14} />, onClick: () => void setHidden(g, false) }
      : { label: 'Hide from the list', icon: <EyeOff size={14} />, onClick: () => void setHidden(g, true) },
    ...(g.source === 'added'
      ? [{ label: 'Remove', icon: <Trash2 size={14} />, danger: true, onClick: () => void window.api.gamesRemove(g.id).then(() => load(false)) } as MenuItem]
      : [])
  ]

  return (
    <div className="games-page" data-games-page>
      <div className="games-inner">
        <h2>
          <Gamepad2 size={20} /> Games
        </h2>
        <p className="games-intro">
          Your Steam{data?.epic ? ', Epic' : ''}
          {IS_MAC ? ' and Mac' : ''} games in one place. Time played is counted while Notes is running, even with its window closed; Steam
          games also include the time Steam itself has counted.
        </p>

        <div className="games-summary">
          <div>
            <strong>{describePlayed(week) === 'Not played yet' ? 'Nothing yet' : describePlayed(week)}</strong>
            <span> played in the last 7 days</span>
            {playing.length > 0 && <span className="games-now"> · Playing {playing.map((g) => g.name).join(', ')}</span>}
          </div>
          <div className="games-summary-buttons">
            <button className="btn" onClick={() => void load(true)} disabled={refreshing} title="Look for newly installed games" data-games-refresh>
              {refreshing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
            </button>
            <button className="btn" onClick={() => void add()} title={IS_MAC ? 'Pick a game from Applications that isn’t on the list' : 'Pick a game that isn’t on the list'} data-games-add>
              <Plus size={14} /> Add a game
            </button>
          </div>
        </div>

        {games.length > 0 && (
          <div className="games-tools">
            <div className="games-search">
              <Search size={14} />
              <input value={query} placeholder={`Search ${games.length - hidden.length} game${games.length - hidden.length === 1 ? '' : 's'}`} spellCheck={false} onChange={(e) => setQuery(e.target.value)} data-games-search />
            </div>
            {sources.length > 1 && (
              <select className="select" value={source} onChange={(e) => setSource(e.target.value as GameSource | '')}>
                <option value="">All games</option>
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_NAMES[s]}
                  </option>
                ))}
              </select>
            )}
            <select className="select" value={sort} onChange={(e) => changeSort(e.target.value as GameSort)} data-games-sort>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {!data && (
          <p className="games-none">
            <Loader2 size={14} className="spin" /> Looking for games…
          </p>
        )}
        {data && !games.length && (
          <div className="games-none" data-games-empty>
            <p>No games found on this computer yet.</p>
            <ul>
              <li>{data.steam ? 'Steam is installed, but no games are downloaded in it yet.' : 'Steam games show up here once Steam is installed and a game is downloaded.'}</li>
              {IS_MAC && <li>Games from the App Store and other Mac games in Applications show up by themselves.</li>}
              <li>
                Anything else: click <b>Add a game</b> and pick it.
              </li>
            </ul>
          </div>
        )}
        {data && games.length > 0 && !shown.length && <p className="games-none">No games match.</p>}

        <div className="games-grid" data-games-grid>
          {shown.map((g) => (
            <GameCard key={g.id} game={g} now={now} starting={starting === g.id} onPlay={() => void play(g)} onMenu={(e) => openMenu(e, g)} />
          ))}
        </div>

        {hidden.length > 0 && (
          <div className="games-hidden">
            <button className="link-button" onClick={() => setShowHidden(!showHidden)}>
              {showHidden ? 'Hide' : 'Show'} {hidden.length} hidden game{hidden.length === 1 ? '' : 's'}
            </button>
            {showHidden && (
              <ul>
                {hidden.map((g) => (
                  <li key={g.id}>
                    <span>{g.name}</span>
                    <span className="games-hidden-source">{SOURCE_NAMES[g.source]}</span>
                    <button className="btn" onClick={() => void setHidden(g, false)}>
                      <Eye size={13} /> Show
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.game)} onClose={() => setMenu(null)} />}
      {launching && <LaunchAnimation key={launching.id} game={launching} onDone={endLaunch} />}
    </div>
  )
}

function GameCard({ game: g, now, starting, onPlay, onMenu }: { game: Game; now: Date; starting: boolean; onPlay: () => void; onMenu: (e: MouseEvent) => void }) {
  const [artFailed, setArtFailed] = useState(false)
  const art = g.art && !artFailed ? g.art : null
  return (
    <div className={`game-card ${g.running ? 'running' : ''}`} onContextMenu={onMenu} onDoubleClick={onPlay} data-game={g.id}>
      <div className="game-art">
        {art ? (
          <img src={art} alt="" draggable={false} onError={() => setArtFailed(true)} />
        ) : g.icon ? (
          <img className="game-icon" src={g.icon} alt="" draggable={false} />
        ) : (
          <span className="game-letter">{g.name.slice(0, 1).toUpperCase()}</span>
        )}
        {g.running && <span className="game-playing">Playing now</span>}
      </div>
      <div className="game-info">
        <div className="game-name" title={g.name}>
          {g.name}
        </div>
        <div className="game-meta">
          <span>{describePlayed(g.played)}</span>
          {g.playedWeek >= 60 && <span> · {describePlayed(g.playedWeek)} this week</span>}
        </div>
        <div className="game-meta faint">
          {SOURCE_NAMES[g.source]}
          {g.running ? ' · Running' : g.lastPlayed ? ` · ${describeLastPlayed(g.lastPlayed, now)}` : ''}
        </div>
      </div>
      <div className="game-actions">
        <button className="btn btn-primary" onClick={onPlay} disabled={starting || g.running} data-game-play>
          {starting ? <Loader2 size={14} className="spin" /> : <Play size={14} />} {g.running ? 'Playing' : starting ? 'Starting' : 'Play'}
        </button>
        <button className="icon-btn" onClick={onMenu} title="More" data-game-more>
          <MoreHorizontal size={15} />
        </button>
      </div>
    </div>
  )
}
