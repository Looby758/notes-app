import { useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Brush, ImagePlus, Loader2, Map as MapIcon, MapPin, Pause, Play, SkipBack, Trash2, X } from 'lucide-react'
import { buildBrain, entityById, mapFile, type Story } from '@shared/writing'
import { mapSteps } from '@shared/writingTools'
import { notify } from '../../store/notify'
import { change, openScene, useWriting } from '../../store/writingStudio'
import MapSketch, { type MapPicture } from './MapSketch'

/**
 * The story map: a picture of your world (uploaded or sketched here) with your locations pinned on
 * it. Press play and the story calendar runs: characters walk from place to place, day by day.
 * The picture is kept in its own file (writing-map-<id>.json) so the story file stays small.
 */


const COLOURS = ['#f472b6', '#60a5fa', '#4ade80', '#fbbf24', '#a78bfa', '#f87171', '#2dd4bf', '#fb923c', '#e879f9', '#a3e635']

/** Shrinks a picture to at most 2400px across and turns it into a data URL. */
async function shrink(src: string): Promise<MapPicture> {
  const img = new Image()
  img.src = src
  await img.decode()
  // An SVG with no size of its own reports 0 across: draw it at 1600px wide.
  const nw = img.naturalWidth || 1600
  const nh = img.naturalHeight || 1000
  const scale = Math.min(1, 2400 / Math.max(nw, nh))
  const w = Math.max(1, Math.round(nw * scale))
  const h = Math.max(1, Math.round(nh * scale))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.drawImage(img, 0, 0, w, h)
  let image = c.toDataURL('image/webp', 0.86)
  if (!image.startsWith('data:image/webp')) image = c.toDataURL('image/jpeg', 0.88)
  return { image, w, h }
}

export default function MapView() {
  const story = useWriting((s) => s.story)!
  const [pic, setPic] = useState<MapPicture | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [sketch, setSketch] = useState<'new' | 'over' | null>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    setLoaded(false)
    window.api
      .readAppData(mapFile(story.id))
      .then((raw) => {
        if (!live) return
        const o = raw ? (JSON.parse(raw) as Partial<MapPicture>) : null
        setPic(o && typeof o.image === 'string' && o.image.startsWith('data:image/') ? { image: o.image, w: Number(o.w) || 1600, h: Number(o.h) || 1000 } : null)
      })
      .catch(() => live && setPic(null))
      .finally(() => live && setLoaded(true))
    return () => {
      live = false
    }
  }, [story.id])

  const save = async (next: MapPicture | null): Promise<void> => {
    setPic(next)
    try {
      await window.api.writeAppData(mapFile(story.id), JSON.stringify(next ?? {}))
    } catch (err) {
      notify(err)
    }
  }

  const upload = async (f: File | undefined): Promise<void> => {
    if (!f) return
    // Go by the file's name as well as its type: a saved web picture can arrive with no type, or a
    // name like "map.svg.jpeg".
    if (!f.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(f.name)) return notify('That isn’t a picture. Try a PNG, JPG or WebP.', 'info')
    try {
      // Read it as a data URL: the app's security rules block blob: pictures, which is why uploads failed.
      const url = await new Promise<string>((ok, fail) => {
        const r = new FileReader()
        r.onload = () => ok(String(r.result))
        r.onerror = () => fail(r.error)
        r.readAsDataURL(f)
      })
      await save(await shrink(url))
    } catch {
      notify('That picture couldn’t be opened.', 'info')
    }
  }

  if (!loaded)
    return (
      <div className="ws-map ws-map-loading">
        <Loader2 size={18} className="spin" />
      </div>
    )

  if (sketch)
    return (
      <MapSketch
        under={sketch === 'over' ? pic : null}
        onCancel={() => setSketch(null)}
        onDone={(p) => {
          setSketch(null)
          void save(p)
        }}
      />
    )

  return (
    <div className="ws-map" data-ws-map>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
      {!pic ? (
        <div className="ws-empty ws-map-empty">
          <MapIcon size={38} />
          <h2>Map your world</h2>
          <p>Upload a map (from a game, a book, or one you drew on paper), or sketch one here. Then pin your locations on it and play the story calendar to watch everyone move.</p>
          <div className="ws-map-empty-buttons">
            <button className="btn btn-primary" onClick={() => file.current?.click()} data-ws-map-upload>
              <ImagePlus size={14} /> Upload a map
            </button>
            <button className="btn" onClick={() => setSketch('new')} data-ws-map-sketch>
              <Brush size={14} /> Sketch one
            </button>
          </div>
        </div>
      ) : (
        <MapBoard
          story={story}
          pic={pic}
          onReplace={() => file.current?.click()}
          onDraw={() => setSketch('over')}
          onRemove={() => {
            void save(null)
            notify('Map picture removed. Your pins are kept for the next one.', 'info')
          }}
        />
      )}
    </div>
  )
}

