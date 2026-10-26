import type { PointerEvent } from 'react'
import { SIDEBAR_MAX, SIDEBAR_MIN, useUI } from '../store/ui'

/** A thin drag handle on a sidebar's inner edge. Double-click resets the width. */
export default function Resizer({ side }: { side: 'left' | 'right' }) {
  const key = side === 'left' ? 'leftWidth' : 'rightWidth'

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = useUI.getState()[key]
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    document.body.classList.add('resizing')

    const onMove = (ev: globalThis.PointerEvent): void => {
      const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX
      const width = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + delta)))
      useUI.setState({ [key]: width } as Pick<ReturnType<typeof useUI.getState>, typeof key>)
    }
    const onUp = (): void => {
      document.body.classList.remove('resizing')
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  return (
    <div
      className={`resizer ${side}`}
      onPointerDown={onPointerDown}
      onDoubleClick={() => useUI.setState({ [key]: side === 'left' ? 260 : 280 } as Pick<ReturnType<typeof useUI.getState>, typeof key>)}
      title="Drag to resize · double-click to reset"
    />
  )
}
