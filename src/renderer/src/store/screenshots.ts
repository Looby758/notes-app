import { create } from 'zustand'
import { changeTags, readScreenshots, remapScreenshots as remapData, screenshotsJson, type ScreenshotsData } from '../lib/screenshots'
import { recordUndo } from '../lib/undo'
import { notify } from './notify'

/**
 * Characters and episodes tagged on your pictures (the screenshot organiser). Saved in the notes
 * folder (.notesapp/screenshots.json) so they follow your notes. Ctrl+Z undoes a change.
 */
export const useScreenshots = create<{ pictures: ScreenshotsData; loaded: boolean }>(() => ({ pictures: {}, loaded: false }))

const FILE = 'screenshots.json'

/** Bumped when the file is read again (another notes folder): older undo steps no longer fit. */
let generation = 0

export async function loadScreenshots(): Promise<void> {
  generation++
  useScreenshots.setState({ pictures: {}, loaded: false })
  try {
    useScreenshots.setState({ pictures: readScreenshots(await window.api.readAppData(FILE)), loaded: true })
  } catch {
    useScreenshots.setState({ loaded: true })
  }
}

/** Reads the file the first time something needs it. */
export async function ensureScreenshots(): Promise<void> {
  if (!useScreenshots.getState().loaded) await loadScreenshots()
}

let writing = false
let again = false

function persist(): void {
  if (writing) {
    again = true
    return
  }
  writing = true
  window.api
    .writeAppData(FILE, screenshotsJson(useScreenshots.getState().pictures))
    .catch(notify)
    .finally(() => {
      writing = false
      if (again) {
        again = false
        persist()
      }
    })
}

function write(pictures: ScreenshotsData): void {
  useScreenshots.setState({ pictures })
  persist()
}

/** Adds or removes characters and episodes on some pictures (one undo step). */
export function tagPictures(
  paths: string[],
  change: { addCharacters?: string[]; removeCharacters?: string[]; addEpisodes?: string[]; removeEpisodes?: string[] },
  label: string
): void {
  if (!paths.length) return
  const before = useScreenshots.getState().pictures
  const after = changeTags(before, paths, change)
  if (JSON.stringify(before) === JSON.stringify(after)) return
  const at = generation
  const swap = (to: ScreenshotsData) => (): void => {
    if (at !== generation) throw new Error('Your picture tags were reloaded since, so that can’t be undone.')
    write(to)
  }
  recordUndo({ label, undo: swap(before), redo: swap(after) })
  write(after)
}

/** Follows renames and moves in the notes folder. */
export function remapScreenshots(from: string, to: string): void {
  const next = remapData(useScreenshots.getState().pictures, from, to)
  if (next) write(next)
}
