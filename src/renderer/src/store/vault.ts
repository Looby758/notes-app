import { create } from 'zustand'
import type { FileNode } from '@shared/types'
import { ancestorsOf, findNode, isWithin, notePaths, parentOf, replacePrefix } from '../lib/paths'
import { closeMissing, discardWithin, flushAll, openNote, remap as remapTabs } from '../lib/editorController'
import { snapshotLinks, updateLinksAfterMove } from '../lib/linkUpdates'
import { notify } from './notify'
import { resetIndex, syncIndex } from './noteIndex'
import { loadStarred, remapStars, removeStarsWithin } from './starred'

interface VaultState {
  vault: string
  tree: FileNode[]
  expanded: Set<string>
  selected: string | null
  /** The item whose name is being edited inline. */
  renaming: string | null

  open(vault: string): void
  /** Reloads the tree and link index; `changed` notes are re-read for links. */
  refresh(changed?: string[]): Promise<void>
  toggle(path: string): void
  expand(path: string): void
  /** Opens all folders leading to (and including) `folder`. */
  expandTo(folder: string): void
  select(path: string | null): void
  startRename(path: string | null): void
  /** Folder that new items go into: the given one, else the selected folder (or the selected note's folder). */
  targetFolder(folder?: string): string

  newNote(folder?: string): Promise<void>
  /** Creates a note at an exact path (folders included) and opens it. */
  createNoteAt(path: string, content?: string, cursor?: number | null): Promise<string | null>
  newFolder(folder?: string): Promise<void>
  rename(path: string, name: string): Promise<void>
  move(path: string, folder: string): Promise<void>
  trash(path: string): Promise<void>
}

const expandedKey = (vault: string): string => `expanded:${vault}`

function loadExpanded(vault: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(expandedKey(vault)) ?? '[]'))
  } catch {
    return new Set()
  }
}

function saveExpanded(vault: string, expanded: Set<string>): void {
  try {
    localStorage.setItem(expandedKey(vault), JSON.stringify([...expanded]))
  } catch {
    // not fatal: folders just start collapsed next time
  }
}

export const useVault = create<VaultState>((set, get) => {
  const setExpanded = (update: (next: Set<string>) => void): void => {
    const next = new Set(get().expanded)
    update(next)
    saveExpanded(get().vault, next)
    set({ expanded: next })
  }

  /** Keeps selection, open folders and editor tabs pointing at the right place after a rename or move. */
  const remap = (from: string, to: string): void => {
    const { selected, expanded } = get()
    set({ selected: selected && replacePrefix(selected, from, to) })
    if ([...expanded].some((p) => isWithin(p, from))) {
      setExpanded((next) => {
        for (const p of [...next]) {
          if (isWithin(p, from)) {
            next.delete(p)
            next.add(replacePrefix(p, from, to))
          }
        }
      })
    }
    remapTabs(from, to)
    remapStars(from, to)
  }

  return {
    vault: '',
    tree: [],
    expanded: new Set(),
    selected: null,
    renaming: null,

    open(vault) {
      set({ vault, tree: [], expanded: loadExpanded(vault), selected: null, renaming: null })
      resetIndex()
      loadStarred()
      get().refresh()
    },

    async refresh(changed = []) {
      try {
        const tree = await window.api.listTree()
        const { selected } = get()
        set({ tree, selected: selected && findNode(tree, selected) ? selected : null })
        closeMissing((path) => findNode(tree, path) !== null)
        await syncIndex(notePaths(tree), changed)
      } catch (err) {
        notify(err)
      }
    },

    toggle(path) {
      setExpanded((next) => (next.has(path) ? next.delete(path) : next.add(path)))
    },

    expand(path) {
      if (!get().expanded.has(path)) setExpanded((next) => next.add(path))
    },

    expandTo(folder) {
      const missing = ancestorsOf(folder).filter((p) => !get().expanded.has(p))
      if (missing.length) setExpanded((next) => missing.forEach((p) => next.add(p)))
    },

    select(path) {
      set({ selected: path })
    },

    startRename(path) {
      set({ renaming: path })
    },

    targetFolder(folder) {
      if (folder !== undefined) return folder
      const { selected, tree } = get()
      if (!selected) return ''
      return findNode(tree, selected)?.type === 'folder' ? selected : parentOf(selected)
    },

    async newNote(folder) {
      try {
        const dir = get().targetFolder(folder)
        const path = await window.api.createNote(dir)
        get().expandTo(dir)
        await get().refresh()
        set({ selected: path, renaming: path })
        openNote(path, { focus: false })
      } catch (err) {
        notify(err)
      }
    },

    async createNoteAt(path, content, cursor) {
      try {
        const created = await window.api.createNoteAt(path)
        if (content) await window.api.writeNote(created, content)
        get().expandTo(parentOf(created))
        await get().refresh([created])
        openNote(created, cursor != null ? { offset: cursor } : {})
        return created
      } catch (err) {
        notify(err)
        return null
      }
    },

    async newFolder(folder) {
      try {
        const dir = get().targetFolder(folder)
        const path = await window.api.createFolder(dir)
        get().expandTo(dir)
        await get().refresh()
        set({ selected: path, renaming: path })
      } catch (err) {
        notify(err)
      }
    },

    async rename(path, name) {
      set({ renaming: null })
      try {
        await flushAll()
        const snapshot = await snapshotLinks(path)
        const next = await window.api.rename(path, name)
        if (next === path) return
        remap(path, next)
        await get().refresh()
        await updateLinksAfterMove(snapshot, path, next)
      } catch (err) {
        notify(err)
      }
    },

    async move(path, folder) {
      try {
        await flushAll()
        const snapshot = await snapshotLinks(path)
        const next = await window.api.move(path, folder)
        if (next === path) return
        remap(path, next)
        get().expandTo(folder)
        await get().refresh()
        await updateLinksAfterMove(snapshot, path, next)
      } catch (err) {
        notify(err)
      }
    },

    async trash(path) {
      try {
        await flushAll()
        if (!(await window.api.trash(path))) return
        discardWithin(path)
        removeStarsWithin(path)
        const { selected } = get()
        if (selected && isWithin(selected, path)) set({ selected: null })
        await get().refresh()
      } catch (err) {
        notify(err)
      }
    }
  }
})
