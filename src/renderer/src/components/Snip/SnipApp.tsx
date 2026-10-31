import './snip.css'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Copy, FilePlus, Globe, Languages, Loader2, Sparkles, X } from 'lucide-react'

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const norm = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y)
})

/**
 * The screen snip window (#snip): a still picture of your screen, full screen. Drag a box round
 * some text; Orbit reads it and offers to copy it, save it, search, translate or ask the AI.
 */
export default function SnipApp() {
  const [image, setImage] = useState<{ url: string; scale: number } | null>(null)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [done, setDone] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const img = useRef<HTMLImageElement>(null)

  useEffect(() => {
    let url = ''
    window.api.snipImage().then((shot) => {
      if (!shot) {
        void window.api.snipClose()
        return
      }
      url = URL.createObjectURL(new Blob([shot.png as BlobPart], { type: 'image/png' }))
      setImage({ url, scale: shot.scale })
    })
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void window.api.snipClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (url) URL.revokeObjectURL(url)
    }
  }, [])

  const read = async (b: Box): Promise<void> => {
    const el = img.current
    if (!el || b.w < 6 || b.h < 6) {
      setBox(null)
      setDone(false)
      return
    }
    setReading(true)
    setError(null)
    // The picture is at the screen's full resolution; the window is in screen points.
    const sx = el.naturalWidth / el.clientWidth
    const sy = el.naturalHeight / el.clientHeight
    // Small text reads better a bit bigger.
    const up = b.h * sy < 60 ? 2 : 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(b.w * sx * up)
    canvas.height = Math.round(b.h * sy * up)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(el, b.x * sx, b.y * sy, b.w * sx, b.h * sy, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    try {
      const found = blob ? await window.api.snipRead(new Uint8Array(await blob.arrayBuffer())) : ''
      setText(found)
      if (!found) setError('No text found there. Try a bigger box, or one round just the words.')
    } catch {
      setError('Couldn’t read that. Try again.')
    } finally {
      setReading(false)
    }
  }

  const point = (e: MouseEvent): { x: number; y: number } => ({ x: e.clientX, y: e.clientY })

  const onDown = (e: MouseEvent): void => {
    if (e.button !== 0) return
    if ((e.target as Element).closest('.snip-panel')) return
    setStart(point(e))
    setBox({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
    setDone(false)
    setText(null)
    setError(null)
  }
  const onMove = (e: MouseEvent): void => {
    if (start) setBox(norm(start, point(e)))
  }
  const onUp = (e: MouseEvent): void => {
    if (!start) return
    const b = norm(start, point(e))
    setStart(null)
    setBox(b)
    setDone(true)
    void read(b)
  }

  const send = (action: 'copy' | 'note' | 'web' | 'translate' | 'ask'): void => {
    if (text) void window.api.snipSend(action, text)
  }

  // Keep the panel on screen: under the box, or above it near the bottom.
  const panelStyle = box
    ? {
        left: Math.min(Math.max(8, box.x), window.innerWidth - 428),
        top: box.y + box.h + 250 > window.innerHeight ? Math.max(8, box.y - 250) : box.y + box.h + 10
      }
    : {}

  return (
    <div className="snip" onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} data-snip>
      {image && <img ref={img} className="snip-shot" src={image.url} alt="" draggable={false} />}
      {box ? (
        <div className="snip-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
      ) : (
        <div className="snip-dim" />
      )}
      {!box && image && <div className="snip-hint">Drag a box round the text you want · Esc to cancel</div>}
      {done && box && box.w >= 6 && (
        <div className="snip-panel" style={panelStyle} onMouseDown={(e) => e.stopPropagation()} data-snip-panel>
          {reading ? (
            <p className="snip-reading">
              <Loader2 size={14} className="spin" /> Reading the text…
            </p>
          ) : error ? (
            <p className="snip-error">{error}</p>
          ) : (
            <>
              <textarea value={text ?? ''} onChange={(e) => setText(e.target.value)} rows={Math.min(8, (text ?? '').split('\n').length + 1)} autoFocus data-snip-text />
              <div className="snip-actions">
                <button className="btn btn-primary" onClick={() => send('copy')} data-snip-copy>
                  <Copy size={13} /> Copy
                </button>
                <button className="btn" onClick={() => send('note')} title="Add to today’s note">
                  <FilePlus size={13} /> Save
                </button>
                <button className="btn" onClick={() => send('web')} title="Search the web">
                  <Globe size={13} /> Search
                </button>
                <button className="btn" onClick={() => send('translate')} title="Translate into English">
                  <Languages size={13} /> Translate
                </button>
                <button className="btn" onClick={() => send('ask')} title="Ask the AI what this is">
                  <Sparkles size={13} /> Ask AI
                </button>
              </div>
            </>
          )}
          <button className="icon-btn snip-close" onClick={() => void window.api.snipClose()} title="Close (Esc)">
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  )
}
