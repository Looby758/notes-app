import { cardsForClaude, CARD_COLUMNS, NOT_READY, parsePullRef } from '@shared/claudeDesktop'
import {
  calendarText,
  cleanFolder,
  cleanNoteName,
  countdownsText,
  downloadsText,
  drivesText,
  eventLines,
  findNotePath,
  flashcardLines,
  flashcardsText,
  isInside,
  artistSeeds,
  matchSongs,
  noteName,
  pickSong,
  songLines,
  taggedText,
  type CalendarLine,
  type CardWithProgress
} from '@shared/claudeFormat'
import { TAG_COLOURS, type TagColour } from '@shared/fileTags'
import type { BoardColumn, BoardItem } from '@shared/appStudio'
import { addItem, linkPull, moveItem, useAppBoard } from '../store/appBoard'
import { useAppStudio } from '../store/appStudio'
import { useTerminals } from '../store/terminals'
import { itemsByDay, searchNotes, useNoteIndex } from '../store/noteIndex'
import { useVault } from '../store/vault'
import { useFlashcards } from '../store/flashcards'
import { ensureMoney, useMoney } from '../store/money'
import { setPrefs, usePrefs } from '../store/prefs'
import { musicControl, musicSeek, musicSetVolume, setSleepTimer, useMusic } from '../store/music'
import { addToQueue, clearUpNext, loadLocalLibrary, localUpNext, playLocal, playNext, removeFromQueue, setLocalModes, useLocalMusic } from '../store/localMusic'
import { addEvent, editNote } from './daily'
import { addToPlaylist as addSongsToPlaylist, createPlaylist, deletePlaylist, moveInPlaylist, rateSong, removeFromPlaylist, renamePlaylist, startMusicData, tagSongs, toggleLike, useMusicData } from '../store/musicData'
import { deleteSongs, editSongs } from '../store/musicFiles'
import { IS_MAC } from '@shared/platform'
import { onMusicLinkDone, saveMp3 } from '../store/musicLink'
import { countdownId, isDate, MAX_COUNTDOWNS, type CountdownKind } from '@shared/countdown'
import { allTags, likedSongs, mostPlayed, playlistSongs, recentlyAdded, songsByPath } from '@shared/musicLibrary'
import { canTag, type LocalSong, type SongTagPatch } from '@shared/localMusic'
import type { FoundTrack } from '@shared/songSearch'
import { addDays, dayKey, fromDayKey } from './dates'
import { moneyContext } from './askContext'
import { lockedFolderOf } from './lock/folders'
import { isLockedText } from './lock/crypto'

/**
 * Orbit's window answering Claude Desktop (main/claudeDesktop.ts asks; main/claudeTools.ts lists
 * the questions). The window is where your notes, calendar, board and the rest are loaded, so the
 * answers come from the same code the pages use. Locked notes and anything in a locked folder are
 * never read or changed.
 */

type Args = Record<string, unknown>
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

function needNotes(): void {
  if (!useVault.getState().vault) throw new Error(NOT_READY)
}

const locked = (path: string): boolean => !!lockedFolderOf(path)
const notePaths = (): string[] => [...useNoteIndex.getState().notes.keys()].filter((p) => !locked(p))

function findNote(want: string): string {
  const path = findNotePath(notePaths(), want)
  if (path) return path
  if (findNotePath([...useNoteIndex.getState().notes.keys()], want)) throw new Error('That note is in a locked folder, so Claude can’t see it.')
  throw new Error(`There’s no note called “${want}” (or more than one has that name: use its full path from search_notes).`)
}

async function readText(path: string): Promise<string> {
  const text = await window.api.readNote(path)
  if (isLockedText(text)) throw new Error('That note is locked, so Claude can’t read it.')
  return text
}

/** Makes a note (adding " 2", " 3"… to the name when one's already there) without opening it. */
async function makeNote(folder: string, title: string, content: string): Promise<string> {
  needNotes()
  if (folder && locked(folder)) throw new Error('That folder is locked, so Claude can’t add notes to it.')
  const base = cleanNoteName(title)
  for (let n = 1; n < 50; n++) {
    const path = `${folder ? `${folder}/` : ''}${n === 1 ? base : `${base} ${n}`}.md`
    let created: string
    try {
      created = await window.api.createNoteAt(path)
    } catch (err) {
      if (/already exists/i.test(String((err as Error)?.message ?? err))) continue
      throw err
    }
    if (content) await window.api.writeNote(created, content)
    await useVault.getState().refresh([created])
    return created
  }
  throw new Error('There are already too many notes with that name.')
}

// ---------- App Studio ----------

function appsList(): string {
  const info = useAppStudio.getState().info
  const seen = new Set<string>()
  const apps = useTerminals
    .getState()
    .projects.filter((p) => !seen.has(p.folder) && seen.add(p.folder))
    .map((p) => ({ name: p.name, folder: p.folder, repo: info[p.folder]?.repo }))
  return JSON.stringify(apps)
}

function board(): BoardItem[] {
  const s = useAppBoard.getState()
  if (!s.loaded) throw new Error(NOT_READY)
  return s.items
}

function boardList(args: Args): string {
  const cards = cardsForClaude(board(), { app: str(args.app) || undefined, includeDone: args.includeDone === true })
  if (!cards.length) return args.app ? `No open cards for “${str(args.app)}”.` : 'No open cards on the Ideas & bugs board.'
  return cards
    .map((c) => [`id: ${c.id}`, `app: ${c.app}`, `${c.kind}: ${c.title}`, `column: ${c.column}`, c.pull && `pull request: ${c.pull}`, c.issue && `from bug report: ${c.issue}`, c.details && `details:\n${c.details}`].filter(Boolean).join('\n'))
    .join('\n\n---\n\n')
}

