import { create } from 'zustand'
import { notify } from './notify'
import { COMICS_TAB, openSpecialTab } from '../lib/editorController'

interface ComicsState {
  /** The comic open in the reader (null: the shelf). */
  reading: string | null
}

// The comic you were reading opens again next time.
const READING_KEY = 'comics:reading'

// Read safely: tests import this store (through the editor) where there is no localStorage.
function loadReading(): string | null {
  try {
    return localStorage.getItem(READING_KEY)
  } catch {
    return null
  }
}

export const useComics = create<ComicsState>(() => ({ reading: loadReading() }))

export function readComic(id: string | null): void {
  try {
    if (id) localStorage.setItem(READING_KEY, id)
    else localStorage.removeItem(READING_KEY)
  } catch {
    // Not saved: the comic still opens, it just won't reopen next time.
  }
  useComics.setState({ reading: id })
}

/** Opens a comic file from anywhere (the file explorer, a drop): it goes on the shelf and opens. */
export async function openComicFile(path: string): Promise<void> {
  try {
    const { added } = await window.api.comicsAdd([path])
    if (!added[0]) {
      notify('That isn’t a comic Orbit can open. Comics need to be .cbz or .cbr files.')
      return
    }
    readComic(added[0])
    openSpecialTab(COMICS_TAB)
  } catch (err) {
    notify(err)
  }
}

/**
 * A comic clicked in the notes folder or Files: it goes on the shelf and the Comics tab opens on
 * the shelf, without opening the comic itself (or any other app). `vault`: the path is in the notes folder.
 */
export async function shelveComicFile(path: string, vault = false): Promise<void> {
  try {
    const full = vault ? await window.api.videoInVault(path) : path
    const { added } = await window.api.comicsAdd([full])
    if (!added[0]) {
      notify('That isn’t a comic Orbit can open. Comics need to be .cbz or .cbr files.')
      return
    }
    readComic(null)
    openSpecialTab(COMICS_TAB)
    notify('It’s on your comic shelf. Click its cover to read it.', 'info')
  } catch (err) {
    notify(err)
  }
}
