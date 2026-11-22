import { useEffect, useRef, type RefObject } from 'react'

/**
 * Keys for a game, wherever you clicked in the window: the game doesn't need to be clicked first.
 * Keys typed into a text box or a note are left alone, and so are keys while the game's page is
 * hidden (another tab in front).
 */
export function useGameKeys(page: RefObject<HTMLElement | null>, onKey: (e: KeyboardEvent) => void): void {
  const handler = useRef(onKey)
  handler.current = onKey
  useEffect(() => {
    const listen = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return
      const el = page.current
      if (!el || !el.isConnected || el.offsetParent === null) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      // Space or Enter on a focused button presses that button, not the game.
      if (t?.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return
      // A dialog or menu open on top gets its keys.
      if (document.querySelector('[role="dialog"][aria-modal="true"], .modal-backdrop')) return
      handler.current(e)
    }
    window.addEventListener('keydown', listen)
    return () => window.removeEventListener('keydown', listen)
  }, [page])
}
