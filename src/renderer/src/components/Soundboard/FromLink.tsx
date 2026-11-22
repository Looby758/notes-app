import { useEffect, useRef, useState } from 'react'
import { Link2, Play, Plus, Square, X } from 'lucide-react'
import { cleanPart, firstPart, nameFromTitle, partTime } from '@shared/soundLink'
import { setBoardStatus } from '../../lib/soundboard'
import { notify } from '../../store/notify'
import { errorMessage } from '../../lib/paths'

/**
 * "From a link": paste a YouTube or TikTok link, Orbit downloads its sound (with the video
 * downloader), you pick the part on a waveform and it becomes a button. The preview plays on your
 * own speakers only, never into the call. See main/soundFromLink.ts.
 */

type Stage = { kind: 'paste' } | { kind: 'fetching'; id: string; done: number | null } | { kind: 'pick'; id: string; title: string; buffer: AudioBuffer }

const newId = (): string => Math.random().toString(36).slice(2, 12)

export default function FromLink({ onClose, startLink = '' }: { onClose: () => void; startLink?: string }) {
  const [link, setLink] = useState(startLink)
  const [stage, setStage] = useState<Stage>({ kind: 'paste' })
  const [error, setError] = useState<string | null>(null)
  const current = useRef<string | null>(null)

  useEffect(
    () =>
      window.api.onSoundLinkProgress((id, done) => {
        setStage((s) => (s.kind === 'fetching' && s.id === id ? { ...s, done } : s))
      }),
    []
  )
  // The downloaded sound is thrown away when the box closes.
  useEffect(
    () => () => {
      if (current.current) void window.api.soundLinkForget(current.current)
    },
    []
  )

  const fetchIt = async (): Promise<void> => {
    if (!link.trim()) return
    const id = newId()
    current.current = id
    setError(null)
    setStage({ kind: 'fetching', id, done: null })
    try {
      const got = await window.api.soundLinkFetch(id, link.trim())
      if (current.current !== id) return
      const ctx = new OfflineAudioContext(1, 1, 44100)
      const buffer = await ctx.decodeAudioData(got.bytes.buffer.slice(got.bytes.byteOffset, got.bytes.byteOffset + got.bytes.byteLength) as ArrayBuffer)
      setStage({ kind: 'pick', id, title: got.title, buffer })
    } catch (err) {
      if (current.current !== id) return
      const msg = errorMessage(err)
      setError(msg === 'Stopped.' ? null : /decode|Unable to/i.test(msg) ? 'That sound couldn’t be read. Try another link.' : msg)
      setStage({ kind: 'paste' })
    }
  }

  const cancel = (): void => {
    if (current.current) void window.api.soundLinkForget(current.current)
    current.current = null
    setStage({ kind: 'paste' })
  }

  return (
    <div className="sb-editor sb-link" data-sound-link>
      <header>
        <h3>
          <Link2 size={13} /> Sound from a link
        </h3>
        <button className="icon-btn" title="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      {stage.kind !== 'pick' && (
        <form
          className="sb-link-paste"
          onSubmit={(e) => {
            e.preventDefault()
            void fetchIt()
          }}
        >
          <input
            autoFocus
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Paste a YouTube, TikTok, Instagram or X link"
            disabled={stage.kind === 'fetching'}
            aria-label="Link"
            data-sound-link-input
          />
          {stage.kind === 'fetching' ? (
            <button type="button" className="btn" onClick={cancel}>
              Stop
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={!link.trim()} data-sound-link-get>
              Get the sound
            </button>
          )}
        </form>
      )}
      {stage.kind === 'fetching' && (
        <div className="sb-link-progress">
          <div className="sb-link-bar">
            <div style={{ width: `${Math.round((stage.done ?? 0) * 100)}%` }} className={stage.done === null ? 'busy' : ''} />
          </div>
          <span>{stage.done === null ? 'Getting the sound…' : `Downloading the sound… ${Math.round(stage.done * 100)}%`}</span>
        </div>
      )}
      {error && <p className="sb-bad">{error}</p>}
      {stage.kind === 'paste' && !error && <p className="sb-hint">Only the sound is downloaded. Then you pick the part you want and it becomes a button.</p>}
      {stage.kind === 'pick' && (
        <PartPicker
          id={stage.id}
          title={stage.title}
          buffer={stage.buffer}
          onAnother={cancel}
          onDone={() => {
            current.current = null
            void window.api.soundLinkForget(stage.id)
            onClose()
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Picking the part

/** The loudest point in each column, for drawing (0–1). */
function peaks(buffer: AudioBuffer, from: number, to: number, columns: number): Float32Array {
  const out = new Float32Array(columns)
  const rate = buffer.sampleRate
  const a = Math.max(0, Math.floor(from * rate))
  const b = Math.min(buffer.length, Math.ceil(to * rate))
  const per = Math.max(1, (b - a) / columns)
  const chans = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i))
  for (let c = 0; c < columns; c++) {
    const s = Math.floor(a + c * per)
    const e = Math.min(b, Math.floor(a + (c + 1) * per))
    // Long stretches are sampled, so a long video draws quickly.
    const step = Math.max(1, Math.floor((e - s) / 400))
    let max = 0
    for (const data of chans) for (let i = s; i < e; i += step) max = Math.max(max, Math.abs(data[i]))
    out[c] = Math.min(1, max)
  }
  return out
}

function useCanvasWave(canvas: React.RefObject<HTMLCanvasElement | null>, buffer: AudioBuffer, from: number, to: number, part: { start: number; end: number }): void {
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const draw = (): void => {
      const dpr = window.devicePixelRatio || 1
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h) return
      el.width = Math.round(w * dpr)
      el.height = Math.round(h * dpr)
      const c = el.getContext('2d')!
      c.scale(dpr, dpr)
      c.clearRect(0, 0, w, h)
      const cols = Math.max(1, Math.floor(w / 2))
      const p = peaks(buffer, from, to, cols)
      const style = getComputedStyle(el)
      const on = style.getPropertyValue('--wave-on').trim() || '#7c6cf2'
      const off = style.getPropertyValue('--wave-off').trim() || '#888'
      const span = Math.max(0.001, to - from)
      for (let i = 0; i < cols; i++) {
        const t = from + ((i + 0.5) / cols) * span
        const bar = Math.max(1, p[i] * (h - 4))
        c.fillStyle = t >= part.start && t <= part.end ? on : off
        c.fillRect(i * 2, (h - bar) / 2, 1.4, bar)
      }
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(el)
    return () => ro.disconnect()
  }, [canvas, buffer, from, to, part.start, part.end])
}

