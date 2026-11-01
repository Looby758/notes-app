import { create } from 'zustand'
import { EXPLORER_TAB, openSpecialTab } from '../lib/editorController'

/** A file on the computer for the Files tab to show (its folder open, the file picked), e.g. a zip opened with "Open in Orbit". */
export const useFilesReveal = create<{ path: string | null }>(() => ({ path: null }))

export function showInFiles(path: string): void {
  useFilesReveal.setState({ path })
  openSpecialTab(EXPLORER_TAB)
}
