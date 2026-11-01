import './popout.css'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { AppWindow, Crop, Eye, LayoutGrid, Loader2, Minus, Monitor, RefreshCw, Scan, X } from 'lucide-react'
import type { StudioCaptureSource } from '@shared/types'
import { FULL, composeCrop, cropFromDrag, cropStyle, isFull, nextOpacity, shownAspect, type CropBox } from '@shared/popout'

/**
 * The pop-out window (its own floating window, opened with #popout; main/popout.ts keeps it on
 * top). First it lists the apps and screens it can show; pick one and it shows live, filling the
 * window. Point at it for the bar: crop to just a part (drag a box), make it see-through, pick
 * another app, or close. You drag the window by the picture or the bar.
 */

interface Point {
  x: number
  y: number
}

async function capture(id: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth: 3840, maxHeight: 2160, maxFrameRate: 60 } } as unknown as MediaTrackConstraints
  })
}

export default function PopoutWindow() {
  const [sources, setSources] = useState<StudioCaptureSource[] | null>(null)
  const [source, setSource] = useState<StudioCaptureSource | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [problem, setProblem] = useState('')
  const [crop, setCrop] = useState<CropBox>(FULL)
  const [cropping, setCropping] = useState(false)
  const [drag, setDrag] = useState<{ a: Point; b: Point } | null>(null)
  const [opacity, setOpacity] = useState(1)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const area = useRef<HTMLDivElement>(null)

  const loadSources = useCallback(async () => {
    setSources(null)
    setSources(await window.api.popoutSources().catch(() => []))
  }, [])

  useEffect(() => {
    void window.api.popoutState().then((s) => setOpacity(s.opacity))
    void window.api.popoutPicker()
    void loadSources()
  }, [loadSources])

  // Stops capturing when the stream is replaced or the window closes.
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream])

  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream
  }, [stream])

  // The window takes the shape of what it shows.
  useEffect(() => {
    if (size) void window.api.fitPopout(shownAspect(size.w, size.h, crop))
  }, [size, crop])

  const backToList = (message = ''): void => {
    setStream(null)
    setSource(null)
    setSize(null)
    setCrop(FULL)
    setCropping(false)
    setProblem(message)
    void window.api.popoutPicker()
    void loadSources()
  }

  const show = async (s: StudioCaptureSource): Promise<void> => {
    setProblem('')
    try {
      const next = await capture(s.id)
      const track = next.getVideoTracks()[0]
      // The app was closed (or the screen unplugged): back to the list.
      track?.addEventListener('ended', () => backToList(`“${s.name}” closed, so there’s nothing to show. Pick another.`))
      setCrop(FULL)
      setSource(s)
      setStream(next)
    } catch (err) {
      setProblem(`Couldn’t show “${s.name}” (${err instanceof Error ? err.message : String(err)}). It may have just closed; try another.`)
      void loadSources()
    }
  }

  const seeThrough = (): void => {
    const next = nextOpacity(opacity)
    setOpacity(next)
    void window.api.setPopoutOpacity(next)
  }

  // ---- cropping: drag a box over the picture ----
  const at = (e: ReactPointerEvent): Point => {
    const box = area.current!.getBoundingClientRect()
    return { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height }
  }
  const onDown = (e: ReactPointerEvent): void => {
    if (!cropping || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = at(e)
    setDrag({ a: p, b: p })
  }
  const onMove = (e: ReactPointerEvent): void => {
    if (drag) setDrag({ a: drag.a, b: at(e) })
  }
  const onUp = (): void => {
    if (!drag) return
    const box = cropFromDrag(drag.a, drag.b)
    setDrag(null)
    if (!box) return
    setCrop((c) => composeCrop(c, box))
    setCropping(false)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (cropping) setCropping(false)
      else if (!source) void window.api.closePopout()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cropping, source])

  const bar = (
    <div className="popout-bar">
      <span className="popout-name" title={source?.name}>
        {source ? source.name : 'Pop out an app'}
      </span>
      {source && (
        <>
          <button className={`icon-btn ${cropping ? 'active popout-on' : ''}`} title={cropping ? 'Drag a box over the part to keep (Esc to stop)' : 'Show just a part (drag a box)'} onClick={() => setCropping(!cropping)} data-popout-crop>
            <Crop size={14} />
          </button>
          {!isFull(crop) && (
            <button className="icon-btn" title="Show the whole window again" onClick={() => setCrop(FULL)} data-popout-uncrop>
              <Scan size={14} />
            </button>
          )}
          <button className={`icon-btn ${opacity < 1 ? 'popout-on' : ''}`} title={`See-through: ${Math.round(opacity * 100)}% (click to change)`} onClick={seeThrough} data-popout-opacity>
            <Eye size={14} />
          </button>
          <button className="icon-btn" title="Show a different app" onClick={() => backToList()} data-popout-change>
            <LayoutGrid size={14} />
          </button>
        </>
      )}
      <button className="icon-btn" title="Minimise" onClick={() => void window.api.minimizePopout()}>
        <Minus size={14} />
      </button>
      <button className="icon-btn" title="Close" onClick={() => void window.api.closePopout()} data-popout-close>
        <X size={14} />
      </button>
    </div>
  )

  if (!source) {
    const windows = sources?.filter((s) => s.kind === 'window') ?? []
    const screens = sources?.filter((s) => s.kind === 'screen') ?? []
    return (
      <div className="popout popout-picking" data-popout-picker>
        {bar}
        <div className="popout-list">
          <div className="popout-list-head">
            <p>Pick an app to keep on top of everything. It shows live, so you can watch it while you work in something else.</p>
            <button className="icon-btn" title="Look again" onClick={() => void loadSources()}>
              <RefreshCw size={14} />
            </button>
          </div>
          {problem && <p className="popout-problem">{problem}</p>}
          {!sources ? (
            <p className="popout-empty">
              <Loader2 size={14} className="spin" /> Finding your open apps…
            </p>
          ) : !sources.length ? (
            <p className="popout-empty">No apps to show. Open one and press look again.</p>
          ) : (
            <>
              <Group title="Apps" icon={<AppWindow size={12} />} list={windows} pick={show} />
              <Group title="Screens" icon={<Monitor size={12} />} list={screens} pick={show} />
            </>
          )}
        </div>
      </div>
    )
  }

  const box = drag ? cropFromDrag(drag.a, drag.b) : null
  return (
    <div className={`popout popout-live ${cropping ? 'cropping' : ''}`} data-popout-live>
      {bar}
      <div ref={area} className="popout-picture" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}>
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          style={cropStyle(crop)}
          onLoadedMetadata={(e) => setSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          onResize={(e) => setSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
        />
        {cropping && !drag && <div className="popout-hint">Drag a box over the part to keep</div>}
        {box && <div className="popout-box" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} />}
      </div>
    </div>
  )
}

function Group({ title, icon, list, pick }: { title: string; icon: ReactNode; list: StudioCaptureSource[]; pick: (s: StudioCaptureSource) => void }) {
  if (!list.length) return null
  return (
    <>
      <h4 className="popout-group">
        {icon} {title}
      </h4>
      <div className="popout-grid">
        {list.map((s) => (
          <button key={s.id} className="popout-source" onClick={() => pick(s)} title={s.name} data-popout-source>
            <div className="popout-thumb">{s.thumb ? <img src={s.thumb} alt="" /> : s.kind === 'screen' ? <Monitor size={20} /> : <AppWindow size={20} />}</div>
            <span>{s.name}</span>
          </button>
        ))}
      </div>
    </>
  )
}
