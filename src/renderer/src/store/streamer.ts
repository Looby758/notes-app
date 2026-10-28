import { create } from 'zustand'
import { setPrefs, usePrefs } from './prefs'
import { useEditor } from './editor'
import { lockVault } from '../lib/passwords/session'
import { notify } from './notify'

/**
 * Streamer mode: while you share your screen, private things are blurred until you click them.
 * The switch itself is a setting (so it survives a restart); this remembers which notes you've
 * chosen to show. A note is hidden again once its tab is closed, so opening it later starts hidden.
 */
export const useStreamer = create<{ shownNotes: Set<string> }>(() => ({ shownNotes: new Set() }))

export const useStreamerOn = (): boolean => usePrefs((s) => s.prefs.streamerMode)

/** Note names are blurred (file list, tabs, recent notes). */
export const useHideNames = (): boolean => usePrefs((s) => s.prefs.streamerMode && s.prefs.streamerHideNames)

/** The note at `path` is covered until you click Show. */
export function useNoteHidden(path: string | null): boolean {
  const on = usePrefs((s) => s.prefs.streamerMode && s.prefs.streamerHideNotes)
  const shown = useStreamer((s) => !!path && s.shownNotes.has(path))
  return on && !!path && !shown
}

export function showNote(path: string): void {
  useStreamer.setState((s) => ({ shownNotes: new Set(s.shownNotes).add(path) }))
}

export function toggleStreamerMode(): void {
  const on = !usePrefs.getState().prefs.streamerMode
  setPrefs({ streamerMode: on })
  notify(on ? 'Streamer mode is on: private things are blurred until you click them.' : 'Streamer mode is off.', 'info')
}

// Turning it on or off (here, from Settings or from another window) starts over: every note is
// hidden again, and the password vault locks.
usePrefs.subscribe((s, prev) => {
  if (s.prefs.streamerMode === prev.prefs.streamerMode) return
  useStreamer.setState({ shownNotes: new Set() })
  if (s.prefs.streamerMode) lockVault()
})

// Closing a note's tab hides it again.
useEditor.subscribe((s) => {
  const { shownNotes } = useStreamer.getState()
  if (!shownNotes.size) return
  const open = new Set(Object.values(s.panes).flatMap((p) => p.tabs))
  const kept = [...shownNotes].filter((p) => open.has(p))
  if (kept.length !== shownNotes.size) useStreamer.setState({ shownNotes: new Set(kept) })
})