function boardUpdate(args: Args): string {
  const item = board().find((i) => i.id === str(args.id))
  if (!item) throw new Error(`There’s no card with the id “${str(args.id)}”. Use get_board for the ids.`)
  const said: string[] = []
  if (args.pull) {
    const ref = parsePullRef(str(args.pull), item.app.includes('/') ? item.app : undefined)
    if (!ref) throw new Error('Write the pull request as owner/name#12 (or its GitHub address).')
    const [repo, number] = ref.split('#')
    linkPull(repo, Number(number), item.id)
    said.push(`linked ${ref}`)
  }
  if (args.column) {
    const column = str(args.column) as BoardColumn
    if (!CARD_COLUMNS.includes(column)) throw new Error('The column has to be ideas, building, testing or done.')
    moveItem(item.id, column)
    said.push(`moved it to ${column}`)
  }
  return `“${item.title}”: ${said.join(' and ')}.`
}

function boardAdd(args: Args): string {
  board()
  const kind = args.kind === 'bug' ? 'bug' : 'idea'
  const item = addItem(str(args.app), kind, str(args.title), str(args.details))
  return `Added the ${kind} “${item.title}” to Ideas & bugs (id ${item.id}).`
}

// ---------- Notes ----------

function searchNotesFor(args: Args): string {
  needNotes()
  const hits = searchNotes(str(args.query))
    .filter((h) => !locked(h.path))
    .slice(0, num(args.limit, 15))
  if (!hits.length) return `No notes match “${str(args.query)}”.`
  return hits.map((h) => `${h.path}\n  ${h.snippet}`).join('\n')
}

async function readNoteFor(args: Args): Promise<string> {
  needNotes()
  const path = findNote(str(args.path))
  return `${path}\n\n${await readText(path)}`
}

function listNotesFor(args: Args): string {
  needNotes()
  const folder = str(args.folder)
  const list = notePaths()
    .filter((p) => isInside(p, folder))
    .sort((a, b) => a.localeCompare(b))
  if (!list.length) return folder ? `No notes in “${folder}”.` : 'No notes yet.'
  const limit = num(args.limit, 200)
  return list.slice(0, limit).join('\n') + (list.length > limit ? `\n…and ${list.length - limit} more.` : '')
}

async function createNoteFor(args: Args): Promise<string> {
  const path = await makeNote(cleanFolder(str(args.folder)), str(args.title), str(args.content))
  return `Made the note ${path}.`
}

async function addToNoteFor(args: Args): Promise<string> {
  needNotes()
  const path = findNote(str(args.path))
  const add = str(args.text).trim()
  await editNote(path, (text) => `${text.replace(/\s*$/, '')}${text.trim() ? '\n\n' : ''}${add}\n`, { undo: `Claude added to “${noteName(path)}”` })
  await useVault.getState().refresh([path])
  return `Added to ${path}.`
}

async function editNoteFor(args: Args): Promise<string> {
  needNotes()
  const path = findNote(str(args.path))
  const find = str(args.find)
  const replace = str(args.replace)
  let count = 0
  await editNote(
    path,
    (text) => {
      if (args.whole === true) return replace
      if (!find) throw new Error('Say which text to change (find), or set whole to replace the whole note.')
      count = text.split(find).length - 1
      if (count === 0) throw new Error(`“${find.slice(0, 80)}” isn’t in that note. Read it again with read_note and copy the text exactly.`)
      if (count > 1 && args.all !== true) throw new Error(`“${find.slice(0, 80)}” is in that note ${count} times. Give more of the text around it, or set all to change every one.`)
      return text.split(find).join(replace)
    },
    { undo: `Claude changed “${noteName(path)}”` }
  )
  await useVault.getState().refresh([path])
  return args.whole === true ? `Replaced the text of ${path}. Ctrl+Z in Orbit undoes it.` : `Changed ${count} place(s) in ${path}. Ctrl+Z in Orbit undoes it.`
}

async function renameNoteFor(args: Args): Promise<string> {
  needNotes()
  const path = findNote(str(args.path))
  const name = cleanNoteName(str(args.name))
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
  const next = `${parent}${name}.md`
  if (useNoteIndex.getState().notes.has(next)) throw new Error(`There’s already a note called “${name}” there.`)
  await useVault.getState().rename(path, `${name}.md`, true)
  if (!useNoteIndex.getState().notes.has(next)) throw new Error('Orbit couldn’t rename it.')
  return `Renamed ${path} to ${next}. Links to it were updated.`
}

async function moveNoteFor(args: Args): Promise<string> {
  needNotes()
  const path = findNote(str(args.path))
  const folder = cleanFolder(str(args.folder))
  if (folder && locked(`${folder}/x.md`)) throw new Error('That folder is locked, so Claude can’t move notes into it.')
  if (folder) await window.api.createFolder(folder).catch(() => undefined)
  const next = `${folder ? `${folder}/` : ''}${path.split('/').pop()}`
  if (next === path) return 'It’s already in that folder.'
  if (useNoteIndex.getState().notes.has(next)) throw new Error('There’s already a note with that name in that folder.')
  await useVault.getState().move(path, folder, true)
  if (!useNoteIndex.getState().notes.has(next)) throw new Error('Orbit couldn’t move it.')
  return `Moved it to ${next}. Links to it were updated.`
}

async function deleteNoteFor(args: Args): Promise<string> {
  needNotes()
  const path = findNote(str(args.path))
  await useVault.getState().trash(path)
  if (useNoteIndex.getState().notes.has(path)) throw new Error('Orbit couldn’t delete it.')
  return `Deleted ${path}. It’s in Orbit’s bin, and Ctrl+Z (or the bin) brings it back.`
}

// ---------- Calendar ----------

async function calendarFor(args: Args): Promise<string> {
  needNotes()
  const today = dayKey(new Date())
  const from = str(args.from) || today
  const fromDate = fromDayKey(from)
  if (!fromDate) throw new Error('The first day has to be a date like 2026-11-25.')
  const to = str(args.to) || dayKey(addDays(fromDate, 7))
  const lines: CalendarLine[] = []
  for (const [, items] of itemsByDay(from, to)) {
    for (const i of items) {
      if (i.kind === 'daily' || locked(i.path)) continue
      lines.push({ date: i.date, start: i.start, end: i.end, title: i.title, done: i.done, from: i.kind === 'due' || i.due ? `Due (${noteName(i.path)})` : `Orbit (${noteName(i.path)})` })
    }
  }
  try {
    const end = addDays(fromDayKey(to) ?? fromDate, 1)
    const { events } = await window.api.fetchCalendarEvents(fromDate.toISOString(), end.toISOString())
    lines.push(...eventLines(events))
  } catch {
    // No connected calendars (or offline): Orbit's own events are still there.
  }
  return calendarText(lines, from, to)
}

