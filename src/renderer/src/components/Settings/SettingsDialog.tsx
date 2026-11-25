import { useEffect, useRef } from 'react'
import { useUI } from '../../store/ui'
import SettingsPage from './SettingsPage'

const close = (): void => useUI.setState({ settingsOpen: false })

/**
 * Settings as a panel over whatever page you're on (Nocturne style), instead of a tab of its own.
 * Opened by Ctrl+, the gear button, or any "Open settings" link (openSpecialTab(SETTINGS_TAB)).
 * Esc, the close button or clicking outside closes it.
 */
export default function SettingsDialog() {
  const open = useUI((s) => s.settingsOpen)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // Put focus back where it was (the note you were typing in) when Settings closes.
    const before = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      before?.focus?.()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="modal-backdrop settings-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()} data-settings-dialog>
      <div ref={box} className="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings">
        <SettingsPage onClose={close} />
      </div>
    </div>
  )
}
