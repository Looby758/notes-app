import { create } from 'zustand'
import { emptyTagStore, type FileTagStore } from '@shared/fileTags'
import { notify } from './notify'

/** Colour tags and favourite folders (Files tab), as kept by the main process (main/fileTags.ts). */
export const useFileTags = create<FileTagStore & { loaded: boolean }>(() => ({ ...emptyTagStore(), loaded: false }))

/** Before favourites, folders could be pinned to the Files sidebar; those become the first favourites. */
const OLD_PINS_KEY = 'orbit.explorer.pins'

let started = false
export function loadFileTags(): void {
  if (started) return
  started = true
  window.api.onTagsChanged((store) => useFileTags.setState({ ...store, loaded: true }))
  window.api
    .tagsGet()
    .then((store) => {
      useFileTags.setState({ ...store, loaded: true })
      let pins: string[] = []
      try {
        const list = JSON.parse(localStorage.getItem(OLD_PINS_KEY) ?? '[]')
        pins = Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
      } catch {
        // Nothing pinned.
      }
      if (pins.length) {
        localStorage.removeItem(OLD_PINS_KEY)
        void window.api.tagsFavourites([...store.favourites, ...pins.filter((p) => !store.favourites.includes(p))])
      }
    })
    .catch(notify)
}

export const isFavourite = (path: string): boolean => useFileTags.getState().favourites.includes(path)

export function toggleFavourite(path: string): void {
  const list = useFileTags.getState().favourites
  void window.api.tagsFavourites(list.includes(path) ? list.filter((p) => p !== path) : [...list, path]).catch(notify)
}

/** Moves a favourite up (-1) or down (1) the list. */
export function moveFavourite(path: string, by: -1 | 1): void {
  const list = [...useFileTags.getState().favourites]
  const i = list.indexOf(path)
  const j = i + by
  if (i < 0 || j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  void window.api.tagsFavourites(list).catch(notify)
}
