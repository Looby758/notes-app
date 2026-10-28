import { themeFileUrl } from '@shared/themePack'
import { useActiveTheme } from '../../store/prefs'

/** How long an imported theme's loading screen stays up, so you get to see it. */
export const THEME_LOADING_MS = 1400

/** While Notes starts: plain, or an imported theme's own words and picture. */
export default function LoadingScreen() {
  const theme = useActiveTheme()
  const loading = theme.pack?.loading
  return (
    <div className="app-loading">
      {loading && (
        <div className="theme-loading" data-theme-loading>
          {loading.picture && <div className="theme-loading-picture" style={{ backgroundImage: `url("${themeFileUrl(theme.id, loading.picture)}")` }} />}
          {loading.text && (
            <span className="theme-loading-text" style={loading.color ? { color: loading.color } : undefined}>
              {loading.text}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
