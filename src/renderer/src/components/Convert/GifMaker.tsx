import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Pause, Play, X } from 'lucide-react'
import type { GifCaption, GifSettings } from '@shared/types'
import { CAPTION_FONTS, DEFAULT_CAPTION, drawCaption } from '../../lib/convert'

/**
 * The GIF maker: pick a few seconds of a video, crop it, change its speed and put a caption bar
 * on it. Everything shown here is what the GIF will look like; ffmpeg makes it afterwards.
 */

type Crop = NonNullable<GifSettings['crop']>

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
const WIDTHS = [240, 320, 400, 480, 640, 800]
const SMOOTHNESS: { label: string; fps: number }[] = [
  { label: 'Choppy (10 a second)', fps: 10 },
  { label: 'Normal (15 a second)', fps: 15 },
  { label: 'Smooth (24 a second)', fps: 24 }
]
const SHAPES: { label: string; ratio: number | null }[] = [
  { label: 'Whole video', ratio: null },
  { label: 'Square', ratio: 1 },
  { label: 'Wide 16:9', ratio: 16 / 9 },
  { label: 'Tall 9:16', ratio: 9 / 16 },
  { label: 'Portrait 4:5', ratio: 4 / 5 }
]
/** GIFs longer than this get very big; the clip is kept to it. */
const MAX_LENGTH = 30

export const defaultGif = (): GifSettings => ({ start: 0, end: 5, crop: null, speed: 1, fps: 15, width: 480, caption: null })

const clock = (t: number): string => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/** The biggest box of this shape that fits the video, in its middle. */
function centredCrop(ratio: number, vw: number, vh: number): Crop {
  const w = Math.min(vw, vh * ratio)
  const h = w / ratio
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h }
}

interface Props {
  file: File
  initial: GifSettings | undefined
  onClose: () => void
  onMake: (settings: GifSettings) => void
}