async function addEventFor(args: Args): Promise<string> {
  needNotes()
  const date = fromDayKey(str(args.date))
  if (!date) throw new Error('The date has to be like 2026-11-25.')
  const title = str(args.title).trim()
  const start = str(args.start) || undefined
  const end = start ? str(args.end) || undefined : undefined
  await addEvent(date, title, start, end)
  return `Added “${title}” on ${str(args.date)}${start ? ` at ${start}${end ? `–${end}` : ''}` : ' (all day)'} to Orbit’s calendar.`
}

const countdownsFor = (): string => countdownsText(usePrefs.getState().prefs.countdowns, new Date())

const KINDS: CountdownKind[] = ['season', 'game', 'trip', 'birthday', 'event', 'other']

function addCountdownFor(args: Args): string {
  const list = usePrefs.getState().prefs.countdowns
  if (list.length >= MAX_COUNTDOWNS) throw new Error(`There are already ${MAX_COUNTDOWNS} countdowns, the most Orbit keeps. Delete one on the Countdowns page first.`)
  const title = str(args.title).trim().slice(0, 80)
  const date = str(args.date)
  if (!title) throw new Error('Say what it’s counting down to.')
  if (!isDate(date)) throw new Error('The date has to be a real day, like 2026-12-20.')
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(str(args.time)) ? str(args.time) : ''
  const kind = KINDS.includes(str(args.kind) as CountdownKind) ? (str(args.kind) as CountdownKind) : args.yearly === true ? 'birthday' : 'event'
  const yearly = args.yearly === true
  setPrefs({ countdowns: [...list, { id: countdownId(), title, kind, date, time, yearly, created: Date.now() }] })
  return `Added the countdown “${title}” for ${date}${time ? ` at ${time}` : ''}${yearly ? ', every year' : ''}.\n\n${countdownsText(usePrefs.getState().prefs.countdowns.filter((c) => c.title === title), new Date())}`
}

// ---------- Money ----------

async function moneyFor(args: Args): Promise<string> {
  needNotes()
  await ensureMoney()
  return moneyContext(useMoney.getState(), dayKey(new Date()), str(args.question), 30_000) || 'Nothing in Money yet.'
}

// ---------- Flashcards ----------

function flashcardsFor(args: Args): string {
  needNotes()
  const progress = useFlashcards.getState().progress
  const folder = str(args.folder)
  const cards: CardWithProgress[] = []
  for (const [path, entry] of useNoteIndex.getState().notes) {
    if (locked(path) || !isInside(path, folder)) continue
    for (const c of entry.cards) cards.push({ path, question: c.question, answer: c.answer, progress: progress[c.id] })
  }
  return flashcardsText(cards, dayKey(new Date()), { struggling: args.struggling === true })
}

async function addFlashcardsFor(args: Args): Promise<string> {
  needNotes()
  const raw = Array.isArray(args.cards) ? (args.cards as { question?: unknown; answer?: unknown }[]) : []
  const lines = flashcardLines(raw.map((c) => ({ question: str(c?.question), answer: str(c?.answer) })))
  if (!lines.length) throw new Error('Give at least one card with a question and an answer.')
  const want = str(args.note)
  const existing = findNotePath(notePaths(), want)
  if (existing) {
    await editNote(existing, (text) => `${text.replace(/\s*$/, '')}${text.trim() ? '\n' : ''}${lines.join('\n')}\n`, { undo: `Claude added flashcards to “${noteName(existing)}”` })
    await useVault.getState().refresh([existing])
    return `Added ${lines.length} card(s) to ${existing}. They’re on the Flashcards page now.`
  }
  const parts = want.replace(/\\/g, '/').replace(/\.md$/i, '').split('/')
  const title = parts.pop() ?? 'Flashcards'
  const path = await makeNote(cleanFolder(parts.join('/')), title, `${lines.join('\n')}\n`)
  return `Made ${path} with ${lines.length} card(s). They’re on the Flashcards page now.`
}

// ---------- Files ----------

async function taggedFor(args: Args): Promise<string> {
  const colour = str(args.colour) as TagColour
  if (!TAG_COLOURS.includes(colour)) throw new Error(`The colour has to be one of ${TAG_COLOURS.join(', ')}.`)
  const days = typeof args.changed_within_days === 'number' ? args.changed_within_days : undefined
  return taggedText(await window.api.explorerTagged(colour), colour, days, Date.now())
}

async function searchFilesFor(args: Args): Promise<string> {
  const { entries, status } = await window.api.explorerSearchPc(str(args.query), false)
  if (status.state === 'off') return 'Whole PC search is switched off. It can be switched on in Orbit’s Files tab.'
  if (!entries.length) return status.state === 'ready' ? `No files called “${str(args.query)}”.` : 'Whole PC search is still making its list of files. Try again in a minute.'
  return entries
    .slice(0, 50)
    .map((e) => `${e.path}${e.isDir ? ' (folder)' : ''}`)
    .join('\n')
}

// ---------- Music ----------

