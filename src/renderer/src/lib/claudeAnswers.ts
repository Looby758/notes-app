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
  matchSongs,
  noteName,
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
import { usePrefs } from '../store/prefs'
import { musicControl, useMusic } from '../store/music'
import { loadLocalLibrary, localUpNext, playLocal, useLocalMusic } from '../store/localMusic'
import { addEvent, editNote } from './daily'
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

async function playMusicFor(args: Args): Promise<string> {
  if (!useLocalMusic.getState().library) await loadLocalLibrary()
  const songs = useLocalMusic.getState().library?.songs ?? []
  if (!songs.length) throw new Error('Orbit has no music folder set (or it’s empty). Choose one on the Music page first.')
  const found = matchSongs(songs, str(args.search))
  if (!found.length) return `None of the songs match “${str(args.search)}”. Try an artist, an album or a genre.`
  await playLocal(found.slice(0, 200), 'shuffle')
  return `Playing ${found.length} song(s) matching “${str(args.search)}”, shuffled.`
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
  get_calendar: calendarFor,
  add_calendar_event: addEventFor,
  get_countdowns: countdownsFor,
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

