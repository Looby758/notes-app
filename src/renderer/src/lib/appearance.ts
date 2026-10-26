import type { Prefs } from '@shared/prefs'
import { getTheme, type ThemeColors } from '@shared/themes'

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

/** Applies the look-and-feel preferences to the page as CSS variables and body classes. */
export function applyAppearance(p: Prefs): void {
  const root = document.documentElement.style
  const theme = getTheme(p.theme)
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

  const body = document.body.classList
  body.toggle('density-compact', p.density === 'compact')
  body.toggle('reduce-motion', p.reduceMotion)
  body.toggle('hide-statusbar', !p.showStatusBar)
}
