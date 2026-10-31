import { loadLock } from '../lib/lock/session'
import { loadPasswords } from '../lib/passwords/session'
import { loadSnippets } from './snippets'
import { loadSavedSearches } from './savedSearches'
import { fixFileLinks } from '../lib/fileLinks'
import { fixBoardLinks } from '../lib/boards'
import { create } from 'zustand'
import type { FileNode } from '@shared/types'
import { ancestorsOf, findNode, isWithin, notePaths, parentOf, replacePrefix } from '../lib/paths'
import { closeMissing, discardWithin, flushAll, openNote, remap as remapTabs } from '../lib/editorController'
import { snapshotLinks, updateLinksAfterMove } from '../lib/linkUpdates'
import { notify } from './notify'
import { TRASH_NAME } from '@shared/platform'
import { resetIndex, syncIndex } from './noteIndex'
import { loadStarred, putBackStars, remapStars, removeStarsWithin, useStarred } from './starred'
import { loadFlashcards, putBackFlashcards, remapFlashcards, removeFlashcardsWithin, useFlashcards } from './flashcards'
import { loadMoney } from './money'
import { loadLockedFolders, putBackLockedFolders, remapLockedFolders, removeLockedFoldersWithin, useLockedFolders } from '../lib/lock/folders'
import { history, recordUndo, undoChanged } from '../lib/undo'
import type { CardProgress } from '../lib/flashcards'

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
  /** `updateLinks`: already decided (moving several things at once), so don't ask. */
  move(path: string, folder: string, updateLinks?: boolean): Promise<void>
  trash(path: string): Promise<void>
  /** Several notes or folders at once, after one question. */
  trashMany(paths: string[]): Promise<void>
}

const expandedKey = (vault: string): string => `expanded:${vault}`

/** A note's or folder's name as you see it (notes without ".md"). */
const shownName = (path: string): string => (path.split('/').pop() ?? path).replace(/\.md$/i, '')
const folderName = (folder: string): string => (folder ? shownName(folder) : 'the top of your notes')
const itemsLabel = (paths: string[]): string => (paths.length === 1 ? `“${shownName(paths[0])}”` : `${paths.length} items`)

/** What's kept about notes besides the files (stars, flashcard progress, locked folders), to put back after an undone delete. */
interface Extras {
  stars: string[]
  cards: Record<string, CardProgress>
  locked: string[]
}