export default function GifMaker({ file, initial, onClose, onMake }: Props) {
  const url = useMemo(() => URL.createObjectURL(file), [file])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  const video = useRef<HTMLVideoElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const captionBox = useRef<HTMLDivElement>(null)

  const [gif, setGif] = useState<GifSettings>(initial ?? defaultGif())
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [now, setNow] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [noPreview, setNoPreview] = useState(false)
  const [shape, setShape] = useState<number | null>(initial?.crop ? -1 : null)
  /** The size of the video on screen, for drawing the crop box. */
  const [shown, setShown] = useState(1)

  const set = (patch: Partial<GifSettings>): void => setGif((g) => ({ ...g, ...patch }))
  const setCaption = (patch: Partial<GifCaption>): void => setGif((g) => ({ ...g, caption: { ...(g.caption ?? DEFAULT_CAPTION), ...patch } }))

  const onLoaded = (): void => {
    const v = video.current!
    setSize({ w: v.videoWidth, h: v.videoHeight })
    setDuration(v.duration)
    if (!initial) {
      const end = Math.min(v.duration, 5)
      setGif((g) => ({ ...g, start: 0, end, width: Math.min(480, v.videoWidth - (v.videoWidth % 2)) }))
    }
    v.currentTime = initial?.start ?? 0
  }

  // Keeps the on-screen scale up to date as the window resizes.
  useEffect(() => {
    const el = frame.current
    if (!el || !size) return
    const measure = (): void => setShown(el.clientWidth / size.w)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [size])

  // Plays just the clip, round and round, at the chosen speed (like the GIF will).
  useEffect(() => {
    const v = video.current
    if (!v) return
    v.playbackRate = gif.speed
    let raf = 0
    const tick = (): void => {
      setNow(v.currentTime)
      if (!v.paused && (v.currentTime >= gif.end || v.currentTime < gif.start - 0.25)) v.currentTime = gif.start
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [gif.start, gif.end, gif.speed])

  const togglePlay = (): void => {
    const v = video.current
    if (!v) return
    if (v.paused) {
      if (v.currentTime < gif.start || v.currentTime >= gif.end) v.currentTime = gif.start
      void v.play()
    } else v.pause()
  }

  const seek = (t: number): void => {
    if (video.current) video.current.currentTime = t
  }

  const setStart = (t: number): void => {
    const max = duration ?? Infinity
    const start = clamp(t, 0, max)
    // The end follows along so the clip keeps its length (and never gets too long).
    let end = Math.max(gif.end, start + 0.2)
    if (end - start > MAX_LENGTH) end = start + MAX_LENGTH
    set({ start, end: Math.min(end, max) })
    seek(start)
  }
  const setEnd = (t: number): void => {
    const end = clamp(t, gif.start + 0.2, Math.min(duration ?? Infinity, gif.start + MAX_LENGTH))
    set({ end })
    seek(Math.max(gif.start, end - 0.5))
  }

  const pickShape = (i: number): void => {
    setShape(i)
    const ratio = SHAPES[i].ratio
    if (!size) return
    set({ crop: ratio ? centredCrop(ratio, size.w, size.h) : null })
  }

  // Dragging the crop box: inside moves it, the corner handle resizes it (keeping its shape).
  const drag = (e: ReactPointerEvent, mode: 'move' | 'resize'): void => {
    if (!gif.crop || !size) return
    e.preventDefault()
    e.stopPropagation()
    const from = { x: e.clientX, y: e.clientY, crop: gif.crop }
    const ratio = from.crop.w / from.crop.h
    const free = shape === null || SHAPES[shape]?.ratio === null || shape === -1
    const onMove = (ev: PointerEvent): void => {
      const dx = (ev.clientX - from.x) / shown
      const dy = (ev.clientY - from.y) / shown
      const c = from.crop
      if (mode === 'move') {
        set({ crop: { ...c, x: clamp(c.x + dx, 0, size.w - c.w), y: clamp(c.y + dy, 0, size.h - c.h) } })
      } else {
        let w = clamp(c.w + dx, 32, size.w - c.x)
        let h = free ? clamp(c.h + dy, 32, size.h - c.y) : w / ratio
        if (!free && c.y + h > size.h) {
          h = size.h - c.y
          w = h * ratio
        }
        set({ crop: { ...c, w, h } })
      }
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const freeCrop = (): void => {
    if (!size) return
    setShape(-1)
    set({ crop: gif.crop ?? { x: size.w * 0.1, y: size.h * 0.1, w: size.w * 0.8, h: size.h * 0.8 } })
  }

  // The caption as it'll look, drawn at the preview's width.
  const visibleWidth = size ? (gif.crop ? gif.crop.w : size.w) * shown : 480
  useEffect(() => {
    const box = captionBox.current
    if (!box) return
    box.replaceChildren()
    if (!gif.caption) return
    const canvas = drawCaption(gif.caption, Math.max(80, Math.round(visibleWidth)))
    if (canvas) box.append(canvas)
  }, [gif.caption, visibleWidth])

  const length = (gif.end - gif.start) / gif.speed
  const outHeight = gif.crop ? Math.round((gif.width * gif.crop.h) / gif.crop.w) : size ? Math.round((gif.width * size.h) / size.w) : null
  const max = duration ?? Math.max(gif.end, 60)

  const crop = gif.crop
  const cropStyle = crop && { left: crop.x * shown, top: crop.y * shown, width: crop.w * shown, height: crop.h * shown }

  // Over the whole window, not just this pane (a pane beside it in split view used to cover it).
  return createPortal(
    <div className="modal-backdrop gif-backdrop" onMouseDown={onClose}>
      <div className="modal gif-maker" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()} data-gif-maker>
        <header className="gif-head">
          <strong>Make a GIF</strong>
          <span title={file.name}>{file.name}</span>
          <button className="icon-btn" title="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </header>

        <div className="gif-body">
          <div className="gif-stage">
            <div className={`gif-preview ${gif.caption?.position === 'bottom' ? 'caption-bottom' : ''}`}>
              {gif.caption && <div className="gif-caption" ref={captionBox} style={{ width: visibleWidth, marginLeft: (crop?.x ?? 0) * shown }} />}
              <div className="gif-frame" ref={frame}>
                <video
                  ref={video}
                  src={url}
                  muted
                  playsInline
                  onLoadedMetadata={onLoaded}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onError={() => setNoPreview(true)}
                  onClick={togglePlay}
                />
                {cropStyle && (
                  <div className="gif-crop" style={cropStyle} onPointerDown={(e) => drag(e, 'move')}>
                    <span className="gif-crop-handle" onPointerDown={(e) => drag(e, 'resize')} />
                  </div>
                )}
              </div>
            </div>
            {noPreview && <p className="gif-note">This kind of video can’t be shown here, but the GIF can still be made. Type the times in below.</p>}

            <div className="gif-timeline">
              <button className="icon-btn" title={playing ? 'Pause' : 'Play the clip'} onClick={togglePlay} disabled={noPreview}>
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <div className="gif-range">
                <input type="range" min={0} max={max} step={0.05} value={now} onChange={(e) => seek(Number(e.target.value))} disabled={noPreview} />
                <div className="gif-range-clip" style={{ left: `${(gif.start / max) * 100}%`, width: `${((gif.end - gif.start) / max) * 100}%` }} />
              </div>
              <span className="gif-time">{clock(now)}</span>
            </div>
            <div className="gif-clip">
              <label>
                Starts at
                <input type="number" className="text-input" min={0} step={0.1} value={Number(gif.start.toFixed(2))} onChange={(e) => setStart(Number(e.target.value))} />
              </label>
              <button className="btn" onClick={() => setStart(now)} disabled={noPreview}>
                Start here
              </button>
              <label>
                Ends at
                <input type="number" className="text-input" min={0} step={0.1} value={Number(gif.end.toFixed(2))} onChange={(e) => setEnd(Number(e.target.value))} />
              </label>
              <button className="btn" onClick={() => setEnd(now)} disabled={noPreview}>
                End here
              </button>
              <span className="gif-length">{length.toFixed(1)} second GIF</span>
            </div>
          </div>

          <div className="gif-options">
            <section>
              <h4>Crop</h4>
              <div className="gif-chips">
                {SHAPES.map((s, i) => (
                  <button key={s.label} className={`gif-chip ${(shape ?? 0) === i ? 'on' : ''}`} onClick={() => pickShape(i)} disabled={!size}>
                    {s.label}
                  </button>
                ))}
                <button className={`gif-chip ${shape === -1 ? 'on' : ''}`} onClick={freeCrop} disabled={!size}>
                  Free
                </button>
              </div>
              {crop && <small>Drag the box to move it, and its corner to resize it.</small>}
            </section>

            <section className="gif-row">
              <label>
                Speed
                <select className="select" value={gif.speed} onChange={(e) => set({ speed: Number(e.target.value) })}>
                  {SPEEDS.map((s) => (
                    <option key={s} value={s}>
                      {s === 1 ? 'Normal' : `${s}×`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Width
                <select className="select" value={gif.width} onChange={(e) => set({ width: Number(e.target.value) })}>
                  {[...new Set([...WIDTHS, gif.width])].sort((a, b) => a - b).map((w) => (
                    <option key={w} value={w}>
                      {w} pixels
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Smoothness
                <select className="select" value={gif.fps} onChange={(e) => set({ fps: Number(e.target.value) })}>
                  {SMOOTHNESS.map((s) => (
                    <option key={s.fps} value={s.fps}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            <section>
              <label className="gif-toggle">
                <input type="checkbox" checked={!!gif.caption} onChange={(e) => set({ caption: e.target.checked ? gif.caption ?? { ...DEFAULT_CAPTION } : null })} />
                <h4>Caption bar</h4>
              </label>
              {gif.caption && (
                <div className="gif-caption-options">
                  <textarea
                    className="text-input"
                    rows={2}
                    placeholder="Type your caption"
                    value={gif.caption.text}
                    onChange={(e) => setCaption({ text: e.target.value })}
                    autoFocus
                  />
                  <div className="gif-row">
                    <label>
                      Font
                      <input className="text-input" list="gif-fonts" value={gif.caption.font} onChange={(e) => setCaption({ font: e.target.value })} />
                      <datalist id="gif-fonts">
                        {CAPTION_FONTS.map((f) => (
                          <option key={f} value={f} />
                        ))}
                      </datalist>
                    </label>
                    <label>
                      Text size
                      <input type="range" min={0.04} max={0.16} step={0.005} value={gif.caption.size} onChange={(e) => setCaption({ size: Number(e.target.value) })} />
                    </label>
                    <label className="gif-inline">
                      <input type="checkbox" checked={gif.caption.bold} onChange={(e) => setCaption({ bold: e.target.checked })} /> Bold
                    </label>
                  </div>
                  <div className="gif-row">
                    <label className="gif-inline">
                      Text <input type="color" value={gif.caption.textColor} onChange={(e) => setCaption({ textColor: e.target.value })} />
                    </label>
                    <label className="gif-inline">
                      Bar <input type="color" value={gif.caption.barColor} onChange={(e) => setCaption({ barColor: e.target.value })} />
                    </label>
                    <div className="gif-chips">
                      {(['top', 'bottom'] as const).map((p) => (
                        <button key={p} className={`gif-chip ${gif.caption!.position === p ? 'on' : ''}`} onClick={() => setCaption({ position: p })}>
                          {p === 'top' ? 'At the top' : 'At the bottom'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>

        <footer className="gif-foot">
          <small>
            {gif.width}
            {outHeight ? ` × ${outHeight}` : ''} pixels{gif.caption?.text.trim() ? ' plus the caption' : ''}, {length.toFixed(1)} seconds
          </small>
          <div className="convert-spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onMake({ ...gif, caption: gif.caption?.text.trim() ? gif.caption : null })} data-gif-make>
            Make GIF
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
