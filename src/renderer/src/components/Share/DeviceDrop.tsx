import './share.css'
import { useEffect, useState, type DragEvent } from 'react'
import { Laptop, Monitor, Smartphone } from 'lucide-react'
import type { DropTarget } from '@shared/types'
import { notify } from '../../store/notify'
import { errorMessage } from '../../lib/paths'

/** The other computer and the phone, while they're connected (for "Send to" menus). */
export function useDropTargets(): DropTarget[] {
  const [targets, setTargets] = useState<DropTarget[]>([])
  useEffect(() => {
    void window.api.dropTargets().then(setTargets)
    return window.api.onDropTargets(setTargets)
  }, [])
  return targets
}

/** Sends files to a device and says how it went. */
export function sendToDevice(target: DropTarget, paths: string[]): void {
  if (!paths.length) return notify('Only files can be sent.')
  window.api
    .dropSend(target.id, paths)
    .then((message) => notify(message, 'info'))
    .catch((err) => notify(errorMessage(err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
}

/**
 * Drop between devices: while files are dragged over Orbit (from File Explorer / Finder, the desktop
 * or Orbit's own Files), your other computer and your phone pop up at the bottom. Drop on one and the
 * files go there, AirDrop-style.
 */
export default function DeviceDrop() {
  const targets = useDropTargets()
  const [dragging, setDragging] = useState(false)
  const [over, setOver] = useState<string | null>(null)

  useEffect(() => {
    // dragenter/dragleave fire for every element crossed: count them to know when the drag has left the window.
    let depth = 0
    let safety: ReturnType<typeof setTimeout> | undefined
    const hide = (): void => {
      depth = 0
      setDragging(false)
      setOver(null)
    }
    const enter = (e: globalThis.DragEvent): void => {
      if (!e.dataTransfer?.types.includes('Files')) return
      depth++
      setDragging(true)
      clearTimeout(safety)
      safety = setTimeout(hide, 30_000)
    }
    const leave = (e: globalThis.DragEvent): void => {
      if (!e.dataTransfer?.types.includes('Files')) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) hide()
    }
    window.addEventListener('dragenter', enter, true)
    window.addEventListener('dragleave', leave, true)
    window.addEventListener('drop', hide, true)
    window.addEventListener('dragend', hide, true)
    return () => {
      clearTimeout(safety)
      window.removeEventListener('dragenter', enter, true)
      window.removeEventListener('dragleave', leave, true)
      window.removeEventListener('drop', hide, true)
      window.removeEventListener('dragend', hide, true)
    }
  }, [])

  if (!dragging || targets.length === 0) return null

  const drop = (target: DropTarget) => (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    setOver(null)
    sendToDevice(
      target,
      [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)
    )
  }

  return (
    <div className="device-drop" role="region" aria-label="Send to a device">
      <span className="device-drop-label">Drop to send to</span>
      {targets.map((t) => {
        const Icon = t.id === 'phone' ? Smartphone : t.os === 'mac' ? Laptop : Monitor
        return (
          <div
            key={t.id}
            className={`device-drop-target ${over === t.id ? 'over' : ''}`}
            onDragEnter={(e) => {
              e.preventDefault()
              setOver(t.id)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDragLeave={() => setOver((o) => (o === t.id ? null : o))}
            onDrop={drop(t)}
          >
            <Icon size={26} />
            <span>{t.name}</span>
          </div>
        )
      })}
    </div>
  )
}
