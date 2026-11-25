import { cleanFolder, cleanNoteName } from '@shared/claudeFormat'
import { outlineToHeadings } from '@shared/claudeHelpers'
import { getNoteText, normalizeText } from '../../store/noteIndex'
import { useEditor } from '../../store/editor'
import { useVault } from '../../store/vault'
import { toggleMindMap } from '../../store/ui'
import { openNote } from '../editorController'
import { isLockedText } from '../lock/crypto'
import { findNote, locked, needNotes, str, type Answer, type Args } from './common'

/** Mind maps for Claude Desktop: a note's headings shown as a map, read as an outline, or a new map from an outline. */

function show(path: string): void {
  openNote(path)
  // The note opens in the active pane; switch that pane's view to the map.
  toggleMindMap(useEditor.getState().activePane, path, true)
}

function showFor(args: Args): string {
  needNotes()
  const path = findNote(str(args.note))
  show(path)
  return `Showing ${path} as a mind map in Orbit (its headings are the branches).`
}

async function outlineFor(args: Args): Promise<string> {
  needNotes()
  const path = findNote(str(args.note))
  const text = getNoteText(path) ?? normalizeText(await window.api.readNote(path))
  if (isLockedText(text)) throw new Error('That note is locked.')
  const heads = text
    .split('\n')
    .map((l) => /^(#{1,6})\s+(.+)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
  if (!heads.length) return `${path} has no headings, so its mind map is just the note’s name.`
  const top = Math.min(...heads.map((m) => m[1].length))
  return heads.map((m) => `${'  '.repeat(m[1].length - top)}- ${m[2].trim()}`).join('\n')
}

async function createFor(args: Args): Promise<string> {
  needNotes()
  const title = str(args.title).trim()
  const outline = str(args.outline)
  if (!title || !outline.trim()) throw new Error('Give the map a title and an outline.')
  const folder = cleanFolder(str(args.folder))
  if (folder && locked(folder)) throw new Error('That folder is locked.')
  const base = cleanNoteName(title)
  for (let n = 1; n < 50; n++) {
    const want = `${folder ? `${folder}/` : ''}${n === 1 ? base : `${base} ${n}`}.md`
    let path: string
    try {
      path = await window.api.createNoteAt(want)
    } catch (err) {
      if (/already exists/i.test(String((err as Error)?.message ?? err))) continue
      throw err
    }
    await window.api.writeNote(path, outlineToHeadings(title, outline))
    await useVault.getState().refresh([path])
    show(path)
    return `Made the mind map ${path} and opened it.`
  }
  throw new Error('There are already too many notes with that name.')
}

export const MIND_MAP_ANSWERS: Record<string, Answer> = {
  show_mind_map: showFor,
  mind_map_outline: outlineFor,
  create_mind_map: createFor
}
