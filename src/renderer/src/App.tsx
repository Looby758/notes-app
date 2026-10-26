import { useCallback, useEffect, useRef, useState } from 'react'
import WelcomeScreen from './components/WelcomeScreen'
import Shell from './components/Shell'
import { flushAll } from './lib/editorController'
import { loadPrefs } from './store/prefs'
import { saveCapture } from './lib/capture'

export default function App() {
  // undefined = still loading, null = no vault chosen yet
  const [vault, setVault] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    // Settings first, so the theme and editor options are right from the first frame.
    loadPrefs()
      .catch((err) => console.error('[prefs]', err))
      .then(() => window.api.getVault())
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
      window.api.onCaptureRequest(async (id, text) => {
        const result = vaultRef.current
          ? await saveCapture(text)
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

  if (vault === undefined) return <div className="app-loading" />
  if (vault === null) return <WelcomeScreen onPick={pickVault} />
  return <Shell vault={vault} onSwitchVault={pickVault} onCloseVault={closeVault} />
}
