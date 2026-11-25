import { compactJson } from '@shared/claudeHelpers'
import type { ComicShelfItem } from '@shared/comics'
import { findGame } from '@shared/gameMatch'
import { sortGames, type Game, type GameSort, type GameSource } from '@shared/games'
import { loadRecords, winPercent } from '../gameStats'
import { MINI_GAME_IDS, openMiniGames, type MiniGameId } from '../../store/miniGames'
import { readComic } from '../../store/comics'
import { COMICS_TAB, openSpecialTab } from '../editorController'
import { num, pickOne, str, type Answer, type Args } from './common'

/** Screenshots, games, Hypixel SkyBlock and comics for Claude Desktop. */

// ---------- screenshots ----------

const PICTURE = /\.(png|jpe?g|webp|bmp|gif)$/i
const when = (ms: number): string => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

async function screenshotList(): Promise<{ path: string; name: string; modified: number }[]> {
  const { folder } = await window.api.snipSaveInfo()
  if (!folder) throw new Error('Orbit has no screenshots folder set.')
  const entries = await window.api.explorerList(folder).catch(() => [])
  return entries.filter((e) => !e.isDir && PICTURE.test(e.name)).sort((a, b) => b.modified - a.modified)
}

async function readPicture(path: string): Promise<string> {
  const reading = await window.api.snipRead(await window.api.readForConvert(path))
  return reading.text.trim()
}

async function findScreenshotsFor(args: Args): Promise<string> {
  const days = Math.min(365, Math.max(1, num(args.days, 7)))
  const since = Date.now() - days * 86_400_000
  let list = (await screenshotList()).filter((s) => s.modified >= since)
  const words = str(args.search).toLowerCase().split(/\s+/).filter(Boolean)
  const limit = Math.min(50, Math.max(1, num(args.limit, 15)))
  if (!words.length) {
    if (!list.length) return `No screenshots in the last ${days} days.`
    return list
      .slice(0, limit)
      .map((s) => `${when(s.modified)}: ${s.path}`)
      .join('\n')
  }
  // Searching reads the words in each picture (newest first, up to 30 of them).
  list = list.slice(0, 30)
  const hits: string[] = []
  for (const s of list) {
    const text = await readPicture(s.path).catch(() => '')
    const lower = text.toLowerCase()
    if (words.every((w) => lower.includes(w) || s.name.toLowerCase().includes(w))) hits.push(`${when(s.modified)}: ${s.path}\n  “${text.replace(/\s+/g, ' ').slice(0, 200)}”`)
    if (hits.length >= limit) break
  }
  return hits.length ? hits.join('\n') : `None of the ${list.length} newest screenshots from the last ${days} days have “${str(args.search)}” in them.`
}

async function readScreenshotFor(args: Args): Promise<string> {
  let path = str(args.path)
  if (!path || path === 'latest') {
    const newest = (await screenshotList())[0]
    if (!newest) throw new Error('There are no screenshots yet.')
    path = newest.path
  }
  const text = await readPicture(path)
  return text ? `The words in ${path}:\n\n${text.slice(0, 8000)}` : `Orbit couldn’t find any words in ${path}.`
}

// ---------- games ----------

