import type { Prefs } from '@shared/prefs'
import { activeThemeId, getTheme, type Theme, type ThemeColors } from '@shared/themes'
import { themeFileUrl } from '@shared/themePack'

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
  const theme = getTheme(activeThemeId(p, systemDark()))
  for (const [key, value] of Object.entries(theme.colors) as [keyof ThemeColors, string][]) {
    root.setProperty(cssVar(key), value)
  }
  root.setProperty('--accent', p.accent || theme.accent)
  // Fonts you picked win over a theme's fonts, which win over the built-in ones.
  const fonts = themeFonts(theme)
  const uiFont = p.uiFont || fonts.ui || ''
  root.setProperty('--font-ui', fontStack(uiFont, UI_FALLBACK))
  root.setProperty('--font-editor', fontStack(p.editorFont || fonts.editor || '', uiFont ? `'${uiFont}', ${UI_FALLBACK}` : UI_FALLBACK))
  root.setProperty('--font-headings', fonts.headings ? `'${fonts.headings}', var(--font-editor)` : 'var(--font-editor)')
  root.setProperty('--picture-strength', String(theme.pack?.pictureStrength ?? 0))
  root.setProperty('--font-mono', fontStack(p.codeFont, MONO_FALLBACK))
  root.setProperty('--editor-font-size', `${p.editorFontSize}px`)
  root.setProperty('--editor-line-height', String(p.lineHeight))
  root.setProperty('--editor-width', NOTE_WIDTHS[p.noteWidth])

  root.setProperty('color-scheme', theme.light ? 'light' : 'dark')

  const body = document.body.classList
  body.toggle('theme-light', !!theme.light)
  body.toggle('theme-headings', !!fonts.headings)
  body.toggle('theme-star-icon', !!theme.pack?.starIcon)
  body.toggle('density-compact', p.density === 'compact')
  body.toggle('reduce-motion', p.reduceMotion)
  body.toggle('hide-statusbar', !p.showStatusBar)
}

/** Fonts in imported themes, loaded once each; resolves to the family names to use. */
const loadedFonts = new Map<string, FontFace>()

function themeFonts(theme: Theme): { ui?: string; headings?: string; editor?: string } {
  const out: { ui?: string; headings?: string; editor?: string } = {}
  for (const [role, path] of Object.entries(theme.pack?.fonts ?? {}) as [keyof typeof out, string][]) {
    const url = themeFileUrl(theme.id, path)
    // A family name of plain characters, the same each time for the same file.
    const family = `Theme ${theme.id} ${path}`.replace(/[^\w -]/g, ' ')
    if (!loadedFonts.has(url) && typeof FontFace !== 'undefined') {
      const face = new FontFace(family, `url("${url}")`)
      loadedFonts.set(url, face)
      face.load().then((f) => document.fonts.add(f)).catch((err) => console.error('[theme font]', path, err))
    }
    out[role] = family
  }
  return out
}

const darkQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null
export const systemDark = (): boolean => darkQuery?.matches ?? true

/** Re-applies the look when the system switches between light and dark (for "match my system"). */
export function watchSystemTheme(current: () => Prefs): () => void {
  const onChange = (): void => {
    if (current().followSystem) applyAppearance(current())
  }
  darkQuery?.addEventListener('change', onChange)
  return () => darkQuery?.removeEventListener('change', onChange)
}