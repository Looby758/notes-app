import { cleanFolder, cleanNoteName, findNotePath, isInside, noteName } from '@shared/claudeFormat'
import { allTags, backlinksTo, getNoteText, normalizeText, useNoteIndex } from '../../store/noteIndex'
import { useVault } from '../../store/vault'
import { dailyPath, editNote, ensureDaily } from '../daily'
import { fromDayKey } from '../dates'
import { openNote } from '../editorController'
import { isLockedText } from '../lock/crypto'
import { locked, needNotes, num, str, type Answer, type Args } from './common'

/**
 * More of Notes for Claude Desktop: daily notes, tasks across notes, tags, links, folders, opening
 * a note in Orbit, and writing under a heading. Locked notes and locked folders are left alone.
 */

const notePaths = (): string[] => [...useNoteIndex.getState().notes.keys()].filter((p) => !locked(p))

function findNote(want: string): string {
  const path = findNotePath(notePaths(), want)
  if (path) return path
  if (findNotePath([...useNoteIndex.getState().notes.keys()], want)) throw new Error('That note is in a locked folder, so Claude can’t see it.')
  throw new Error(`There’s no note called “${want}” (or more than one has that name: use its full path from search_notes).`)
}

async function textOf(path: string): Promise<string> {
  const text = getNoteText(path) ?? normalizeText(await window.api.readNote(path))
  if (isLockedText(text)) throw new Error('That note is locked, so Claude can’t read it.')
  return text
}

function dayOf(args: Args): Date {
  const key = str(args.date)
  if (!key) return new Date()
  const d = fromDayKey(key)
  if (!d) throw new Error('The date has to be like 2026-11-25.')
  return d
}

function openNoteFor(args: Args): string {
  needNotes()
  const path = findNote(str(args.path))
  openNote(path, { newTab: args.new_tab === true })
  return `Opened ${path} in Orbit.`
}

async function dailyNoteFor(args: Args): Promise<string> {
  needNotes()
  const path = dailyPath(dayOf(args))
  if (!useNoteIndex.getState().notes.has(path)) return `There’s no daily note for that day yet (it would be ${path}).`
  if (locked(path)) throw new Error('That daily note is in a locked folder.')
  return `${path}\n\n${await textOf(path)}`
}

async function addToDailyFor(args: Args): Promise<string> {
  needNotes()
  const add = str(args.text).trim()
  if (!add) throw new Error('Say what to add.')
  const path = await ensureDaily(dayOf(args))
  if (locked(path)) throw new Error('Daily notes are in a locked folder.')
  await editNote(path, (text) => `${text.replace(/\s*$/, '')}${text.trim() ? '\n\n' : ''}${add}\n`, { undo: `Claude added to “${noteName(path)}”` })
  await useVault.getState().refresh([path])
  if (args.open === true) openNote(path)
  return `Added to the daily note ${path}.`
}

// ---------- tasks ----------

const TASK = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/

function tasksFor(args: Args): string {
  needNotes()
  const folder = str(args.folder)
  const q = str(args.search).trim().toLowerCase()
  const showDone = args.done === true
  const out: string[] = []
  for (const path of notePaths().sort()) {
    if (!isInside(path, folder)) continue
    const text = getNoteText(path)
    if (!text || isLockedText(text)) continue
    for (const line of text.split('\n')) {
      const m = TASK.exec(line)
      if (!m) continue
      const done = m[1] !== ' '
      if (done !== showDone || (q && !m[2].toLowerCase().includes(q))) continue
      out.push(`${path}: [${done ? 'x' : ' '}] ${m[2].trim()}`)
    }
  }
  const limit = Math.min(500, num(args.limit, 100))
  if (!out.length) return showDone ? 'No ticked tasks found.' : 'No unticked tasks found.'
  return out.slice(0, limit).join('\n') + (out.length > limit ? `\n…and ${out.length - limit} more.` : '')
}

async function tickNoteTaskFor(args: Args): Promise<string> {
  needNotes()
  const path = findNote(str(args.note))
  const want = str(args.task).trim().toLowerCase()
  if (!want) throw new Error('Say which task.')
  const done = args.done !== false
  let said = ''
  await editNote(
    path,
    (text) => {
      const lines = text.split('\n')
      const hits = lines.map((l, i) => ({ i, m: TASK.exec(l) })).filter((h) => h.m && h.m[2].toLowerCase().includes(want))
      const exact = hits.filter((h) => h.m![2].trim().toLowerCase() === want)
      const pick = exact.length === 1 ? exact : hits
      if (!pick.length) throw new Error(`There’s no task like “${str(args.task)}” in ${path}.`)
      if (pick.length > 1) throw new Error(`More than one task in ${path} matches: ${pick.map((h) => `“${h.m![2].trim()}”`).join(', ')}. Say which one.`)
      const { i, m } = pick[0]
      said = m![2].trim()
      if ((m![1] !== ' ') === done) return null
      lines[i] = lines[i].replace(/\[[ xX]\]/, done ? '[x]' : '[ ]')
      return lines.join('\n')
    },
    { undo: `Claude ${done ? 'ticked' : 'unticked'} a task` }
  )
  await useVault.getState().refresh([path])
  return `${done ? 'Ticked' : 'Unticked'} “${said}” in ${path}.`
}