const hours = (s: number): string => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`)

const LAUNCHERS: Record<GameSource, string> = { steam: 'Steam', epic: 'Epic Games', roblox: 'Roblox', app: 'app', added: 'added by you' }
const SOURCE_WORDS: Record<string, GameSource> = { steam: 'steam', epic: 'epic', 'epic games': 'epic', roblox: 'roblox', app: 'app', apps: 'app', 'mac app': 'app', added: 'added' }

/** One game as Claude reads it, with its id (to start exactly that one). */
function gameLine(g: Game): string {
  const bits = [g.running ? 'playing now' : '', `${hours(g.played)} in all`, g.playedWeek ? `${hours(g.playedWeek)} this week` : '', g.lastPlayed ? `last played ${when(g.lastPlayed)}` : 'never played in Orbit', g.hidden ? 'hidden on the Games page' : '']
  return `${g.name} [${LAUNCHERS[g.source]}] (id ${g.id}): ${bits.filter(Boolean).join(', ')}`
}

async function gamesFor(args: Args): Promise<string> {
  const { games, steam, epic } = await window.api.gamesList(args.rescan === true)
  const source = SOURCE_WORDS[str(args.launcher).toLowerCase().trim()]
  if (str(args.launcher) && !source) throw new Error('The launcher has to be steam, epic, roblox, app or added.')
  const by: GameSort = args.sort === 'most' || args.sort === 'name' ? args.sort : 'recent'
  const limit = Math.min(500, Math.max(1, num(args.limit, 100)))
  const list = sortGames(
    games.filter((g) => (args.hidden === true || !g.hidden) && (!source || g.source === source)),
    by
  )
  const notes = [!steam ? 'Steam isn’t installed on this computer.' : '', !epic ? 'The Epic Games Launcher isn’t installed on this computer.' : ''].filter(Boolean)
  const hiddenCount = games.filter((g) => g.hidden).length
  if (!list.length) return [source ? `No ${LAUNCHERS[source]} games found.` : 'No games found on this computer.', ...notes, 'Games installed since Orbit last looked show up with rescan: true. Any other game can be added on the Games page (Add a game).'].join(' ')
  const week = games.reduce((sum, g) => sum + g.playedWeek, 0)
  const head = `${list.length} game${list.length === 1 ? '' : 's'}${source ? ` from ${LAUNCHERS[source]}` : ''}, ${by === 'recent' ? 'last played first' : by === 'most' ? 'most played first' : 'A to Z'} (playing now always first). ${hours(week)} played this week in all.${hiddenCount && args.hidden !== true ? ` ${hiddenCount} hidden on the Games page (hidden: true shows them).` : ''}`
  const lines = list.slice(0, limit).map(gameLine)
  if (list.length > limit) lines.push(`…and ${list.length - limit} more.`)
  return [[head, ...notes].join(' '), '', ...lines].join('\n')
}

/** The list of names, for asking which one. */
const nameList = (games: Game[]): string => games.map((g) => `${g.name} [${LAUNCHERS[g.source]}] (id ${g.id})`).join('; ')

/** The game Claude means, or a clear message (never a guess): by id from a list, or by name. */
async function theGame(args: Args): Promise<Game> {
  const { games } = await window.api.gamesList(false)
  const want = str(args.id).trim() || str(args.game).trim()
  if (!want) throw new Error('Say which game (its name, or its id from list_games or search_games).')
  let m = findGame(games, want)
  if (m.kind === 'none' && !m.close.length) {
    // Maybe it was installed since Orbit last looked.
    const fresh = await window.api.gamesList(true)
    m = findGame(fresh.games, want)
  }
  if (m.kind === 'one') return m.game
  if (m.kind === 'several') throw new Error(`More than one game fits “${want}”: ${nameList(m.games)}. Ask the user which one, then use its id. Nothing was started.`)
  if (m.close.length) throw new Error(`There’s no game called “${want}”, so nothing was started. Did they mean ${nameList(m.close)}? Check with the user, then use the id.`)
  throw new Error(`There’s no game called “${want}” on the Games page, so nothing was started. If it’s installed, it can be added on the Games page (Add a game).`)
}

async function searchGamesFor(args: Args): Promise<string> {
  const want = str(args.query).trim()
  if (!want) throw new Error('Say what to look for.')
  const { games } = await window.api.gamesList(false)
  const m = findGame(games, want)
  if (m.kind === 'one') return `One game fits “${want}”${m.how === 'initials' ? ' (by its initials)' : ''}:\n${gameLine(m.game)}`
  if (m.kind === 'several') return `${m.games.length} games fit “${want}” equally well, so ask which:\n${m.games.map(gameLine).join('\n')}`
  if (m.close.length) return `No game is called “${want}”. The closest (not a sure match):\n${m.close.map(gameLine).join('\n')}`
  return `No game like “${want}” on the Games page.`
}

async function playGameFor(args: Args): Promise<string> {
  const g = await theGame(args)
  if (g.running) return `${g.name} is already running.`
  const problem = await window.api.gamesPlay(g.id)
  if (problem) throw new Error(problem)
  const via = g.source === 'steam' ? ' through Steam' : g.source === 'epic' ? ' through the Epic Games Launcher' : ''
  return `Starting ${g.name}${via}. It can take a moment to open.`
}

async function hideGameFor(args: Args): Promise<string> {
  const g = await theGame(args)
  const hide = args.hidden !== false
  if (g.hidden === hide) return `${g.name} is already ${hide ? 'hidden' : 'shown'} on the Games page.`
  await window.api.gamesSetHidden(g.id, hide)
  return hide ? `Hid ${g.name} from the Games page (it can still be started by its whole name).` : `${g.name} is back on the Games page.`
}

async function showGameFolderFor(args: Args): Promise<string> {
  const g = await theGame(args)
  await window.api.gamesReveal(g.id)
  return `Showed where ${g.name} is installed (${g.path}).`
}

const MINI_NAMES: Record<MiniGameId, string> = {
  sudoku: 'Sudoku',
  minesweeper: 'Minesweeper',
  nonogram: 'Nonogram',
  jigsaw: 'Jigsaw',
  wordle: 'Wordle',
  wordsearch: 'Word search',
  hangman: 'Hangman',
  solitaire: 'Solitaire',
  blackjack: 'Blackjack',
  g2048: '2048',
  breakout: 'Breakout',
  chess: 'Chess'
}

function miniStatsFor(): string {
  const records = Object.entries(loadRecords())
  if (!records.length) return `No mini games played yet. There’s ${Object.values(MINI_NAMES).join(', ')}.`
  return records
    .map(([id, r]) => {
      const [game, way] = id.split(':')
      const name = MINI_NAMES[game as MiniGameId] ?? game
      return `${name}${way ? ` (${way})` : ''}: ${r.played} played, ${r.won} won (${winPercent(r)}%), streak ${r.streak}, best streak ${r.bestStreak}${r.bestTime !== undefined ? `, best time ${Math.floor(r.bestTime / 60)}:${String(Math.round(r.bestTime % 60)).padStart(2, '0')}` : ''}`
    })
    .join('\n')
}

function openMiniGameFor(args: Args): string {
  if (!str(args.game)) {
    openMiniGames(null)
    return 'Opened Mini games.'
  }
  const id = pickOne(MINI_GAME_IDS, str(args.game), (g) => MINI_NAMES[g], 'mini game')
  openMiniGames(id)
  return `Opened ${MINI_NAMES[id]} in Orbit.`
}

// ---------- Hypixel SkyBlock ----------

async function skyblockProfileFor(): Promise<string> {
  const view = await window.api.skyblockProfileView()
  if (!view) throw new Error('SkyBlock isn’t set up in Orbit yet (the SkyBlock page asks for the Minecraft name).')
  return compactJson(view, 24_000)
}

async function skyblockGoalsFor(): Promise<string> {
  return compactJson(await window.api.skyblockGoalsState(), 20_000)
}

async function skyblockSessionsFor(args: Args): Promise<string> {
  const list = (await window.api.skyblockSessions()).slice(0, Math.min(50, num(args.limit, 10)))
  if (!list.length) return 'No SkyBlock play sessions saved yet.'
  return compactJson(list, 20_000)
}

// ---------- comics ----------

const issueNumber = (title: string): number => {
  const m = /(\d+(?:\.\d+)?)(?!.*\d)/.exec(title)
  return m ? Number(m[1]) : 0
}
const seriesOf = (title: string): string =>
  title
    .replace(/[#(]?\s*\d+(?:\.\d+)?\)?\s*$/, '')
    .replace(/\s*(vol(ume)?\.?|issue|no\.?|chapter|ch\.?|part|book)\s*$/i, '')
    .trim()

const comicLine = (b: ComicShelfItem): string => {
  const p = b.progress
  const where = p?.finished ? 'finished' : p ? `on page ${p.page + 1}${b.pageCount ? ` of ${b.pageCount}` : ''}` : 'not started'
  return `${b.title}: ${where}${b.lastRead ? `, last read ${when(b.lastRead)}` : ''}`
}

async function comicsFor(): Promise<string> {
  const { books, pagesToday } = await window.api.comicsShelf()
  if (!books.length) return 'There are no comics on the shelf.'
  const sorted = [...books].sort((a, b) => (b.lastRead || 0) - (a.lastRead || 0))
  return `${pagesToday} pages read today.\n${sorted.map(comicLine).join('\n')}`
}

function openComic(b: ComicShelfItem): void {
  readComic(b.id)
  openSpecialTab(COMICS_TAB)
}

async function openComicFor(args: Args): Promise<string> {
  const { books } = await window.api.comicsShelf()
  const b = pickOne(books, str(args.comic), (x) => x.title, 'comic')
  openComic(b)
  return `Opened ${b.title}${b.progress && !b.progress.finished ? ` (it carries on from page ${b.progress.page + 1})` : ''}.`
}

async function nextComicFor(args: Args): Promise<string> {
  const { books } = await window.api.comicsShelf()
  if (!books.length) throw new Error('There are no comics on the shelf.')
  let series = str(args.series) ? seriesOf(pickOne(books, str(args.series), (x) => x.title, 'comic').title) : ''
  if (!series) {
    const last = [...books].filter((b) => b.lastRead).sort((a, b) => b.lastRead - a.lastRead)[0]
    if (!last) throw new Error('No comic has been read yet. Say which one (series).')
    if (last.progress && !last.progress.finished) {
      openComic(last)
      return `They’re part way through ${last.title} (page ${last.progress.page + 1}), so opened that.`
    }
    series = seriesOf(last.title)
  }
  const inSeries = books.filter((b) => seriesOf(b.title).toLowerCase() === series.toLowerCase()).sort((a, b) => issueNumber(a.title) - issueNumber(b.title))
  const next = inSeries.find((b) => !b.progress?.finished)
  if (!next) return `They’ve finished every ${series} on the shelf.`
  openComic(next)
  return `Opened ${next.title}, the next one in ${series} they haven’t finished.`
}

export const FUN_ANSWERS: Record<string, Answer> = {
  find_screenshots: findScreenshotsFor,
  read_screenshot: readScreenshotFor,
  list_games: gamesFor,
  search_games: searchGamesFor,
  play_game: playGameFor,
  hide_game: hideGameFor,
  show_game_folder: showGameFolderFor,
  mini_game_stats: miniStatsFor,
  open_mini_game: openMiniGameFor,
  skyblock_profile: skyblockProfileFor,
  skyblock_goals: skyblockGoalsFor,
  skyblock_sessions: skyblockSessionsFor,
  list_comics: comicsFor,
  open_comic: openComicFor,
  next_comic: nextComicFor
}
