import { useCallback, useEffect, useRef, useState } from 'react'
import WelcomeScreen from './components/WelcomeScreen'
import Shell from './components/Shell'
import { flushAll } from './lib/editorController'
import { loadPrefs, usePrefs } from './store/prefs'
import { activeThemeId, getTheme } from '@shared/themes'
import LoadingScreen, { THEME_LOADING_MS } from './components/Theme/LoadingScreen'
import { systemDark } from './lib/appearance'
import { saveCapture } from './lib/capture'

export default function App() {
  // undefined = still loading, null = no vault chosen yet
  const [vault, setVault] = useState<string | null | undefined>(undefined)
  // An imported theme's loading screen stays up a moment, so you get to see it.
  const [showingLoading, setShowingLoading] = useState(true)

  useEffect(() => {
    // Settings first, so the theme and editor options are right from the first frame.
    loadPrefs()
      .catch((err) => console.error('[prefs]', err))
      .then(() => {
        const { prefs } = usePrefs.getState()
        const hasLoading = !!getTheme(activeThemeId(prefs, systemDark())).pack?.loading
        if (hasLoading) setTimeout(() => setShowingLoading(false), THEME_LOADING_MS)
        else setShowingLoading(false)
        return window.api.getVault()
      })
      .then(setVault)
    // Save any pending edits before the window closes.
    return window.api.onBeforeClose(async () => {
      await flushAll()
      window.api.readyToClose()
    })
  }, [])

  // Quick capture (from the small capture window) is saved here, where the notes are loaded.
  const vaultRef = useRef(vault)
  vaultRef.current = vault
  useEffect(
    () =>
      window.api.onCaptureRequest(async (id, request) => {
        const result = vaultRef.current
          ? await saveCapture(request)
          : { ok: false, error: 'Open Notes and choose a notes folder first.' }
        window.api.captureResult(id, result)
      }),
    []
  )

  const pickVault = useCallback(async () => {
    await flushAll()
    const path = await window.api.pickVault()
    if (path) setVault(path)
  }, [])

  const closeVault = useCallback(async () => {
    await flushAll()
    await window.api.closeVault()
    setVault(null)
  }, [])

  if (vault === undefined || showingLoading) return <LoadingScreen />
  if (vault === null) return <WelcomeScreen onPick={pickVault} />
  return <Shell vault={vault} onSwitchVault={pickVault} onCloseVault={closeVault} />
}
