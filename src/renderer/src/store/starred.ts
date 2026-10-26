import { create } from 'zustand'
import { isWithin, replacePrefix } from '../lib/paths'
import { notify } from './notify'

/**
 * Starred notes, in your order. Saved in the vault (.notesapp/starred.json) so they follow your
 * notes to other computers via Google Drive.
 */
export const useStarred = create<{ paths: string[] }>(() => ({ paths: [] }))

const FILE = 'starred.json'

export async function loadStarred(): Promise<void> {
  useStarred.setState({ paths: [] })
  try {
    const raw = await window.api.readAppData(FILE)
    const parsed = raw ? JSON.parse(raw) : null
    const paths = Array.isArray(parsed?.starred) ? parsed.starred.filter((p: unknown) => typeof p === 'string') : []
    useStarred.setState({ paths })
  } catch {
    // unreadable file: start with no stars rather than failing
  }
}

let writing = false
let again = false

/** Writes the list, one write at a time (starring several at once makes several changes quickly). */
function persist(): void {
  if (writing) {
    again = true
    return
  }
  writing = true
  window.api
    .writeAppData(FILE, JSON.stringify({ starred: useStarred.getState().paths }, null, 2))
    .catch(notify)
    .finally(() => {
      writing = false
      if (again) {
        again = false
        persist()
      }
    })
}

function save(paths: string[]): void {
  useStarred.setState({ paths })
  persist()
}

export const isStarred = (path: string): boolean => useStarred.getState().paths.includes(path)

/** Stars a note (at `index`, default the end) or, if it's starred already, unstars it. */
export function toggleStar(path: string, index?: number): void {
  const { paths } = useStarred.getState()
  if (paths.includes(path)) save(paths.filter((p) => p !== path))
  else {
    const next = [...paths]
    next.splice(index ?? next.length, 0, path)
    save(next)
  }
}

/** Puts a note at position `index` in the starred list (starring it if needed). */
export function placeStar(path: string, index: number): void {
  const without = useStarred.getState().paths.filter((p) => p !== path)
  const at = Math.max(0, Math.min(index, without.length))
  without.splice(at, 0, path)
  save(without)
}

/** Follows renames and moves. */
export function remapStars(from: string, to: string): void {
  const { paths } = useStarred.getState()
  if (paths.some((p) => isWithin(p, from))) save(paths.map((p) => replacePrefix(p, from, to)))
}

/** Forgets stars for deleted notes. */
export function removeStarsWithin(path: string): void {
  const { paths } = useStarred.getState()
  if (paths.some((p) => isWithin(p, path))) save(paths.filter((p) => !isWithin(p, path)))
}
