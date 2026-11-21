import { create } from 'zustand'
import { readBoard, type BoardColumn, type BoardItem } from '@shared/appStudio'
import { notify } from './notify'

/**
 * App Studio's idea board: ideas and bugs for each app, in columns (Ideas & bugs, Building,
 * Testing, Done). Saved in the notes folder (.notesapp/app-studio.json), so the board is the same
 * on every computer that has your notes.
 */

interface BoardState {
  items: BoardItem[]
  loaded: boolean
  /** The app whose board is showing (its board key). */
  app: string | null
  /** The item open in the editor; a new one isn't on the board until it has a title. */
  editing: BoardItem | null
  /** Items picked for "Copy as Claude prompt". */
  picked: string[]
}

export const useAppBoard = create<BoardState>(() => ({ items: [], loaded: false, app: null, editing: null, picked: [] }))

const FILE = 'app-studio.json'
let generation = 0

export async function loadAppBoard(): Promise<void> {
  const gen = ++generation
  useAppBoard.setState({ items: [], loaded: false, editing: null, picked: [] })
  try {
    const { items } = readBoard(await window.api.readAppData(FILE))
    if (gen === generation) useAppBoard.setState({ items, loaded: true })
  } catch {
    if (gen === generation) useAppBoard.setState({ loaded: true })
  }
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
    .writeAppData(FILE, JSON.stringify({ items: useAppBoard.getState().items }, null, 2))
    .catch(notify)
    .finally(() => {
      writing = false
      if (again) {
        again = false
        persist()
      }
    })
}

const now = (): string => new Date().toISOString()
const newId = (): string => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function setBoardApp(app: string): void {
  useAppBoard.setState({ app, picked: [] })
}

/** Opens the editor on a new idea or bug for `app` (not saved until it has a title). */
export function startItem(app: string, kind: BoardItem['kind'], pictures: string[] = []): void {
  const t = now()
  useAppBoard.setState({ app, editing: { id: newId(), app, kind, title: '', details: '', column: 'ideas', pictures, created: t, updated: t } })
}

export function editItem(item: BoardItem): void {
  useAppBoard.setState({ editing: { ...item } })
}

export function changeEditing(patch: Partial<BoardItem>): void {
  useAppBoard.setState((s) => (s.editing ? { editing: { ...s.editing, ...patch } } : {}))
}

/** Closes the editor, saving the item (if it has a title). */
export function finishEditing(): void {
  const { editing, items } = useAppBoard.getState()
  useAppBoard.setState({ editing: null })
  if (!editing || !editing.title.trim()) return
  const item = { ...editing, title: editing.title.trim(), details: editing.details.trimEnd(), updated: now() }
  const exists = items.some((i) => i.id === item.id)
  const before = items.find((i) => i.id === item.id)
  if (exists && before && JSON.stringify({ ...before, updated: '' }) === JSON.stringify({ ...item, updated: '' })) return
  useAppBoard.setState({ items: exists ? items.map((i) => (i.id === item.id ? item : i)) : [...items, item] })
  persist()
}

export function cancelEditing(): void {
  useAppBoard.setState({ editing: null })
}

export function moveItem(id: string, column: BoardColumn, before?: string): void {
  const { items } = useAppBoard.getState()
  const item = items.find((i) => i.id === id)
  if (!item) return
  const rest = items.filter((i) => i.id !== id)
  const moved = { ...item, column, updated: item.column === column ? item.updated : now() }
  const at = before ? rest.findIndex((i) => i.id === before) : -1
  if (at >= 0) rest.splice(at, 0, moved)
  else rest.push(moved)
  useAppBoard.setState({ items: rest })
  persist()
}

export function deleteItem(id: string): void {
  useAppBoard.setState((s) => ({ items: s.items.filter((i) => i.id !== id), picked: s.picked.filter((p) => p !== id), editing: s.editing?.id === id ? null : s.editing }))
  persist()
}

export function togglePicked(id: string): void {
  useAppBoard.setState((s) => ({ picked: s.picked.includes(id) ? s.picked.filter((p) => p !== id) : [...s.picked, id] }))
}

export function clearPicked(): void {
  useAppBoard.setState({ picked: [] })
}

/**
 * A bug reported from the screen snip: its picture is saved in your attachments, then App Studio's
 * board opens with a new bug holding it, ready to say what's wrong.
 */
export async function reportBugFromSnip(png: Uint8Array, folder: string, appKey: string | null, open: () => void): Promise<void> {
  try {
    const name = `bug-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`
    const path = await window.api.saveAttachment(folder, name, png)
    open()
    startItem(useAppBoard.getState().app ?? appKey ?? 'App', 'bug', [path])
  } catch (err) {
    notify(err)
  }
}
