import { create } from 'zustand'
import { isWithin, replacePrefix } from '../lib/paths'
import { cardId, readProgress, schedule, type CardProgress, type Grade } from '../lib/flashcards'
import { notify } from './notify'

/**
 * How each flashcard is doing. Saved in the vault (.notesapp/flashcards.json) so your progress
 * follows your notes to other computers via Google Drive. The cards themselves are in the notes.
 */
export const useFlashcards = create<{ progress: Record<string, CardProgress> }>(() => ({ progress: {} }))

const FILE = 'flashcards.json'

export async function loadFlashcards(): Promise<void> {
  useFlashcards.setState({ progress: {} })
  try {
    useFlashcards.setState({ progress: readProgress(await window.api.readAppData(FILE)) })
  } catch {
    // unreadable file: start with no progress rather than failing
  }
}

let writing = false
let again = false

/** Writes the file, one write at a time (reviewing quickly makes several changes quickly). */
function persist(): void {
  if (writing) {
    again = true
    return
  }
  writing = true
  window.api
    .writeAppData(FILE, JSON.stringify({ cards: useFlashcards.getState().progress }, null, 2))
    .catch(notify)
    .finally(() => {
      writing = false
      if (again) {
        again = false
        persist()
      }
    })
}

function save(progress: Record<string, CardProgress>): void {
  useFlashcards.setState({ progress })
  persist()
}

/** Records a review and returns the card's new schedule. */
export function reviewCard(id: string, grade: Grade): CardProgress {
  const { progress } = useFlashcards.getState()
  const next = schedule(progress[id], grade, new Date())
  save({ ...progress, [id]: next })
  return next
}

/** Card ids start with the note's path, so progress follows renames and moves. */
const pathOfId = (id: string): string => id.slice(0, id.indexOf('::'))

export function remapFlashcards(from: string, to: string): void {
  const { progress } = useFlashcards.getState()
  if (!Object.keys(progress).some((id) => isWithin(pathOfId(id), from))) return
  const next: Record<string, CardProgress> = {}
  for (const [id, p] of Object.entries(progress)) {
    const path = pathOfId(id)
    next[isWithin(path, from) ? cardId(replacePrefix(path, from, to), id.slice(path.length + 2)) : id] = p
  }
  save(next)
}

/** Forgets progress for deleted notes. */
export function removeFlashcardsWithin(path: string): void {
  const { progress } = useFlashcards.getState()
  const ids = Object.keys(progress)
  if (!ids.some((id) => isWithin(pathOfId(id), path))) return
  save(Object.fromEntries(Object.entries(progress).filter(([id]) => !isWithin(pathOfId(id), path))))
}

/** Brings back progress for notes that came back (undoing a delete). */
export function putBackFlashcards(entries: Record<string, CardProgress>): void {
  if (Object.keys(entries).length) save({ ...entries, ...useFlashcards.getState().progress })
}
