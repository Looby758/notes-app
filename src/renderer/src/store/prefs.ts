import { useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { DEFAULT_PREFS, type Prefs } from '@shared/prefs'
import { activeThemeId, getTheme, type Theme } from '@shared/themes'
import { applyAppearance, systemDark, watchSystemTheme } from '../lib/appearance'
import { loadThemes, useThemes } from './themes'
import { recordUndo } from '../lib/undo'
import { SETTINGS } from '../lib/settingsSchema'

/** Your Settings. The main process stores them in settings.json and checks every value. */
export const usePrefs = create<{ prefs: Prefs }>(() => ({ prefs: DEFAULT_PREFS }))

/** Changes not yet sent to the main process (sliders send many in a row). */
let pending: Partial<Prefs> = {}
let timer: ReturnType<typeof setTimeout> | undefined

export async function loadPrefs(): Promise<void> {
  // Imported themes first, so a theme from one shows from the first frame.
  await loadThemes().catch((err) => console.error('[themes]', err))
  usePrefs.setState({ prefs: await window.api.getPrefs() })
  window.api.onPrefsChanged((prefs) => {
    // Don't let an older broadcast undo what you're dragging right now.
    usePrefs.setState({ prefs: { ...prefs, ...pending } })
  })
}

const SPECIAL_LABELS: Partial<Record<keyof Prefs, string>> = {
  homeOrder: 'Changed the Home page',
  homeHidden: 'Changed the Home page',
  shortcuts: 'Changed a shortcut',
  countdowns: 'Changed your countdowns',
  editorFontSize: 'Changed the text size'
}

/** "Changed “Accent colour”", for the undo message. */
function changeLabel(keys: (keyof Prefs)[]): string {
  if (keys.length !== 1) return 'Changed settings'
  const special = SPECIAL_LABELS[keys[0]]
  if (special) return special
  const def = SETTINGS.find((d) => d.key === keys[0])
  return def ? `Changed “${def.label}”` : 'Changed a setting'
}

/** Ctrl+Z puts settings back. A slider dragged (or a key held) is one change, not one per step. */
function recordChange(patch: Partial<Prefs>): void {
  const prefs = usePrefs.getState().prefs
  const keys = (Object.keys(patch) as (keyof Prefs)[]).filter((k) => JSON.stringify(prefs[k]) !== JSON.stringify(patch[k]))
  if (!keys.length) return
  const before = Object.fromEntries(keys.map((k) => [k, prefs[k]])) as Partial<Prefs>
  const after = Object.fromEntries(keys.map((k) => [k, patch[k]])) as Partial<Prefs>
  recordUndo({
    label: changeLabel(keys),
    mergeKey: `prefs:${[...keys].sort().join(',')}`,
    undo: () => setPrefs(before),
    redo: () => setPrefs(after)
  })
}

/** Applies a change immediately, and saves it shortly after. */
export function setPrefs(patch: Partial<Prefs>): void {
  recordChange(patch)
  usePrefs.setState((s) => ({ prefs: { ...s.prefs, ...patch } }))
  pending = { ...pending, ...patch }
  clearTimeout(timer)
  timer = setTimeout(() => {
    const send = pending
    pending = {}
    window.api.setPrefs(send).then((prefs) => usePrefs.setState({ prefs: { ...prefs, ...pending } }))
  }, 150)
}

export function resetPrefs(keys: (keyof Prefs)[]): void {
  setPrefs(Object.fromEntries(keys.map((k) => [k, DEFAULT_PREFS[k]])) as Partial<Prefs>)
}

/** The shortcut a command uses: your override, or its default. */
export function effectiveShortcut(id: string, defaultShortcut: string | undefined): string | null {
  const overrides = usePrefs.getState().prefs.shortcuts
  return id in overrides ? overrides[id] : (defaultShortcut ?? null)
}

export function setShortcut(id: string, shortcut: string | null, defaultShortcut: string | undefined): void {
  const shortcuts = { ...usePrefs.getState().prefs.shortcuts }
  if (shortcut === (defaultShortcut ?? null)) delete shortcuts[id]
  else shortcuts[id] = shortcut
  setPrefs({ shortcuts })
}

usePrefs.subscribe((s) => applyAppearance(s.prefs))
useThemes.subscribe(() => applyAppearance(usePrefs.getState().prefs))
watchSystemTheme(() => usePrefs.getState().prefs)

const watchSystemDark = (onChange: () => void): (() => void) => {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** The theme showing now (yours, or your light or dark one when matching the system). */
export function useActiveTheme(): Theme {
  const dark = useSyncExternalStore(watchSystemDark, systemDark)
  const id = usePrefs((s) => activeThemeId(s.prefs, dark))
  useThemes((s) => s.themes) // an imported theme can change or go
  return getTheme(id)
}
