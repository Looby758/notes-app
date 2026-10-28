import type { CSSProperties } from 'react'
import { pictureFor, themeFileUrl } from '@shared/themePack'
import { useActiveTheme, usePrefs } from '../../store/prefs'

/**
 * An imported theme's picture behind a part of the app (see THEME_PAGES), faded by the theme's
 * picture strength. Nothing when the theme has no picture there. `exact` skips the theme's
 * picture for everywhere (for small places like the sidebar and the music player).
 */
export default function ThemePicture({ page, exact }: { page: string; exact?: boolean }) {
  const theme = useActiveTheme()
  const picture = exact ? theme.pack?.pictures[page] : pictureFor(theme.pack, page)
  if (!picture) return null
  const style = { backgroundImage: `url("${themeFileUrl(theme.id, picture.file)}")`, backgroundPosition: picture.position } as CSSProperties
  return <div className="theme-picture" style={style} aria-hidden data-theme-picture={page} />
}

/** The accent a part of the app uses: its picture's own accent, if the theme gives one. */
export function usePageAccent(page: string): CSSProperties | undefined {
  const theme = useActiveTheme()
  const ownAccent = usePrefs((s) => s.prefs.accent)
  const accent = pictureFor(theme.pack, page)?.accent
  // An accent you picked yourself wins.
  if (!accent || ownAccent) return undefined
  // The softer accents are mixed from --accent once on the page, so they're redone here.
  return {
    ['--accent' as string]: accent,
    ['--accent-soft' as string]: `color-mix(in srgb, ${accent} 14%, transparent)`,
    ['--accent-dim' as string]: `color-mix(in srgb, ${accent} 45%, transparent)`,
    ['--accent-strong' as string]: `color-mix(in srgb, ${accent} 82%, white)`
  }
}
