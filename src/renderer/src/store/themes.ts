import { create } from 'zustand'
import { setImportedThemes, type Theme } from '@shared/themes'

/** Themes you imported from theme files (they live in the main process; this is the window's copy). */
export const useThemes = create<{ themes: Theme[] }>(() => ({ themes: [] }))

function setThemes(themes: Theme[]): void {
  setImportedThemes(themes)
  useThemes.setState({ themes })
}

export async function loadThemes(): Promise<void> {
  window.api.onThemesChanged(setThemes)
  setThemes(await window.api.listThemes())
}

/** Asks for a theme file and imports it; resolves with the theme, or an error to show. */
export async function importTheme(): Promise<{ theme?: Theme; error?: string }> {
  const result = await window.api.importTheme()
  if (result.theme) setThemes(await window.api.listThemes())
  return result
}

export async function removeTheme(id: string): Promise<void> {
  await window.api.removeTheme(id)
  setThemes(await window.api.listThemes())
}