// ---------- the board ----------

function MapBoard({ story, pic, onReplace, onDraw, onRemove }: { story: Story; pic: MapPicture; onReplace: () => void; onDraw: () => void; onRemove: () => void }) {
  const deferred = useDeferredValue(story)
  const { steps, byCalendar } = useMemo(() => mapSteps(deferred, buildBrain(deferred)), [deferred])
  const [step, setStep] = useState(Math.max(0, steps.length - 1))
  const [playing, setPlaying] = useState(false)
  const [trail, setTrail] = useState<string | null>(null)
  const [openPin, setOpenPin] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null)
  const board = useRef<HTMLDivElement>(null)
  const places = story.entities.filter((e) => e.kind === 'location')
  const chars = story.entities.filter((e) => e.kind === 'character')
  const colour = (id: string): string => COLOURS[Math.max(0, chars.findIndex((c) => c.id === id)) % COLOURS.length]
  const cur = steps[Math.min(step, steps.length - 1)]

  useEffect(() => {
    if (step > steps.length - 1) setStep(Math.max(0, steps.length - 1))
  }, [steps.length, step])

  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      setStep((s) => {
        if (s >= steps.length - 1) {
          setPlaying(false)
          return s
        }
        return s + 1
      })
    }, 1500)
    return () => clearInterval(t)
  }, [playing, steps.length])

  const spot = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = board.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)) }
  }
  const pinAt = (id: string): { x: number; y: number } | null => (drag?.id === id ? drag : (story.pins[id] ?? null))

  const pinDown = (e: ReactPointerEvent, id: string): void => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const start = { x: e.clientX, y: e.clientY }
    let moved = false
    const move = (ev: PointerEvent): void => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return
      moved = true
      setDrag({ id, ...spot(ev.clientX, ev.clientY) })
    }
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      if (moved) {
        const p = spot(ev.clientX, ev.clientY)
        change('Moved a pin', (s) => void (s.pins[id] = p))
      } else setOpenPin((o) => (o === id ? null : id))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Characters at a place, fanned out around its pin.
  const tokens: { id: string; x: number; y: number; dx: number; dy: number; here: boolean }[] = []
  if (cur) {
    const byPlace = new Map<string, string[]>()
    for (const [c, p] of Object.entries(cur.at)) if (story.pins[p] && entityById(story, c)) byPlace.set(p, [...(byPlace.get(p) ?? []), c])
    for (const [p, list] of byPlace) {
      const pin = pinAt(p)!
      // In a row just above the pin's head.
      list.forEach((c, i) => tokens.push({ id: c, x: pin.x, y: pin.y, dx: (i - (list.length - 1) / 2) * 27, dy: -40, here: cur.here.includes(c) }))
    }
  }
  const path = trail
    ? steps
        .slice(0, step + 1)
        .map((s) => s.at[trail])
        .filter((p, i, a) => p && story.pins[p] && p !== a[i - 1])
        .map((p) => pinAt(p)!)
    : []

  return (
    <div className="ws-map-layout">
      <aside className="ws-map-side">
        <h3>
          <MapPin size={13} /> Places
        </h3>
        {!places.length && <p className="ws-panel-empty">Add locations in the story brain and pin them here.</p>}
        {places.map((p) => (
          <div
            key={p.id}
            className={`ws-map-place ${story.pins[p.id] ? 'pinned' : ''}`}
            draggable={!story.pins[p.id]}
            onDragStart={(e) => e.dataTransfer.setData('text/ws-place', p.id)}
            title={story.pins[p.id] ? 'Pinned: drag its pin on the map to move it' : 'Drag onto the map'}
            data-ws-map-place={p.id}
          >
            <span className="ws-map-place-dot" />
            <span>{p.name}</span>
            {story.pins[p.id] ? (
              <button className="icon-btn" onClick={() => change('Took a pin off the map', (s) => void delete s.pins[p.id])} title="Take off the map">
                <X size={11} />
              </button>
            ) : (
              <span className="ws-map-drag">drag onto the map</span>
            )}
          </div>
        ))}
        {chars.length > 0 && (
          <>
            <h3>Characters</h3>
            <p className="ws-panel-tip">Click someone to see the path they take.</p>
            {chars.map((c) => (
              <button key={c.id} className={`ws-map-char ${trail === c.id ? 'on' : ''}`} onClick={() => setTrail(trail === c.id ? null : c.id)} data-ws-map-char={c.id}>
                <span className="ws-token-dot" style={{ background: colour(c.id) }}>
                  {c.name[0]}
                </span>
                {c.name}
              </button>
            ))}
          </>
        )}
      </aside>

      <div className="ws-map-main">
        <div className="ws-map-tools">
          <button className="btn" onClick={onDraw} title="Draw on this map">
            <Brush size={13} /> Draw on it
          </button>
          <button className="btn" onClick={onReplace}>
            <ImagePlus size={13} /> New picture
          </button>
          <button className="icon-btn" onClick={onRemove} title="Remove the picture">
            <Trash2 size={13} />
          </button>
        </div>
        <div className="ws-map-stage" onClick={() => setOpenPin(null)}>
          <div
            className="ws-map-board"
            ref={board}
            style={{ aspectRatio: `${pic.w} / ${pic.h}`, width: `min(100%, calc(100cqh * ${(pic.w / pic.h).toFixed(4)}))` }}
            onDragOver={(e) => e.dataTransfer.types.includes('text/ws-place') && e.preventDefault()}
            onDrop={(e) => {
              const id = e.dataTransfer.getData('text/ws-place')
              if (!id) return
              e.preventDefault()
              const p = spot(e.clientX, e.clientY)
              change(`Pinned ${entityById(story, id)?.name ?? 'a place'}`, (s) => void (s.pins[id] = p))
            }}
            data-ws-map-board
          >
            <img src={pic.image} alt="" draggable={false} />
            {path.length > 1 && (
              <svg className="ws-map-trail" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polyline points={path.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')} style={{ stroke: colour(trail!) }} />
              </svg>
            )}
            {places
              .filter((p) => pinAt(p.id))
              .map((p) => {
                const at = pinAt(p.id)!
                const active = cur?.place === p.id
                return (
                  <div key={p.id} className={`ws-pin ${active ? 'active' : ''} ${drag?.id === p.id ? 'dragging' : ''}`} style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }} onPointerDown={(e) => pinDown(e, p.id)} onClick={(e) => e.stopPropagation()} data-ws-pin={p.id}>
                    <MapPin size={20} />
                    <span className="ws-pin-label">{p.name}</span>
                    {openPin === p.id && <PinCard story={story} place={p.id} at={cur?.at ?? {}} onPage={() => useWriting.setState({ view: 'brain', brainTab: 'pages', entity: p.id })} />}
                  </div>
                )
              })}
            {tokens.map((t) => {
              const c = entityById(story, t.id)!
              return (
                <span
                  key={t.id}
                  className={`ws-token ${t.here ? 'here' : ''} ${trail && trail !== t.id ? 'dim' : ''}`}
                  style={{ left: `calc(${t.x * 100}% + ${t.dx}px)`, top: `calc(${t.y * 100}% + ${t.dy}px)`, '--c': colour(t.id) } as CSSProperties}
                  title={c.name}
                  data-ws-token={t.id}
                >
                  {c.name[0]}
                </span>
              )
            })}
          </div>
        </div>

        <div className="ws-map-player" data-ws-map-player>
          <button className="icon-btn" onClick={() => setStep(0)} disabled={!steps.length} title="Back to the start">
            <SkipBack size={14} />
          </button>
          <button
            className={`ws-play ${playing ? 'on' : ''}`}
            onClick={() => {
              if (step >= steps.length - 1) setStep(0)
              setPlaying(!playing)
            }}
            disabled={steps.length < 2}
            title={playing ? 'Pause' : 'Play the story'}
            data-ws-map-play
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <input type="range" min={0} max={Math.max(0, steps.length - 1)} value={step} onChange={(e) => setStep(Number(e.target.value))} disabled={steps.length < 2} aria-label="Point in the story" data-ws-map-slider />
          <div className="ws-map-now" key={cur?.scene ?? 'none'}>
            {cur ? (
              <>
                <b>{cur.label}</b>
                <button className="link-button" onClick={() => openScene(cur.scene)} title="Open this scene">
                  {cur.title}
                </button>
              </>
            ) : (
              <span className="ws-hint">Give scenes a place (and a day) and they play here.</span>
            )}
          </div>
          {steps.length > 0 && <span className="ws-count">{byCalendar ? 'story calendar order' : 'book order (no dates yet)'}</span>}
        </div>
      </div>
    </div>
  )
}

function PinCard({ story, place, at, onPage }: { story: Story; place: string; at: Record<string, string>; onPage: () => void }) {
  const here = Object.entries(at)
    .filter(([, p]) => p === place)
    .map(([c]) => entityById(story, c)?.name)
    .filter(Boolean)
  return (
    <div className="ws-pin-card" onPointerDown={(e) => e.stopPropagation()}>
      <b>{entityById(story, place)?.name}</b>
      <span>{here.length ? `Here now: ${here.join(', ')}` : 'Nobody here right now'}</span>
      <button className="link-button" onClick={onPage}>
        Open its page
      </button>
    </div>
  )
}
