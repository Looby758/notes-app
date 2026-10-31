import './studio.css'
import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Circle,
  Eye,
  EyeOff,
  FolderOpen,
  Image as ImageIcon,
  Mic,
  MicOff,
  Monitor,
  Music,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  Type,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import type { StudioCaptureSource } from '@shared/types'
import { dragRect, formatDuration, itemAt, newItem, QUALITIES, snap, SOURCE_LABELS, studioId, type Handle, type StudioItem, type StudioSourceKind } from '@shared/studio'
import { activeScene, addItem, removeItem, reorderItem, switchScene, updateItem, updateScene, useStudio } from '../../store/studio'
import { desktopAudioSupported, hasChannel, level, retrySource, startRecording, stopRecording, studioCanvas, studioPage } from '../../lib/studio'
import { showKeys } from '@shared/platform'

const KIND_ICONS: Record<StudioSourceKind, typeof Monitor> = { screen: Monitor, camera: Camera, image: ImageIcon, text: Type, nowPlaying: Music }

export default function StudioPage() {
  const scenes = useStudio((s) => s.scenes)
  const sceneId = useStudio((s) => s.activeScene)
  const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0]
  const selected = useStudio((s) => s.selected)
  const item = scene.items.find((i) => i.id === selected) ?? null
  const [picking, setPicking] = useState<null | 'screen'>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    studioPage(true)
    return () => studioPage(false)
  }, [])

  const add = (kind: StudioSourceKind): void => {
    setAdding(false)
    if (kind === 'screen') setPicking('screen')
    else if (kind === 'image') pickPicture()
    else addItem(newItem(kind))
  }

  return (
    <div className="studio-page" data-studio-page>
      <RecordBar />
      <div className="studio-body">
        <aside className="studio-side">
          <section className="studio-box">
            <header>
              <h3>Scenes</h3>
              <button
                className="icon-btn"
                title="New scene"
                onClick={() => {
                  const id = studioId()
                  useStudio.setState((s) => ({ scenes: [...s.scenes, { id, name: `Scene ${s.scenes.length + 1}`, items: [] }] }))
                  switchScene(id)
                }}
              >
                <Plus size={14} />
              </button>
            </header>
            <ul className="studio-list">
              {scenes.map((s, i) => (
                <li key={s.id} className={s.id === scene.id ? 'active' : ''} onClick={() => switchScene(s.id)} title={i < 9 ? `Switch with ${showKeys(`Ctrl+Shift+${i + 1}`)}` : undefined}>
                  <span className="studio-key">{i < 9 ? i + 1 : ''}</span>
                  <input className="studio-name" value={s.name} onChange={(e) => updateScene(s.id, { name: e.target.value })} onClick={(e) => e.stopPropagation()} onFocus={() => switchScene(s.id)} />
                  {scenes.length > 1 && (
                    <button
                      className="icon-btn studio-row-btn"
                      title="Delete scene"
                      onClick={(e) => {
                        e.stopPropagation()
                        useStudio.setState((st) => {
                          const rest = st.scenes.filter((x) => x.id !== s.id)
                          return { scenes: rest, activeScene: st.activeScene === s.id ? rest[0].id : st.activeScene }
                        })
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="studio-box">
            <header>
              <h3>Sources</h3>
              <div className="studio-add">
                <button className="icon-btn" title="Add a source" onClick={() => setAdding((a) => !a)} data-studio-add>
                  <Plus size={14} />
                </button>
                {adding && (
                  <div className="studio-menu" onMouseLeave={() => setAdding(false)}>
                    {(Object.keys(SOURCE_LABELS) as StudioSourceKind[]).map((k) => {
                      const Icon = KIND_ICONS[k]
                      return (
                        <button key={k} onClick={() => add(k)}>
                          <Icon size={14} /> {SOURCE_LABELS[k]}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </header>
            {scene.items.length === 0 ? (
              <p className="studio-hint">Nothing in this scene yet. Press + to add your screen, webcam, a picture or some text.</p>
            ) : (
              <ul className="studio-list">
                {[...scene.items].reverse().map((i) => (
                  <SourceRow key={i.id} item={i} selected={i.id === selected} />
                ))}
              </ul>
            )}
          </section>
        </aside>
        <main className="studio-main">
          <Preview />
          <p className="studio-hint">Drag sources to move them, drag a corner to resize (hold Shift to stretch). Delete removes the selected one.</p>
        </main>
        <aside className="studio-side">
          {item ? <ItemSettings item={item} onPickScreen={() => setPicking('screen')} /> : <p className="studio-hint studio-box">Click a source to change it.</p>}
          <Mixer />
          <RecordingSettings />
        </aside>
      </div>
      {picking && (
        <ScreenPicker
          onClose={() => setPicking(null)}
          onPick={(src) => {
            setPicking(null)
            if (item?.kind === 'screen') updateItem(item.id, { deviceId: src.id, name: src.name })
            else addItem(newItem('screen', { deviceId: src.id, name: src.name }))
          }}
        />
      )}
    </div>
  )
}

function pickPicture(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      // Kept small enough to be remembered with your scenes.
      const scale = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight))
      const c = document.createElement('canvas')
      c.width = Math.round(img.naturalWidth * scale)
      c.height = Math.round(img.naturalHeight * scale)
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      const ratio = c.width / c.height
      const h = 0.4
      const w = Math.min(0.9, (h * ratio * 9) / 16)
      addItem(newItem('image', { image: c.toDataURL('image/webp', 0.9), name: file.name, w, h: (w / ratio) * (16 / 9), x: 0.5 - w / 2, y: 0.3 }))
    }
    img.src = url
  }
  input.click()
}

function RecordBar() {
  const recording = useStudio((s) => s.recording)
  const last = useStudio((s) => s.lastRecording)
  const now = useNow(!!recording)
  return (
    <header className="studio-top">
      <h2>Studio</h2>
      <span className="studio-top-gap" />
      {last && !recording && (
        <button className="btn" onClick={() => void window.api.studioReveal(last)} title={last}>
          <FolderOpen size={14} /> Show last recording
        </button>
      )}
      {recording ? (
        <button className="btn studio-rec on" onClick={() => void stopRecording()} data-studio-record>
          <Square size={13} fill="currentColor" /> Stop · {formatDuration(now - recording.startedAt)}
        </button>
      ) : (
        <button className="btn studio-rec" onClick={() => void startRecording()} data-studio-record>
          <Circle size={13} fill="currentColor" /> Record
        </button>
      )}
      <button className="btn" disabled title="Coming next: stream to Twitch and YouTube">
        Go live (soon)
      </button>
    </header>
  )
}

export function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [on])
  return now
}

function SourceRow({ item, selected }: { item: StudioItem; selected: boolean }) {
  const Icon = KIND_ICONS[item.kind]
  const problem = useStudio((s) => s.problems[item.id])
  return (
    <li className={`${selected ? 'active' : ''} ${item.visible ? '' : 'hidden'}`} onClick={() => useStudio.setState({ selected: item.id })} title={problem}>
      <Icon size={13} className={problem ? 'studio-warn' : ''} />
      <span className="studio-row-name">{item.name}</span>
      <button className="icon-btn studio-row-btn" title="Bring forward" onClick={(e) => (e.stopPropagation(), reorderItem(item.id, 1))}>
        <ChevronUp size={13} />
      </button>
      <button className="icon-btn studio-row-btn" title="Send back" onClick={(e) => (e.stopPropagation(), reorderItem(item.id, -1))}>
        <ChevronDown size={13} />
      </button>
      <button className="icon-btn studio-row-btn" title={item.visible ? 'Hide' : 'Show'} onClick={(e) => (e.stopPropagation(), updateItem(item.id, { visible: !item.visible }))}>
        {item.visible ? <Eye size={13} /> : <EyeOff size={13} />}
      </button>
      <button className="icon-btn studio-row-btn" title="Remove" onClick={(e) => (e.stopPropagation(), removeItem(item.id))}>
        <Trash2 size={13} />
      </button>
    </li>
  )
}

const HANDLES: Handle[] = ['nw', 'ne', 'sw', 'se']

function Preview() {
  const host = useRef<HTMLDivElement>(null)
  const scene = useStudio((s) => activeScene(s))
  const selected = useStudio((s) => s.selected)
  const quality = useStudio((s) => s.quality)
  const item = scene.items.find((i) => i.id === selected)
  const drag = useRef<{ id: string; handle: Handle; px: number; py: number; start: StudioItem } | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const cv = studioCanvas()
    el.prepend(cv)
    return () => cv.remove()
  }, [quality])

  const at = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = host.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  const onDown = (e: React.PointerEvent, handle?: Handle): void => {
    e.stopPropagation()
    const p = at(e)
    const target = handle && item ? item : itemAt(scene.items, p.x, p.y)
    useStudio.setState({ selected: target?.id ?? null })
    if (!target) return
    drag.current = { id: target.id, handle: handle ?? 'move', px: p.x, py: p.y, start: target }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const p = at(e)
    const keepRatio = !e.shiftKey && d.start.kind !== 'text'
    let r = dragRect(d.start, d.handle, p.x - d.px, p.y - d.py, keepRatio)
    if (d.handle === 'move' && !e.altKey) r = snap(r)
    updateItem(d.id, r)
  }
  const onUp = (): void => {
    drag.current = null
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (!selected || t.closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'Delete' || e.key === 'Backspace') removeItem(selected)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  return (
    <div className="studio-preview" ref={host} onPointerDown={(e) => onDown(e)} onPointerMove={onMove} onPointerUp={onUp} data-studio-preview>
      {item && (
        <div className="studio-sel" style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.w * 100}%`, height: `${item.h * 100}%` }}>
          {HANDLES.map((h) => (
            <span key={h} className={`studio-handle ${h}`} onPointerDown={(e) => onDown(e, h)} onPointerMove={onMove} onPointerUp={onUp} />
          ))}
        </div>
      )}
      {scene.items.length === 0 && <div className="studio-empty">Add a source to start building “{scene.name}”</div>}
    </div>
  )
}

function ItemSettings({ item, onPickScreen }: { item: StudioItem; onPickScreen: () => void }) {
  const problem = useStudio((s) => s.problems[item.id])
  const cameras = useDevices('videoinput')
  return (
    <section className="studio-box studio-props">
      <header>
        <h3>{SOURCE_LABELS[item.kind]}</h3>
      </header>
      {problem && (
        <p className="studio-problem">
          {problem}{' '}
          <button className="btn" onClick={() => (item.kind === 'screen' ? onPickScreen() : retrySource(item))}>
            <RefreshCw size={12} /> Try again
          </button>
        </p>
      )}
      <label>
        Name
        <input value={item.name} onChange={(e) => updateItem(item.id, { name: e.target.value })} />
      </label>
      {item.kind === 'screen' && (
        <button className="btn" onClick={onPickScreen}>
          <Monitor size={13} /> Pick another screen or window
        </button>
      )}
      {item.kind === 'camera' && (
        <>
          <label>
            Camera
            <select value={item.deviceId ?? ''} onChange={(e) => updateItem(item.id, { deviceId: e.target.value })}>
              <option value="">Default camera</option>
              {cameras.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || 'Camera'}
                </option>
              ))}
            </select>
          </label>
          <label className="studio-check">
            <input type="checkbox" checked={!!item.mirror} onChange={(e) => updateItem(item.id, { mirror: e.target.checked })} /> Mirror
          </label>
        </>
      )}
      {item.kind === 'text' && (
        <>
          <label>
            Text
            <textarea rows={2} value={item.text ?? ''} onChange={(e) => updateItem(item.id, { text: e.target.value })} />
          </label>
          <div className="studio-row">
            <label className="studio-check">
              <input type="color" value={item.color ?? '#ffffff'} onChange={(e) => updateItem(item.id, { color: e.target.value })} /> Colour
            </label>
            <label className="studio-check">
              <input type="checkbox" checked={!!item.background} onChange={(e) => updateItem(item.id, { background: e.target.checked })} /> Dark backing
            </label>
          </div>
        </>
      )}
      {item.kind === 'nowPlaying' && <p className="studio-hint">Shows the song playing in Orbit’s music player. It’s hidden while nothing is playing.</p>}
      {(item.kind === 'screen' || item.kind === 'camera' || item.kind === 'image') && (
        <label>
          Fit
          <select value={item.fit} onChange={(e) => updateItem(item.id, { fit: e.target.value as StudioItem['fit'] })}>
            <option value="contain">Show all of it</option>
            <option value="cover">Fill the box (crop)</option>
          </select>
        </label>
      )}
      {item.kind !== 'text' && (
        <label>
          Rounded corners
          <input type="range" min={0} max={0.5} step={0.01} value={item.radius} onChange={(e) => updateItem(item.id, { radius: Number(e.target.value) })} />
        </label>
      )}
      <div className="studio-row">
        <button className="btn" onClick={() => updateItem(item.id, { x: 0, y: 0, w: 1, h: 1 })}>
          Fill the screen
        </button>
        <button className="btn" onClick={() => updateItem(item.id, { x: 0.5 - item.w / 2, y: 0.5 - item.h / 2 })}>
          Centre
        </button>
      </div>
    </section>
  )
}

function useDevices(kind: MediaDeviceKind): MediaDeviceInfo[] {
  const [list, setList] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    const load = (): void => void navigator.mediaDevices.enumerateDevices().then((d) => setList(d.filter((x) => x.kind === kind && x.deviceId !== 'default' && x.deviceId !== 'communications')))
    load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener('devicechange', load)
  }, [kind])
  return list
}

function Meter({ which }: { which: 'mic' | 'desktop' }) {
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    let shown = 0
    const tick = (): void => {
      const v = level(which)
      shown = Math.max(v, shown * 0.9)
      if (bar.current) bar.current.style.transform = `scaleX(${shown})`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [which])
  return (
    <div className="studio-meter">
      <div ref={bar} />
    </div>
  )
}

function Mixer() {
  const s = useStudio()
  const mics = useDevices('audioinput')
  return (
    <section className="studio-box studio-mixer">
      <header>
        <h3>Sound</h3>
      </header>
      <div className="studio-channel">
        <div className="studio-row">
          <button className="icon-btn" title={s.micMuted ? 'Unmute' : 'Mute'} onClick={() => useStudio.setState({ micMuted: !s.micMuted })} disabled={s.micId === 'off'}>
            {s.micMuted || s.micId === 'off' ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
          <select value={s.micId} onChange={(e) => useStudio.setState({ micId: e.target.value })}>
            <option value="">Default microphone</option>
            {mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Microphone'}
              </option>
            ))}
            <option value="off">No microphone</option>
          </select>
        </div>
        <input type="range" min={0} max={2} step={0.05} value={s.micGain} onChange={(e) => useStudio.setState({ micGain: Number(e.target.value) })} title={`${Math.round(s.micGain * 100)}%`} />
        <Meter which="mic" />
      </div>
      <div className="studio-channel">
        <div className="studio-row">
          <button className="icon-btn" title={s.desktopMuted ? 'Unmute' : 'Mute'} onClick={() => useStudio.setState({ desktopMuted: !s.desktopMuted })} disabled={!s.desktopOn || !desktopAudioSupported}>
            {s.desktopMuted || !s.desktopOn ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <label className="studio-check">
            <input type="checkbox" checked={s.desktopOn && desktopAudioSupported} disabled={!desktopAudioSupported} onChange={(e) => useStudio.setState({ desktopOn: e.target.checked })} /> Desktop sound
          </label>
        </div>
        {desktopAudioSupported ? (
          <>
            <input type="range" min={0} max={2} step={0.05} value={s.desktopGain} onChange={(e) => useStudio.setState({ desktopGain: Number(e.target.value) })} title={`${Math.round(s.desktopGain * 100)}%`} />
            <Meter which="desktop" />
          </>
        ) : (
          <p className="studio-hint">Recording what you hear isn’t available on a Mac yet. Your mic still works.</p>
        )}
      </div>
      {s.audioProblem && <p className="studio-problem">{s.audioProblem}</p>}
      {!hasChannel('mic') && s.micId !== 'off' && !s.audioProblem && <p className="studio-hint">Starting the microphone…</p>}
    </section>
  )
}

function RecordingSettings() {
  const quality = useStudio((s) => s.quality)
  const folder = useStudio((s) => s.folder)
  const recording = useStudio((s) => !!s.recording)
  const [fallback, setFallback] = useState('')
  useEffect(() => void window.api.studioDefaultFolder().then(setFallback), [])
  return (
    <section className="studio-box">
      <header>
        <h3>Recording</h3>
      </header>
      <label>
        Quality
        <select value={quality} disabled={recording} onChange={(e) => useStudio.setState({ quality: e.target.value as typeof quality })}>
          {QUALITIES.map((q) => (
            <option key={q.id} value={q.id}>
              {q.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Save in
        <div className="studio-row">
          <span className="studio-path" title={folder ?? fallback}>
            {folder ?? fallback}
          </span>
          <button
            className="btn"
            onClick={async () => {
              const f = await window.api.studioPickFolder()
              if (f) useStudio.setState({ folder: f })
            }}
          >
            Change
          </button>
          <button className="icon-btn" title="Open the folder" onClick={() => void window.api.studioOpenFolder(folder)}>
            <FolderOpen size={14} />
          </button>
        </div>
      </label>
    </section>
  )
}

function ScreenPicker({ onPick, onClose }: { onPick: (s: StudioCaptureSource) => void; onClose: () => void }) {
  const [list, setList] = useState<StudioCaptureSource[] | null>(null)
  const load = (): void => void window.api.studioSources().then(setList)
  useEffect(load, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="studio-picker-back" onClick={onClose}>
      <div className="studio-picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Pick a screen or window">
        <header>
          <h3>What do you want to show?</h3>
          <button className="icon-btn" title="Refresh" onClick={load}>
            <RefreshCw size={14} />
          </button>
          <button className="icon-btn" title="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        {!list ? (
          <p className="studio-hint">Looking…</p>
        ) : (
          (['screen', 'window'] as const).map((kind) => {
            const items = list.filter((s) => s.kind === kind)
            if (!items.length) return null
            return (
              <div key={kind}>
                <h4>{kind === 'screen' ? 'Whole screens' : 'Windows'}</h4>
                <div className="studio-picker-grid">
                  {items.map((s) => (
                    <button key={s.id} onClick={() => onPick(s)} title={s.name}>
                      {s.thumb ? <img src={s.thumb} alt="" /> : <div className="studio-thumb-blank" />}
                      <span>{s.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