function nowPlayingFor(): string {
  const { state } = useMusic.getState()
  if (!state?.track) return 'Nothing is playing in Orbit right now.'
  const t = state.track
  const next = state.source === 'local' ? localUpNext().slice(0, 5) : []
  return [
    `${state.playing ? 'Playing' : 'Paused'}: ${t.name} by ${t.artist}${t.album ? ` (${t.album})` : ''}${state.source === 'local' ? ', from your music folder' : ', on Spotify'}`,
    next.length ? `Up next: ${next.map((s) => `${s.title} by ${s.artist}`).join('; ')}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

async function controlMusicFor(args: Args): Promise<string> {
  const action = str(args.action)
  const { state } = useMusic.getState()
  const playing = !!state?.playing
  if (action === 'play' && playing) return 'It’s already playing.'
  if (action === 'pause' && !playing) return 'Nothing is playing.'
  const done = await musicControl(action === 'play' ? 'toggle' : action === 'pause' ? 'pause' : action === 'next' ? 'next' : 'previous')
  if (!done) throw new Error(useMusic.getState().error ?? 'Orbit’s music player couldn’t do that. Is a song loaded?')
  return action === 'play' ? 'Playing.' : action === 'pause' ? 'Paused.' : action === 'next' ? 'Skipped to the next song.' : 'Went back a song.'
}

async function library(): Promise<LocalSong[]> {
  if (!useLocalMusic.getState().library) await loadLocalLibrary()
  const songs = useLocalMusic.getState().library?.songs ?? []
  if (!songs.length) throw new Error('Orbit has no music folder set (or it’s empty). Choose one on the Music page first.')
  return songs
}

async function musicData(): Promise<ReturnType<typeof useMusicData.getState>['data']> {
  startMusicData()
  for (let i = 0; i < 40 && !useMusicData.getState().loaded; i++) await new Promise((r) => setTimeout(r, 50))
  return useMusicData.getState().data
}

const LIKED = /^(liked|liked songs|favourites|favorites)$/i

/** A playlist by name (any case), or null. */
async function findPlaylist(name: string): Promise<{ id: string; name: string; songs: string[] } | null> {
  const want = name.trim().toLowerCase()
  const lists = (await musicData()).playlists
  return lists.find((p) => p.name.trim().toLowerCase() === want) ?? (lists.filter((p) => p.name.toLowerCase().includes(want)).length === 1 ? lists.find((p) => p.name.toLowerCase().includes(want))! : null)
}

async function playlistSongsFor(name: string): Promise<{ name: string; songs: LocalSong[] }> {
  const songs = await library()
  const data = await musicData()
  const byPath = songsByPath(songs)
  if (LIKED.test(name.trim())) return { name: 'Liked songs', songs: likedSongs(data, byPath) }
  const p = await findPlaylist(name)
  if (!p) throw new Error(`There’s no playlist called “${name}”. The playlists are: ${data.playlists.map((l) => l.name).join(', ') || 'none yet'}.`)
  const list = data.playlists.find((l) => l.id === p.id)!
  return { name: p.name, songs: playlistSongs(list, byPath).flatMap((x) => (x.song ? [x.song] : [])) }
}

const LOOPS = { off: 'off', song: 'track', all: 'context' } as const

async function playMusicFor(args: Args): Promise<string> {
  const shuffle = typeof args.shuffle === 'boolean' ? args.shuffle : undefined
  const loop = str(args.loop) in LOOPS ? LOOPS[str(args.loop) as keyof typeof LOOPS] : undefined
  const songName = str(args.song)
  let said: string
  if (str(args.playlist)) {
    const { name, songs } = await playlistSongsFor(str(args.playlist))
    if (!songs.length) return `“${name}” has no songs in it yet.`
    const at = songName ? songs.indexOf(pickSong(songs, songName) as LocalSong) : 0
    if (at < 0) throw new Error(`“${songName}” isn’t in the playlist “${name}”. Use get_playlist to see its songs.`)
    // Shuffle is set first, so the chosen song plays first and the rest follow (in order, or shuffled).
    if (shuffle !== undefined) useLocalMusic.setState({ shuffle })
    if (shuffle && !songName) await playLocal(songs, 'shuffle')
    else await playLocal(songs, at)
    said = `Playing ${songName ? `“${songs[at].title}” from` : 'the playlist'} “${name}”${songName ? ', then the rest of the playlist' : ''}${useLocalMusic.getState().shuffle ? ', shuffled' : ''}`
  } else if (songName) {
    const song = pickSong(await library(), songName)
    if (!song) throw new Error(`Couldn’t find “${songName}” in their music. Use find_songs to check the name, or download_song to get it.`)
    useLocalMusic.setState({ shuffle: false })
    await playLocal([song], 0)
    said = `Playing “${song.title}” by ${song.artist}`
  } else if (str(args.search)) {
    const found = matchSongs(await library(), str(args.search))
    if (!found.length) return `None of the songs match “${str(args.search)}”. Try an artist, an album or a genre.`
    if (shuffle === false) {
      useLocalMusic.setState({ shuffle: false })
      await playLocal(found.slice(0, 200), 0)
    } else await playLocal(found.slice(0, 200), 'shuffle')
    said = `Playing ${found.length} song(s) matching “${str(args.search)}”${shuffle === false ? '' : ', shuffled'}`
  } else {
    // Only changing shuffle or loop on what's playing.
    if (shuffle === undefined && !loop) throw new Error('Say what to play: a song, a playlist or some words to match.')
    said = 'Changed how it plays'
  }
  if (shuffle !== undefined || loop) setLocalModes({ shuffle: str(args.playlist) || songName || str(args.search) ? undefined : shuffle, repeat: loop })
  const r = useLocalMusic.getState().repeat
  return `${said}${r === 'track' ? ', looping this song' : r === 'context' ? ', looping the list' : ''}.`
}

async function listPlaylistsFor(): Promise<string> {
  const data = await musicData()
  const lines = data.playlists.map((p) => `${p.name}: ${p.songs.length} song(s)`)
  lines.push(`Liked songs: ${Object.keys(data.liked).length} song(s)`)
  return lines.join('\n')
}

async function getPlaylistFor(args: Args): Promise<string> {
  const { name, songs } = await playlistSongsFor(str(args.playlist))
  return songs.length ? `${name} (${songs.length} songs):\n${songs.map((s, i) => `${i + 1}. ${songLines([s])}`).join('\n')}` : `“${name}” has no songs in it yet.`
}

async function findSongsFor(args: Args): Promise<string> {
  const query = str(args.query)
  const mine = matchSongs(useLocalMusic.getState().library?.songs ?? (await library().catch(() => [])), query).slice(0, 5)
  let online: FoundTrack[] = []
  try {
    online = (await window.api.songSearch(query)).slice(0, 8)
  } catch {
    // Offline: what's here is still known.
  }
  return [
    mine.length ? `Already in their music:\n${songLines(mine)}` : 'Not in their music yet.',
    online.length ? `Online:\n${online.map((t) => `${t.title} by ${t.artist}${t.album ? ` (${t.album}${t.year ? `, ${t.year}` : ''})` : ''}`).join('\n')}` : 'Nothing found online (or no internet).'
  ].join('\n\n')
}

async function suggestSongsFor(args: Args): Promise<string> {
  const { name, songs } = await playlistSongsFor(str(args.playlist))
  if (!songs.length) return `“${name}” has no songs to base suggestions on.`
  const have = new Set((await library()).map((s) => `${s.title}|${s.artist}`.toLowerCase()))
  const groups = await window.api.songDiscover(artistSeeds(songs))
  const lines: string[] = []
  for (const g of groups.sort((a, b) => b.weight - a.weight)) {
    const fresh = g.tracks.filter((t) => !have.has(`${t.title}|${t.artist}`.toLowerCase())).slice(0, 4)
    if (fresh.length) lines.push(`${g.because}:\n${fresh.map((t) => `  ${t.title} by ${t.artist}`).join('\n')}`)
    if (lines.length >= 8) break
  }
  return lines.length ? `Songs like “${name}” that they don’t have yet:\n\n${lines.join('\n\n')}` : 'Couldn’t find suggestions online right now. Suggest some yourself from the playlist’s songs.'
}

/** Songs Claude named, split into the ones in the music folder and the ones that aren't. */
async function pickSongs(names: unknown): Promise<{ found: LocalSong[]; missing: string[] }> {
  const songs = await library()
  const found: LocalSong[] = []
  const missing: string[] = []
  for (const n of Array.isArray(names) ? names : []) {
    const s = typeof n === 'string' ? pickSong(songs, n) : null
    if (s) found.push(s)
    else if (typeof n === 'string') missing.push(n)
  }
  return { found, missing }
}

const missingText = (missing: string[]): string => (missing.length ? `\nNot in their music (download them with download_song, or check the name): ${missing.join('; ')}` : '')

/** A playlist's id, made when it isn't there yet. */
async function playlistId(name: string): Promise<{ id: string; made: boolean; name: string }> {
  const p = await findPlaylist(name)
  if (p) return { id: p.id, made: false, name: p.name }
  const id = await createPlaylist(name.trim().slice(0, 100))
  if (!id) throw new Error('Orbit couldn’t make that playlist.')
  return { id, made: true, name: name.trim() }
}

async function createPlaylistFor(args: Args): Promise<string> {
  const name = str(args.name).trim()
  if (await findPlaylist(name).then((p) => p?.name.toLowerCase() === name.toLowerCase())) throw new Error(`There’s already a playlist called “${name}”. Use add_to_playlist to add to it.`)
  const { found, missing } = await pickSongs(args.songs)
  const id = await createPlaylist(name, found)
  if (!id) throw new Error('Orbit couldn’t make that playlist.')
  return `Made the playlist “${name}”${found.length ? ` with ${found.length} song(s)` : ''}.${missingText(missing)}`
}

async function addToPlaylistFor(args: Args): Promise<string> {
  const { found, missing } = await pickSongs(args.songs)
  if (!found.length) return `None of those are in their music yet.${missingText(missing)}`
  const p = await playlistId(str(args.playlist))
  await addSongsToPlaylist(p.id, found)
  return `${p.made ? `Made the playlist “${p.name}” and added` : `Added`} ${found.map((s) => `“${s.title}”`).join(', ')}${p.made ? '' : ` to “${p.name}”`}.${missingText(missing)}`
}

/** Waits for a download to finish (or gives up waiting, leaving it going). */
function finished(id: string, ms: number): Promise<{ stage: string; path?: string; error?: string; title?: string; artist?: string } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      off()
      resolve(null)
    }, ms)
    const off = onMusicLinkDone((p) => {
      if (p.id !== id) return
      clearTimeout(timer)
      off()
      resolve(p)
    })
  })
}

async function addDownloaded(path: string, playlist: string): Promise<string> {
  await loadLocalLibrary(true)
  const song = useLocalMusic.getState().library?.songs.find((s) => s.path === path)
  if (!song) return `It’s saved, but Orbit couldn’t find it in the music folder to add it to “${playlist}”.`
  const p = await playlistId(playlist)
  await addSongsToPlaylist(p.id, [song])
  return `${p.made ? `Made the playlist “${p.name}” and added it` : `Added it to “${p.name}”`}.`
}

async function downloadSongFor(args: Args): Promise<string> {
  const title = str(args.title).trim()
  const artist = str(args.artist).trim()
  const playlist = str(args.playlist).trim()
  const songs = await library().catch((err) => {
    if (useLocalMusic.getState().library) return []
    throw err
  })
  const already = pickSong(songs, `${title} by ${artist}`)
  if (already) {
    if (!playlist) return `“${already.title}” by ${already.artist} is already in their music, so it wasn’t downloaded again.`
    const p = await playlistId(playlist)
    await addSongsToPlaylist(p.id, [already])
    return `“${already.title}” is already in their music, so it wasn’t downloaded again. ${p.made ? `Made the playlist “${p.name}” and added it.` : `Added it to “${p.name}”.`}`
  }
  // The catalogue's details (album, cover), when it knows the song.
  let known: FoundTrack = { id: '', title, artist, album: '', year: '', genre: '', durationMs: 0 }
  try {
    const hits = await window.api.songSearch(`${artist} ${title}`)
    const match = hits.find((h) => h.title.toLowerCase() === title.toLowerCase() && h.artist.toLowerCase().includes(artist.toLowerCase().split(/[,&]/)[0].trim()))
    if (match) known = match
  } catch {
    // Not known: it's saved with the name and artist given.
  }
  const video = await window.api.songYouTube(artist, title)
  if (!video.exact) throw new Error(`Couldn’t find a YouTube video for “${title}” by ${artist}. Check the name, or try the Music page’s Search.`)
  const id = await saveMp3(video.url, known)
  if (!id) throw new Error('Orbit couldn’t start the download. Is a music folder set on the Music page?')
  const done = await finished(id, 75_000)
  if (!done) {
    // Still going: the playlist gets it when it finishes.
    if (playlist)
      void finished(id, 15 * 60_000).then((p) => {
        if (p?.stage === 'done' && p.path) void addDownloaded(p.path, playlist)
      })
    return `Downloading “${title}” by ${artist} from ${video.url}. It’s taking a while; it’ll be in their music${playlist ? ` and added to “${playlist}”` : ''} when it finishes.`
  }
  if (done.stage !== 'done' || !done.path) throw new Error(done.error ?? 'The download didn’t finish.')
  const added = playlist ? ` ${await addDownloaded(done.path, playlist)}` : ''
  const saved = done.title ? `“${done.title}” by ${done.artist || 'unknown artist'}` : `“${title}” by ${artist}`
  const differs = done.title && (done.title.toLowerCase() !== title.toLowerCase() || !(done.artist ?? '').toLowerCase().includes(artist.toLowerCase().split(/[,&]/)[0].trim()))
  return `Downloaded ${saved} (from ${video.url}) into their music as ${done.path}.${added}${differs ? `\nCareful: it was saved as ${saved}, not exactly “${title}” by ${artist}. If it’s the wrong song, remove it with remove_from_playlist and delete_songs, and tell the user.` : ''}`
}

// ---------- More music ----------

/** A playlist (not Liked) by name, with its songs and their positions. */
async function playlistFor(name: string): Promise<{ id: string; name: string; items: { song: LocalSong | null; path: string; position: number }[] }> {
  const p = await findPlaylist(name)
  const data = await musicData()
  if (!p) throw new Error(`There’s no playlist called “${name}”. The playlists are: ${data.playlists.map((l) => l.name).join(', ') || 'none yet'}.`)
  const list = data.playlists.find((l) => l.id === p.id)!
  return { id: p.id, name: p.name, items: playlistSongs(list, songsByPath(await library())) }
}

/** Positions (0-based) of the songs Claude named in a playlist: by name, or by number from get_playlist. */
function positionsOf(items: { song: LocalSong | null; position: number }[], names: unknown, numbers: unknown): { positions: number[]; missing: string[] } {
  const positions = new Set<number>()
  const missing: string[] = []
  for (const n of Array.isArray(numbers) ? numbers : []) if (typeof n === 'number' && n >= 1 && n <= items.length) positions.add(n - 1)
  const songs = items.flatMap((i) => (i.song ? [i.song] : []))
  for (const n of Array.isArray(names) ? names : []) {
    if (typeof n !== 'string') continue
    const song = pickSong(songs, n)
    const at = song ? items.filter((i) => i.song === song).map((i) => i.position) : []
    if (at.length) at.forEach((x) => positions.add(x))
    else missing.push(n)
  }
  return { positions: [...positions].sort((a, b) => a - b), missing }
}

async function removeFromPlaylistFor(args: Args): Promise<string> {
  const p = await playlistFor(str(args.playlist))
  const { positions, missing } = positionsOf(p.items, args.songs, args.numbers)
  if (!positions.length) throw new Error(`None of those are in “${p.name}”.${missing.length ? ` Not found: ${missing.join('; ')}.` : ''} Use get_playlist to see its songs and their numbers.`)
  const removed = positions.map((i) => p.items[i].song?.title ?? p.items[i].path)
  if (!(await removeFromPlaylist(p.id, positions))) throw new Error('Orbit couldn’t change the playlist.')
  return `Took ${removed.map((t) => `“${t}”`).join(', ')} out of “${p.name}”. Ctrl+Z in Orbit puts them back.${missing.length ? `\nNot in the playlist: ${missing.join('; ')}` : ''}`
}

async function moveInPlaylistFor(args: Args): Promise<string> {
  const p = await playlistFor(str(args.playlist))
  const { positions } = positionsOf(p.items, str(args.song) ? [str(args.song)] : [], typeof args.number === 'number' ? [args.number] : [])
  if (!positions.length) throw new Error(`That song isn’t in “${p.name}”.`)
  const to = Math.min(p.items.length, Math.max(1, num(args.to, 1))) - 1
  if (!(await moveInPlaylist(p.id, positions[0], to))) return 'It’s already there.'
  return `Moved “${p.items[positions[0]].song?.title ?? 'the song'}” to number ${to + 1} in “${p.name}”.`
}

async function renamePlaylistFor(args: Args): Promise<string> {
  const p = await playlistFor(str(args.playlist))
  const name = str(args.name).trim().slice(0, 100)
  if (!name) throw new Error('Give the new name.')
  if (!(await renamePlaylist(p.id, name))) return 'It already has that name.'
  return `Renamed “${p.name}” to “${name}”.`
}

async function deletePlaylistFor(args: Args): Promise<string> {
  const p = await playlistFor(str(args.playlist))
  if (!(await deletePlaylist(p.id))) throw new Error('Orbit couldn’t delete it.')
  return `Deleted the playlist “${p.name}” (the songs are still in their music). Ctrl+Z in Orbit brings it back.`
}

function queueFor(): string {
  const { queue, index, shuffle, repeat } = useLocalMusic.getState()
  if (!useMusic.getState().local || !queue.length) return nowPlayingFor()
  const now = queue[index]
  const next = queue.slice(index + 1)
  return [
    `Now: ${now ? `${now.title} by ${now.artist}` : 'nothing'}${useMusic.getState().state?.playing ? '' : ' (paused)'}`,
    `Shuffle ${shuffle ? 'on' : 'off'}, loop ${repeat === 'track' ? 'this song' : repeat === 'context' ? 'the list' : 'off'}`,
    next.length ? `Up next (${next.length}):\n${next.slice(0, 100).map((s, i) => `${i + 1}. ${s.title} by ${s.artist}`).join('\n')}${next.length > 100 ? `\n…and ${next.length - 100} more` : ''}` : 'Nothing up next.'
  ].join('\n')
}

async function queueSongsFor(args: Args): Promise<string> {
  const { found, missing } = await pickSongs(args.songs)
  if (!found.length) return `None of those are in their music.${missingText(missing)}`
  if (args.next === true) await playNext(found)
  else await addToQueue(found)
  return `${args.next === true ? 'Playing next' : 'Added to the end of Up next'}: ${found.map((s) => `“${s.title}”`).join(', ')}.${missingText(missing)}`
}

function removeFromQueueFor(args: Args): string {
  const { queue, index } = useLocalMusic.getState()
  if (args.all === true) {
    clearUpNext()
    return 'Cleared Up next (the song playing keeps going).'
  }
  const next = queue.slice(index + 1)
  let at = typeof args.number === 'number' ? args.number - 1 : -1
  if (at < 0 && str(args.song)) {
    const song = pickSong(next, str(args.song))
    at = song ? next.indexOf(song) : -1
  }
  if (at < 0 || at >= next.length) throw new Error('That song isn’t in Up next. Use get_queue to see it.')
  const title = next[at].title
  removeFromQueue(index + 1 + at)
  return `Took “${title}” out of Up next.`
}

async function musicSettingsFor(args: Args): Promise<string> {
  const said: string[] = []
  const local = useMusic.getState().local
  if (typeof args.shuffle === 'boolean' || str(args.loop)) {
    if (local) {
      const loop = str(args.loop) in LOOPS ? LOOPS[str(args.loop) as keyof typeof LOOPS] : undefined
      setLocalModes({ shuffle: typeof args.shuffle === 'boolean' ? args.shuffle : undefined, repeat: loop })
      said.push(`shuffle ${useLocalMusic.getState().shuffle ? 'on' : 'off'}, loop ${useLocalMusic.getState().repeat === 'track' ? 'this song' : useLocalMusic.getState().repeat === 'context' ? 'the list' : 'off'}`)
    } else said.push('shuffle and loop can only be set here for their own music (on Spotify, use the Spotify app)')
  }
  if (typeof args.volume === 'number') {
    await musicSetVolume(Math.round(Math.min(100, Math.max(0, args.volume))))
    said.push(`volume ${Math.round(args.volume)}%`)
  }
  if (typeof args.seek_seconds === 'number') {
    await musicSeek(Math.max(0, args.seek_seconds) * 1000)
    said.push(`jumped to ${Math.floor(args.seek_seconds / 60)}:${String(Math.floor(args.seek_seconds % 60)).padStart(2, '0')}`)
  }
  if (args.sleep !== undefined) {
    const sl = args.sleep
    if (sl === 'off') setSleepTimer(null)
    else if (sl === 'end_of_song') setSleepTimer('song')
    else if (typeof sl === 'number' && sl > 0) setSleepTimer(Math.min(600, sl))
    said.push(sl === 'off' ? 'sleep timer off' : sl === 'end_of_song' ? 'stops at the end of this song' : `stops in ${String(sl)} min`)
  }
  if (!said.length) throw new Error('Say what to change: shuffle, loop, volume, seek_seconds or sleep.')
  return `Done: ${said.join('; ')}.`
}

async function likeSongsFor(args: Args): Promise<string> {
  const { found, missing } = await pickSongs(args.songs)
  if (!found.length) return `None of those are in their music.${missingText(missing)}`
  const want = args.liked !== false
  const data = await musicData()
  const change = found.filter((s) => (s.path in data.liked) !== want)
  if (change.length) await toggleLike(change)
  return `${want ? 'Liked' : 'Unliked'} ${found.map((s) => `“${s.title}”`).join(', ')}.${missingText(missing)}`
}

async function rateSongFor(args: Args): Promise<string> {
  const song = pickSong(await library(), str(args.song))
  if (!song) throw new Error(`Couldn’t find “${str(args.song)}” in their music.`)
  const stars = Math.round(Math.min(5, Math.max(0, num(args.stars, 0))))
  const old = (await musicData()).ratings[song.path] ?? 0
  // rateSong clears the rating when given the same stars again, so only send a change.
  if (stars !== old) await rateSong(song, stars === 0 ? old : stars)
  return stars ? `Rated “${song.title}” ${stars} star(s).` : `Took the rating off “${song.title}”.`
}

async function tagSongsFor(args: Args): Promise<string> {
  const { found, missing } = await pickSongs(args.songs)
  if (!found.length) return `None of those are in their music.${missingText(missing)}`
  const on = args.remove !== true
  await tagSongs(found, str(args.tag), on)
  return `${on ? 'Tagged' : 'Untagged'} ${found.map((s) => `“${s.title}”`).join(', ')} “${str(args.tag)}”.${missingText(missing)}`
}

async function searchMyMusicFor(args: Args): Promise<string> {
  const songs = await library()
  const data = await musicData()
  const tag = str(args.tag).trim().toLowerCase()
  const list = tag ? songs.filter((s) => data.tags[s.path]?.includes(tag)) : matchSongs(songs, str(args.query))
  if (!list.length) return tag ? `No songs are tagged “${tag}”.` : `No songs match “${str(args.query)}”.`
  return list
    .slice(0, 100)
    .map((s) => {
      const extra = [data.stats[s.path]?.plays ? `${data.stats[s.path].plays} plays` : '', s.path in data.liked ? 'liked' : '', data.ratings[s.path] ? `${data.ratings[s.path]}★` : '', data.tags[s.path]?.length ? `tags: ${data.tags[s.path].join(', ')}` : '', s.year ?? '']
        .filter(Boolean)
        .join(', ')
      return `${songLines([s])}${extra ? ` [${extra}]` : ''}`
    })
    .join('\n') + (list.length > 100 ? `\n…and ${list.length - 100} more.` : '')
}

async function musicStatsFor(args: Args): Promise<string> {
  const songs = await library()
  const data = await musicData()
  const byPath = songsByPath(songs)
  const n = Math.min(50, num(args.limit, 15))
  const line = (s: LocalSong): string => `${s.title} by ${s.artist}`
  const top = mostPlayed(songs, data.stats, n)
  const recent: LocalSong[] = []
  for (const h of [...data.history].reverse()) {
    const s = byPath.get(h.path)
    if (s && !recent.includes(s)) recent.push(s)
    if (recent.length >= n) break
  }
  const artists = new Map<string, number>()
  for (const s of songs) artists.set(s.artist, (artists.get(s.artist) ?? 0) + (data.stats[s.path]?.plays ?? 0))
  const topArtists = [...artists.entries()].filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]).slice(0, 10)
  return [
    `${songs.length} songs, ${Object.keys(data.liked).length} liked, ${data.playlists.length} playlists.`,
    top.length ? `Most played:\n${top.map((s) => `${line(s)} (${data.stats[s.path]?.plays ?? 0} plays)`).join('\n')}` : '',
    topArtists.length ? `Most played artists:\n${topArtists.map(([a, p]) => `${a} (${p} plays)`).join('\n')}` : '',
    recent.length ? `Recently played:\n${recent.map(line).join('\n')}` : '',
    `Recently added:\n${recentlyAdded(songs, n).map(line).join('\n')}`,
    allTags(data).length ? `Tags: ${allTags(data).map((t) => `${t.tag} (${t.count})`).join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

async function editSongFor(args: Args): Promise<string> {
  const song = pickSong(await library(), str(args.song))
  if (!song) throw new Error(`Couldn’t find “${str(args.song)}” in their music.`)
  if (!canTag(song.path)) throw new Error('Orbit can only change the details of MP3 files.')
  const patch: SongTagPatch = {}
  for (const k of ['title', 'artist', 'album', 'year', 'genre'] as const) if (typeof args[k] === 'string') patch[k] = (args[k] as string).trim()
  if (!Object.keys(patch).length) throw new Error('Say which details to change.')
  if (!(await editSongs([song], patch))) throw new Error('Orbit couldn’t save the details.')
  await loadLocalLibrary(true)
  return `Changed “${song.title}”: ${Object.entries(patch).map(([k, v]) => `${k} → ${v}`).join(', ')}. Ctrl+Z in Orbit puts it back.`
}

async function deleteSongsFor(args: Args): Promise<string> {
  const { found, missing } = await pickSongs(args.songs)
  if (!found.length) return `None of those are in their music.${missingText(missing)}`
  // Orbit asks the user first; the files go in the Recycle Bin / Bin.
  const ok = await deleteSongs(found)
  return ok ? `Deleted ${found.map((s) => `“${s.title}”`).join(', ')} from their music (the files are in the ${IS_MAC ? 'Bin' : 'Recycle Bin'}).${missingText(missing)}` : 'The user chose not to delete them (or it didn’t work).'
}

// ---------- Email ----------

async function emailFor(args: Args): Promise<string> {
  const text = await window.api.aiEmailContext(str(args.question))
  return text || 'No emails match (or email isn’t connected in Orbit).'
}

// ---------- Answering ----------

const ANSWERS: Record<string, (args: Args) => string | Promise<string>> = {
  'apps.list': appsList,
  'board.list': boardList,
  'board.update': boardUpdate,
  'board.add': boardAdd,
  search_notes: searchNotesFor,
  read_note: readNoteFor,
  list_notes: listNotesFor,
  create_note: createNoteFor,
  add_to_note: addToNoteFor,
  edit_note: editNoteFor,
  rename_note: renameNoteFor,
  move_note: moveNoteFor,
  delete_note: deleteNoteFor,
  get_calendar: calendarFor,
  add_calendar_event: addEventFor,
  get_countdowns: countdownsFor,
  add_countdown: addCountdownFor,
  get_money: moneyFor,
  get_flashcards: flashcardsFor,
  add_flashcards: addFlashcardsFor,
  find_tagged_files: taggedFor,
  search_files: searchFilesFor,
  get_downloads: async () => downloadsText(await window.api.downloadsState()),
  get_drive_space: async () => drivesText(await window.api.explorerDriveSpace()),
  get_now_playing: nowPlayingFor,
  control_music: controlMusicFor,
  play_music: playMusicFor,
  list_playlists: listPlaylistsFor,
  get_playlist: getPlaylistFor,
  find_songs: findSongsFor,
  suggest_songs: suggestSongsFor,
  create_playlist: createPlaylistFor,
  add_to_playlist: addToPlaylistFor,
  download_song: downloadSongFor,
  remove_from_playlist: removeFromPlaylistFor,
  move_in_playlist: moveInPlaylistFor,
  rename_playlist: renamePlaylistFor,
  delete_playlist: deletePlaylistFor,
  get_queue: queueFor,
  queue_songs: queueSongsFor,
  remove_from_queue: removeFromQueueFor,
  music_settings: musicSettingsFor,
  like_songs: likeSongsFor,
  rate_song: rateSongFor,
  tag_songs: tagSongsFor,
  search_my_music: searchMyMusicFor,
  music_stats: musicStatsFor,
  edit_song: editSongFor,
  delete_songs: deleteSongsFor,
  search_email: emailFor
}

/** Starts answering Claude Desktop's questions; returns a function that stops. */
export function answerClaude(): () => void {
  return window.api.onClaudeAsk(({ id, name, args }) => {
    const answer = ANSWERS[name]
    if (!answer) return window.api.claudeAnswer(id, false, 'Orbit doesn’t know that question.')
    Promise.resolve()
      .then(() => answer(args ?? {}))
      .then(
        (text) => window.api.claudeAnswer(id, true, text),
        (err) => window.api.claudeAnswer(id, false, err instanceof Error ? err.message : String(err))
      )
  })
}

