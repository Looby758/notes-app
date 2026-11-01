import './share.css'
import { useEffect, useState } from 'react'
import type { ShareOs } from '@shared/mouseShare'
import { IS_MAC } from '@shared/platform'

const BACK_KEYS = IS_MAC ? '⌃⌥Esc' : 'Ctrl+Alt+Esc'

/**
 * The invisible full-screen window that holds the mouse and keyboard while they're working the
 * other computer (mouse sharing). The pointer is locked here and hidden, and every move, click,
 * scroll and key is passed on. Ctrl+Alt+Esc brings the mouse back.
 */
export default function ShareCapture() {
  const [hint, setHint] = useState<{ name: string; os: ShareOs } | null>(null)

  useEffect(() => {
    const w = window as unknown as { __shareLock?: () => void }
    // Called by the main process with a "user gesture", which pointer lock needs.
    w.__shareLock = () => {
      try {
        void (document.body.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => undefined)
      } catch {
        // The main process notices it didn't lock and brings the mouse back.
      }
    }
    const locked = (): boolean => !!document.pointerLockElement
    const send = window.api.shareInput
    let wasLocked = false

    const move = (e: MouseEvent): void => {
      if (locked() && (e.movementX || e.movementY)) send({ t: 'move', dx: e.movementX, dy: e.movementY })
    }
    const button = (down: boolean) => (e: MouseEvent) => {
      e.preventDefault()
      if (locked() && e.button >= 0 && e.button <= 2) send({ t: 'btn', b: e.button as 0 | 1 | 2, down })
    }
    const wheel = (e: WheelEvent): void => {
      e.preventDefault()
      if (!locked()) return
      const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1
      send({ t: 'wheel', dx: e.deltaX * k, dy: e.deltaY * k })
    }
    const key = (down: boolean) => (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (down && e.code === 'Escape' && e.ctrlKey && e.altKey) return window.api.shareComeBack()
      if (e.code) send({ t: 'key', code: e.code, down })
    }
    const lockChange = (): void => {
      // Lost the pointer some other way (the system took it): bring the mouse home.
      if (wasLocked && !locked()) window.api.shareComeBack()
      wasLocked = locked()
    }
    const stop = (e: Event): void => e.preventDefault()

    const down = button(true)
    const up = button(false)
    const keyDown = key(true)
    const keyUp = key(false)
    document.addEventListener('mousemove', move)
    document.addEventListener('mousedown', down)
    document.addEventListener('mouseup', up)
    document.addEventListener('wheel', wheel, { passive: false })
    document.addEventListener('contextmenu', stop)
    document.addEventListener('auxclick', stop)
    window.addEventListener('keydown', keyDown, true)
    window.addEventListener('keyup', keyUp, true)
    document.addEventListener('pointerlockchange', lockChange)

    let hideTimer: ReturnType<typeof setTimeout> | undefined
    const off = window.api.onShareCapture((info) => {
      setHint(info)
      clearTimeout(hideTimer)
      hideTimer = setTimeout(() => setHint(null), 2500)
    })
    return () => {
      off()
      clearTimeout(hideTimer)
      delete w.__shareLock
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mousedown', down)
      document.removeEventListener('mouseup', up)
      document.removeEventListener('wheel', wheel)
      document.removeEventListener('contextmenu', stop)
      document.removeEventListener('auxclick', stop)
      window.removeEventListener('keydown', keyDown, true)
      window.removeEventListener('keyup', keyUp, true)
      document.removeEventListener('pointerlockchange', lockChange)
    }
  }, [])

  return (
    <div className="share-capture">
      {hint && (
        <div className="share-capture-hint">
          Mouse and keyboard are on <strong>{hint.name}</strong> · {BACK_KEYS} brings them back
        </div>
      )}
    </div>
  )
}