/** The stretch shown close up: the part with some room either side (fixed while a handle is dragged). */
function zoomFor(part: { start: number; end: number }, duration: number): { from: number; to: number } {
  const len = part.end - part.start
  const pad = Math.max(2, len * 0.6)
  return { from: Math.max(0, part.start - pad), to: Math.min(duration, part.end + pad) }
}

function PartPicker({ id, title, buffer, onAnother, onDone }: { id: string; title: string; buffer: AudioBuffer; onAnother: () => void; onDone: () => void }) {
  const duration = buffer.duration
  const [part, setPart] = useState(() => firstPart(duration))
  const [zoom, setZoom] = useState(() => zoomFor(firstPart(duration), duration))
  const [name, setName] = useState(() => nameFromTitle(title))
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const overview = useRef<HTMLCanvasElement>(null)
  const detail = useRef<HTMLCanvasElement>(null)
  const detailBox = useRef<HTMLDivElement>(null)
  const player = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode; started: number; from: number } | null>(null)

  useCanvasWave(overview, buffer, 0, duration, part)
  useCanvasWave(detail, buffer, zoom.from, zoom.to, part)

  const stop = (): void => {
    const p = player.current
    player.current = null
    if (p) {
      try {
        p.src.stop()
      } catch {
        // Already finished.
      }
      void p.ctx.close()
    }
    setPlaying(false)
    setAt(null)
  }
  useEffect(() => stop, [])

  const play = (from = part.start): void => {
    stop()
    const ctx = new AudioContext()
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    src.start(0, from, Math.max(0.05, part.end - from))
    src.onended = () => player.current?.src === src && stop()
    player.current = { ctx, src, started: ctx.currentTime, from }
    setPlaying(true)
  }

  // The playhead.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = (): void => {
      const p = player.current
      if (p) setAt(p.from + (p.ctx.currentTime - p.started))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const setAndZoom = (next: { start: number; end: number }): void => {
    setPart(next)
    setZoom(zoomFor(next, duration))
  }

  // Clicking the whole-video strip moves the part there (same length).
  const onOverview = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const box = e.currentTarget.getBoundingClientRect()
    const t = ((e.clientX - box.left) / box.width) * duration
    const len = part.end - part.start
    const start = Math.max(0, Math.min(duration - len, t - len / 2))
    stop()
    setAndZoom(cleanPart(start, start + len, duration))
  }

  // Dragging the handles in the close-up; the close-up re-centres once you let go.
  const drag = (which: 'start' | 'end' | 'move') => (e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    stop()
    const box = detailBox.current!.getBoundingClientRect()
    const span = zoom.to - zoom.from
    const timeAt = (x: number): number => zoom.from + Math.min(1, Math.max(0, (x - box.left) / box.width)) * span
    const grab = timeAt(e.clientX)
    const was = part
    let latest = part
    const move = (x: number): void => {
      const t = timeAt(x)
      if (which === 'start') latest = cleanPart(Math.min(t, was.end - 0.1), was.end, duration, 'start')
      else if (which === 'end') latest = cleanPart(was.start, Math.max(t, was.start + 0.1), duration, 'end')
      else {
        const len = was.end - was.start
        const start = Math.max(0, Math.min(duration - len, was.start + (t - grab)))
        latest = cleanPart(start, start + len, duration)
      }
      setPart(latest)
    }
    const onMove = (ev: PointerEvent): void => move(ev.clientX)
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setZoom(zoomFor(latest, duration))
      if (which !== 'move') play(latest.start)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const make = async (): Promise<void> => {
    stop()
    setBusy(true)
    try {
      const res = await window.api.soundLinkMake(id, part.start, part.end, name.trim() || nameFromTitle(title))
      setBoardStatus(res.status)
      notify(`Added “${name.trim() || nameFromTitle(title)}” to the soundboard.`, 'info')
      onDone()
    } catch (err) {
      notify(`Couldn’t make the button: ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const span = zoom.to - zoom.from
  const x = (t: number): string => `${((t - zoom.from) / span) * 100}%`
  const len = part.end - part.start

  return (
    <div className="sb-link-pick" data-sound-link-pick>
      <p className="sb-link-title" title={title}>
        {title} <em>{partTime(duration)}</em>
      </p>
      <div className="sb-link-overview" title="Click to jump the part to here">
        <canvas ref={overview} onPointerDown={onOverview} />
        <div className="sb-link-window" style={{ left: `${(zoom.from / duration) * 100}%`, width: `${((zoom.to - zoom.from) / duration) * 100}%` }} />
      </div>
      <div className="sb-link-detail" ref={detailBox}>
        <canvas ref={detail} />
        <div className="sb-link-part" style={{ left: x(part.start), width: `${(len / span) * 100}%` }} onPointerDown={drag('move')} title="Drag to move the part" />
        <div className="sb-link-handle" style={{ left: x(part.start) }} onPointerDown={drag('start')} title="Start" data-sound-link-start />
        <div className="sb-link-handle" style={{ left: x(part.end) }} onPointerDown={drag('end')} title="End" data-sound-link-end />
        {at !== null && at >= zoom.from && at <= zoom.to && <div className="sb-link-playhead" style={{ left: x(at) }} />}
      </div>
      <div className="sb-link-times">
        <span>
          {partTime(part.start)} to {partTime(part.end)}
        </span>
        <em>{len.toFixed(1)} s</em>
        <span className="sb-gap" />
        <button className="btn" onClick={() => (playing ? stop() : play())} data-sound-link-play>
          {playing ? <Square size={12} /> : <Play size={12} />} {playing ? 'Stop' : 'Play the part'}
        </button>
      </div>
      <label>
        Button name
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void make()} />
      </label>
      <div className="sb-link-actions">
        <button className="btn" onClick={onAnother} disabled={busy}>
          Another link
        </button>
        <span className="sb-gap" />
        <button className="btn btn-primary" onClick={() => void make()} disabled={busy} data-sound-link-make>
          <Plus size={13} /> {busy ? 'Making it…' : 'Make it a button'}
        </button>
      </div>
    </div>
  )
}
