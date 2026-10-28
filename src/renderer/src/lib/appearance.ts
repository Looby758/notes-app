import type { Prefs } from '@shared/prefs'
import { activeThemeId, getTheme, type ThemeColors } from '@shared/themes'
import { effectiveMotion, watchSystemMotion } from './motion'

// -apple-system / SF Mono are the Mac's own; Windows skips them.
const UI_FALLBACK = "'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
const MONO_FALLBACK = "'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace"

const NOTE_WIDTHS: Record<Prefs['noteWidth'], string> = {
  narrow: '620px',
  medium: '740px',
  wide: '940px',
  full: '100%'
}

/** bgPanel → --bg-panel */
const cssVar = (key: keyof ThemeColors): string => '--' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

const fontStack = (font: string, fallback: string): string => (font ? `'${font}', ${fallback}` : fallback)

/** The theme last put on the page, so a change of theme can cross-fade. */
let shownTheme: string | null = null

/** Applies the look-and-feel preferences to the page as CSS variables and body classes. */
export function applyAppearance(p: Prefs): void {
  const motion = effectiveMotion(p.motion)
  document.documentElement.dataset.motion = motion
  const themeId = activeThemeId(p, systemDark())
  const fade = shownTheme !== null && shownTheme !== themeId && motion !== 'off' && 'startViewTransition' in document
  shownTheme = themeId
  // The browser snapshots the old colours and fades them into the new ones.
  if (fade) document.startViewTransition(() => paint(p, themeId))
  else paint(p, themeId)
}

function paint(p: Prefs, themeId: string): void {
  const root = document.documentElement.style
  const theme = getTheme(themeId)
  for (const [key, value] of Object.entries(theme.colors) as [keyof ThemeColors, string][]) {
    root.setProperty(cssVar(key), value)
  }
  root.setProperty('--accent', p.accent || theme.accent)
  root.setProperty('--font-ui', fontStack(p.uiFont, UI_FALLBACK))
  root.setProperty('--font-editor', fontStack(p.editorFont, p.uiFont ? `'${p.uiFont}', ${UI_FALLBACK}` : UI_FALLBACK))
  root.setProperty('--font-mono', fontStack(p.codeFont, MONO_FALLBACK))
  root.setProperty('--editor-font-size', `${p.editorFontSize}px`)
  root.setProperty('--editor-line-height', String(p.lineHeight))
  root.setProperty('--editor-width', NOTE_WIDTHS[p.noteWidth])

  root.setProperty('color-scheme', theme.light ? 'light' : 'dark')

  const body = document.body.classList
  body.toggle('theme-light', !!theme.light)
  body.toggle('density-compact', p.density === 'compact')
  body.toggle('hide-statusbar', !p.showStatusBar)
}

const darkQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null
const systemDark = (): boolean => darkQuery?.matches ?? true

/** Re-applies the look when the system switches between light and dark (for "match my system"). */
export function watchSystemTheme(current: () => Prefs): () => void {
  const onChange = (): void => {
    if (current().followSystem) applyAppearance(current())
  }
  darkQuery?.addEventListener('change', onChange)
  // Motion follows the system's reduce-motion setting too.
  const offMotion = watchSystemMotion(() => applyAppearance(current()))
  return () => {
    darkQuery?.removeEventListener('change', onChange)
    offMotion()
  }
}