// ---------- tags, links, folders ----------

function tagsFor(): string {
  needNotes()
  const tags = allTags()
  return tags.length ? tags.map((t) => `#${t.name} (${t.count})`).join('\n') : 'No tags in the notes yet.'
}

function notesWithTagFor(args: Args): string {
  needNotes()
  const tag = str(args.tag).replace(/^#/, '').toLowerCase()
  const list = [...useNoteIndex.getState().notes].filter(([p, n]) => !locked(p) && n.tags.some((t) => t.toLowerCase() === tag || t.toLowerCase().startsWith(`${tag}/`))).map(([p]) => p)
  return list.length ? list.sort().join('\n') : `No notes are tagged #${tag}.`
}

function backlinksFor(args: Args): string {
  needNotes()
  const path = findNote(str(args.note))
  const links = backlinksTo(path).filter((b) => !locked(b.source))
  const out = links.map((b) => `${b.source}\n${b.links.map((l) => `  ${l.snippet.trim()}`).join('\n')}`)
  const index = useNoteIndex.getState()
  const from = index.notes.get(path)?.links ?? []
  const outgoing = [...new Set(from.map((l) => index.lookup.resolve(l, path)).filter((p): p is string => !!p && !locked(p)))]
  return `Notes that link to ${path}:\n${out.join('\n') || '  none'}\n\n${path} links to:\n${outgoing.map((p) => `  ${p}`).join('\n') || '  nothing'}`
}

async function createFolderFor(args: Args): Promise<string> {
  needNotes()
  const folder = cleanFolder(str(args.folder))
  if (!folder) throw new Error('Say the folder’s name.')
  if (locked(`${folder}/x.md`)) throw new Error('That’s inside a locked folder.')
  const made = await window.api.createFolder(folder)
  await useVault.getState().refresh()
  return `Made the folder ${made || folder}.`
}

async function copyNoteFor(args: Args): Promise<string> {
  needNotes()
  const path = findNote(str(args.path))
  const text = await textOf(path)
  const folder = args.folder === undefined ? (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '') : cleanFolder(str(args.folder))
  const base = cleanNoteName(str(args.name) || `${noteName(path)} copy`)
  for (let n = 1; n < 50; n++) {
    const target = `${folder ? `${folder}/` : ''}${n === 1 ? base : `${base} ${n}`}.md`
    try {
      const made = await window.api.createNoteAt(target)
      await window.api.writeNote(made, text)
      await useVault.getState().refresh([made])
      return `Copied ${path} to ${made}.`
    } catch (err) {
      if (!/already exists/i.test(String((err as Error)?.message ?? err))) throw err
    }
  }
  throw new Error('There are already too many notes with that name.')
}

/** Adds text at the end of one section of a note (under a heading), making the heading if it isn't there. */
async function addUnderHeadingFor(args: Args): Promise<string> {
  needNotes()
  const path = findNote(str(args.path))
  const heading = str(args.heading).replace(/^#+\s*/, '').trim()
  const add = str(args.text).trim()
  if (!heading || !add) throw new Error('Say the heading and what to add.')
  let made = false
  await editNote(
    path,
    (text) => {
      const lines = text.split('\n')
      const at = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, '').trim().toLowerCase() === heading.toLowerCase())
      if (at === -1) {
        made = true
        return `${text.replace(/\s*$/, '')}${text.trim() ? '\n\n' : ''}## ${heading}\n\n${add}\n`
      }
      const level = /^#+/.exec(lines[at])![0].length
      let end = lines.findIndex((l, i) => i > at && /^#{1,6}\s/.test(l) && /^#+/.exec(l)![0].length <= level)
      if (end === -1) end = lines.length
      let last = end
      while (last > at + 1 && !lines[last - 1].trim()) last--
      lines.splice(last, 0, ...(last === at + 1 ? ['', add] : [add]))
      return lines.join('\n')
    },
    { undo: `Claude added to “${noteName(path)}”` }
  )
  await useVault.getState().refresh([path])
  return made ? `There was no “${heading}” heading, so it was added at the end of ${path} with the text under it.` : `Added it under “${heading}” in ${path}.`
}

export const NOTE_ANSWERS: Record<string, Answer> = {
  open_note: openNoteFor,
  get_daily_note: dailyNoteFor,
  add_to_daily_note: addToDailyFor,
  list_tasks: tasksFor,
  tick_note_task: tickNoteTaskFor,
  get_tags: tagsFor,
  notes_with_tag: notesWithTagFor,
  get_links: backlinksFor,
  create_folder: createFolderFor,
  copy_note: copyNoteFor,
  add_under_heading: addUnderHeadingFor
}
