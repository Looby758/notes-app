import { create } from 'zustand'
import { DEFAULT_PREFS, type Prefs } from '@shared/prefs'
import { applyAppearance } from '../lib/appearance'

/** Your Settings. The main process stores them in settings.json and checks every value. */
export const usePrefs = create<{ prefs: Prefs }>(() => ({ prefs: DEFAULT_PREFS }))

/** Changes not yet sent to the main process (sliders send many in a row). */
let pending: Partial<Prefs> = {}
let timer: ReturnType<typeof setTimeout> | undefined

export async function loadPrefs(): Promise<void> {
  usePrefs.setState({ prefs: await window.api.getPrefs() })
  window.api.onPrefsChanged((prefs) => {
    // Don't let an older broadcast undo what you're dragging right now.
    usePrefs.setState({ prefs: { ...prefs, ...pending } })
  })
}

/** Applies a change immediately, and saves it shortly after. */
export function setPrefs(patch: Partial<Prefs>): void {
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
