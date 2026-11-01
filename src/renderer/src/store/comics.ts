import { create } from 'zustand'
import { notify } from './notify'
import { COMICS_TAB, openSpecialTab } from '../lib/editorController'

interface ComicsState {
  /** The comic open in the reader (null: the shelf). */
  reading: string | null
}

// The comic you were reading opens again next time.
const READING_KEY = 'comics:reading'

export const useComics = create<ComicsState>(() => ({ reading: localStorage.getItem(READING_KEY) }))

export function readComic(id: string | null): void {
  if (id) localStorage.setItem(READING_KEY, id)
  else localStorage.removeItem(READING_KEY)
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
