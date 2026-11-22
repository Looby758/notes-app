import { create } from 'zustand'
import { EXPLORER_TAB, openSpecialTab } from '../lib/editorController'

/** A file on the computer for the Files tab to show (its folder open, the file picked), e.g. a zip opened with "Open in Orbit". */
export const useFilesReveal = create<{ path: string | null }>(() => ({ path: null }))

export function showInFiles(path: string): void {
  useFilesReveal.setState({ path })
  openSpecialTab(EXPLORER_TAB)
}

/** Asks the Files tab to search the whole PC (Ctrl+K → "Search the whole PC"): bumped each time. */
export const useFilesPcSearch = create<{ asked: number }>(() => ({ asked: 0 }))

export function searchWholePc(): void {
  useFilesPcSearch.setState((s) => ({ asked: s.asked + 1 }))
  openSpecialTab(EXPLORER_TAB)
}