function extrasWithin(paths: string[]): Extras {
  const inside = (p: string): boolean => paths.some((root) => isWithin(p, root))
  return {
    stars: useStarred.getState().paths.filter(inside),
    cards: Object.fromEntries(Object.entries(useFlashcards.getState().progress).filter(([id]) => inside(id.slice(0, id.indexOf('::'))))),
    locked: useLockedFolders.getState().folders.filter(inside)
  }
}

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
    remapFlashcards(from, to)
    remapLockedFolders(from, to)
  }

  /** Closes and forgets deleted things (tabs, stars, flashcard progress, locked folders). */
  const forgetWithin = (paths: string[]): void => {
    for (const path of paths) {
      discardWithin(path)
      removeStarsWithin(path)
      removeFlashcardsWithin(path)
      removeLockedFoldersWithin(path)
    }
    const { selected } = get()
    if (selected && paths.some((p) => isWithin(selected, p))) set({ selected: null })
  }

  const doRename = async (path: string, name: string, updateLinks?: boolean): Promise<string> => {
    await flushAll()
    const snapshot = await snapshotLinks(path)
    const next = await window.api.rename(path, name)
    if (next === path) return path
    remap(path, next)
    await get().refresh()
    await updateLinksAfterMove(snapshot, path, next, updateLinks)
    await fixFileLinks(path, next)
    await fixBoardLinks(path, next)
    return next
  }

  const doMove = async (path: string, folder: string, updateLinks?: boolean): Promise<string> => {
    await flushAll()
    const snapshot = await snapshotLinks(path)
    const next = await window.api.move(path, folder)
    if (next === path) return path
    remap(path, next)
    get().expandTo(folder)
    await get().refresh()
    await updateLinksAfterMove(snapshot, path, next, updateLinks)
    await fixFileLinks(path, next)
    await fixBoardLinks(path, next)
    return next
  }

  /** Brings deleted things back from Orbit's bin. Returns where they went. */
  const bringBack = async (paths: string[], extras?: Extras): Promise<string[]> => {
    const back = await window.api.undoRestore(paths, true)
    if (extras) {
      putBackStars(extras.stars)
      putBackFlashcards(extras.cards)
      putBackLockedFolders(extras.locked)
    }
    // Back as "name (2)" when something has its name now.
    back.forEach((to, i) => to !== paths[i] && remap(paths[i], to))
    for (const p of back) get().expandTo(parentOf(p))
    await get().refresh()
    undoChanged('files')
    return back
  }

  /** Deletes again without asking (redo), into Orbit's bin. */
  const putAway = async (paths: string[]): Promise<void> => {
    await flushAll()
    const held = await window.api.undoHold(paths, true)
    forgetWithin(paths)
    await get().refresh()
    undoChanged('files')
    if (held.length < paths.length) throw new Error(`Moved to the ${TRASH_NAME}, but it can't be undone again from here.`)
  }

  /** Undo for a delete: only for what went into Orbit's bin (a huge folder on another drive goes straight to the Bin). */
  const recordDelete = async (paths: string[], extras: Extras): Promise<void> => {
    const held = await window.api.undoHeld(paths, true).catch(() => [] as string[])
    if (!held.length) return
    let at = held
    recordUndo({
      label: `Deleted ${itemsLabel(held)}`,
      undo: async () => {
        at = await bringBack(at, extras)
      },
      redo: () => putAway(at),
      forget: (done) => done && void window.api.undoRelease(at, true)
    })
  }

  /** Undo for something new: it goes into Orbit's bin (so redo can bring it back). */
  const recordNew = (path: string): void => {
    let at = path
    recordUndo({
      label: `Made “${shownName(path)}”`,
      undo: () => putAway([at]),
      redo: async () => {
        ;[at] = await bringBack([at])
      },
      forget: (done) => !done && void window.api.undoRelease([at], true)
    })
  }

  return {
    vault: '',
    tree: [],
    expanded: new Set(),
    selected: null,
    renaming: null,

    open(vault) {
      if (vault !== get().vault) history.clear()
      set({ vault, tree: [], expanded: loadExpanded(vault), selected: null, renaming: null })
      resetIndex()
      void loadLock()
      void loadLockedFolders()
      void loadPasswords()
      void loadSnippets()
      void loadSavedSearches()
      loadStarred()
      void loadFlashcards()
      void loadMoney()
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
        recordNew(path)
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
        recordNew(path)
      } catch (err) {
        notify(err)
      }
    },

    async rename(path, name) {
      set({ renaming: null })
      try {
        const next = await doRename(path, name)
        if (next === path) return
        const oldName = path.split('/').pop()!
        const newName = next.split('/').pop()!
        recordUndo({
          label: `Renamed “${shownName(path)}” to “${shownName(next)}”`,
          undo: async () => {
            await doRename(next, oldName, true)
            undoChanged('files')
          },
          redo: async () => {
            await doRename(path, newName, true)
            undoChanged('files')
          }
        })
      } catch (err) {
        notify(err)
      }
    },

    async move(path, folder, updateLinks) {
      try {
        const next = await doMove(path, folder, updateLinks)
        if (next === path) return
        const from = parentOf(path)
        recordUndo({
          label: `Moved “${shownName(path)}” to ${folderName(folder)}`,
          // Links were already updated (or left) the first time: do the same again.
          undo: async () => {
            await doMove(next, from, updateLinks ?? true)
            undoChanged('files')
          },
          redo: async () => {
            await doMove(path, folder, updateLinks ?? true)
            undoChanged('files')
          }
        })
      } catch (err) {
        notify(err)
      }
    },

    async trash(path) {
      try {
        await flushAll()
        if (!(await window.api.trash(path))) return
        const extras = extrasWithin([path])
        forgetWithin([path])
        await get().refresh()
        await recordDelete([path], extras)
      } catch (err) {
        notify(err)
      }
    },

    async trashMany(paths) {
      try {
        await flushAll()
        const gone = await window.api.trashMany(paths)
        const extras = extrasWithin(gone)
        forgetWithin(gone)
        await get().refresh()
        await recordDelete(gone, extras)
      } catch (err) {
        notify(err)
      }
    }
  }
})
