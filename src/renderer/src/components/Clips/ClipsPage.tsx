import './clips.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, FolderOpen, GripVertical, Pause, Play, Plus, Save, Send, Settings, Trash2, X } from 'lucide-react'
import { cleanTrim, DISCORD_LIMIT, megabytes, type CaptionPosition, type DiscordHook } from '@shared/clips'
import { formatDuration } from '@shared/studio'
import type { ClipInfo, FfmpegState } from '@shared/types'
import { setPrefs, usePrefs } from '../../store/prefs'
import { useStudio } from '../../store/studio'
import { useUI } from '../../store/ui'
import { notify } from '../../store/notify'
import { openSpecialTab, SETTINGS_TAB } from '../../lib/editorController'
import { clipsChanged, saveReplay, useReplay } from '../../lib/replay'
import { errorMessage } from '../../lib/paths'

/**
 * Clips: instant replay's switch and status, every video in the recordings folder, and the clip
 * editor (trim, add a caption, save it or send it to Discord).
 */

const clipUrl = (clip: ClipInfo): string => `vault://clips/${encodeURIComponent(clip.name)}?v=${Math.round(clip.modified)}`
const when = (ms: number): string => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function ClipsPage() {
  const folder = useStudio((s) => s.folder)
  const version = useReplay((s) => s.version)
  const lastSaved = useReplay((s) => s.lastSaved)
  const request = useReplay((s) => s.request)
  const [clips, setClips] = useState<ClipInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<ClipInfo[]> => {
    const list = await window.api.clipsList(folder).catch(() => [] as ClipInfo[])
    setClips(list)
    return list
  }, [folder])

  useEffect(() => {
    void refresh().then((list) => setSelected((cur) => (cur && list.some((c) => c.path === cur) ? cur : (list[0]?.path ?? null))))
  }, [refresh, version])

  // A fresh replay, or one asked for from the notification, opens in the editor.
  useEffect(() => {
    if (lastSaved) setSelected(lastSaved)
  }, [lastSaved])
  useEffect(() => {
    if (!request) return
    void refresh().then(() => setSelected(request))
    useReplay.setState({ request: null })
  }, [request, refresh])

  const clip = clips.find((c) => c.path === selected) ?? null

  return (
    <div className="clips-page" data-clips-page>
      <ReplayBar />
      <div className="clips-body">
        <aside className="clips-list" aria-label="Your clips">
          <header>
            <h3>Clips and recordings</h3>
            <button className="icon-btn" title="Open the folder" onClick={() => void window.api.studioOpenFolder(folder)}>
              <FolderOpen size={14} />
            </button>
          </header>
          {clips.length === 0 && <p className="clips-empty">Nothing yet. Turn on instant replay, then press the shortcut after something good happens.</p>}
          {clips.map((c) => (
            <button key={c.path} className={`clips-item ${c.path === selected ? 'on' : ''}`} onClick={() => setSelected(c.path)} data-clip={c.name}>
              <span className="clips-item-name">{c.name.replace(/\.\w+$/, '')}</span>
              <span className="clips-item-meta">
                {when(c.modified)} · {megabytes(c.size)}
              </span>
            </button>
          ))}
        </aside>
        {clip ? (
          <ClipEditor key={clip.path} clip={clip} folder={folder} onMade={(path) => void refresh().then(() => setSelected(path))} onGone={() => void refresh()} />
        ) : (
          <div className="clips-none">Pick a clip to trim it, add a caption or send it.</div>
        )}
      </div>
    </div>
  )
}

// ---------- instant replay ----------

function useFfmpeg(): FfmpegState | null {
  const [state, setState] = useState<FfmpegState | null>(null)
  useEffect(() => {
    void window.api.videoConverterStatus().then(setState)
    return window.api.onVideoConverterStatus(setState)
  }, [])
  return state
}

function ReplayBar() {
  const on = usePrefs((s) => s.prefs.replayOn)
  const seconds = usePrefs((s) => s.prefs.replaySeconds)
  const r = useReplay()
  const ffmpeg = useFfmpeg()
  const [shortcut, setShortcut] = useState<{ shortcut: string; error?: string } | null>(null)
  const shortcutPref = usePrefs((s) => s.prefs.replayShortcut)
  useEffect(() => {
    // The main process registers it a moment after the setting changes.
    const t = setTimeout(() => void window.api.replayStatus().then(setShortcut), 300)
    return () => clearTimeout(t)
  }, [on, shortcutPref])

  const openSettings = (): void => {
    useUI.setState({ settingsSection: 'studio' })
    openSpecialTab(SETTINGS_TAB)
  }

  return (
    <div className="clips-top">
      <h2>Clips</h2>
      <label className="clips-switch" title="Keep the last few seconds of your screen ready to save">
        <input type="checkbox" checked={on} onChange={(e) => setPrefs({ replayOn: e.target.checked })} data-replay-toggle />
        Instant replay
      </label>
      <span className="clips-status" data-replay-status={r.running ? 'running' : r.starting ? 'starting' : r.needsFfmpeg ? 'ffmpeg' : r.problem ? 'problem' : 'off'}>
        {r.running ? (
          <>
            <span className="clips-dot" /> Keeping the last {seconds} seconds.{' '}
            {shortcut?.shortcut ? (
              <>
                Press <kbd>{shortcut.shortcut}</kbd> to save it.
              </>
            ) : (
              shortcut?.error
            )}
          </>
        ) : r.starting ? (
          'Starting…'
        ) : on && r.needsFfmpeg ? (
          ffmpeg?.state === 'downloading' ? (
            `Downloading the video add-on… ${Math.round((ffmpeg.progress ?? 0) * 100)}%`
          ) : (
            <>
              Instant replay needs the free video add-on (ffmpeg, about 30 MB).
              <button className="btn btn-primary" onClick={() => void window.api.getVideoConverter()} data-replay-get-ffmpeg>
                <Download size={13} /> Download it
              </button>
            </>
          )
        ) : r.problem ? (
          <span className="clips-problem">{r.problem}</span>
        ) : (
          'Off. Nothing is recorded.'
        )}
      </span>
      <span className="clips-gap" />
      <button className="btn" disabled={!r.running || r.saving} onClick={() => void saveReplay()} data-replay-save>
        <Save size={13} /> {r.saving ? 'Saving…' : `Save last ${seconds}s`}
      </button>
      <button className="icon-btn" title="Instant replay settings" onClick={openSettings}>
        <Settings size={14} />
      </button>
    </div>
  )
}

// ---------- the editor ----------

interface Caption {
  text: string
  position: CaptionPosition
  /** Text height as a fraction of the video's width. */
  size: number
}

const CAPTION_FONT = '"Impact", "Arial Black", "Helvetica Neue", sans-serif'

/** The caption as a transparent picture exactly as wide as the video (laid over it by ffmpeg). */
function drawCaption(caption: Caption, width: number): { png: Promise<Uint8Array>; height: number } {
  const size = Math.max(12, Math.round(width * caption.size))
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = `700 ${size}px ${CAPTION_FONT}`
  // Wrap long captions onto more lines.
  const lines: string[] = []
  for (const para of caption.text.trim().split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word
      if (line && measure.measureText(next).width > width * 0.92) {
        lines.push(line)
        line = word
      } else line = next
    }
    lines.push(line)
  }
  const pad = Math.round(size * 0.4)
  const lineH = Math.round(size * 1.15)
  const height = Math.ceil((lines.length * lineH + pad * 2) / 2) * 2
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const c = canvas.getContext('2d')!
  c.font = `700 ${size}px ${CAPTION_FONT}`
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.lineJoin = 'round'
  c.lineWidth = Math.max(2, size * 0.14)
  c.strokeStyle = '#000'
  c.fillStyle = '#fff'
  lines.forEach((l, i) => {
    const y = pad + lineH * (i + 0.5)
    c.strokeText(l, width / 2, y)
    c.fillText(l, width / 2, y)
  })
  const png = new Promise<Uint8Array>((resolve, reject) =>
    canvas.toBlob((b) => (b ? void b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new Error('The caption couldn’t be drawn.'))), 'image/png')
  )
  return { png, height }
}

function ClipEditor({ clip, folder, onMade, onGone }: { clip: ClipInfo; folder: string | null; onMade: (path: string) => void; onGone: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const [duration, setDuration] = useState(0)
  const [now, setNow] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [trim, setTrim] = useState({ start: 0, end: 0 })
  const [caption, setCaption] = useState<Caption>({ text: '', position: 'bottom', size: 0.06 })
  const [busy, setBusy] = useState<null | { label: string; done: number }>(null)
  const [broken, setBroken] = useState(false)
  /** Where the picture is drawn inside the stage (the video letterboxes it), so the caption preview sits on it. */
  const [shown, setShown] = useState({ w: 0, h: 0, x: 0, y: 0 })

  useEffect(() => window.api.onClipsProgress((done) => setBusy((b) => (b ? { ...b, done } : b))), [])

  const v = (): HTMLVideoElement | null => video.current
  const trimmed = duration > 0 && (trim.start > 0.05 || trim.end < duration - 0.05)
  const edited = trimmed || !!caption.text.trim()
  const length = Math.max(0, trim.end - trim.start)

  const onMeta = (): void => {
    const el = v()
    if (!el) return
    const d = Number.isFinite(el.duration) ? el.duration : 0
    setDuration(d)
    setTrim({ start: 0, end: d })
  }

  // Keep the preview inside the trim.
  const onTime = (): void => {
    const el = v()
    if (!el) return
    if (el.currentTime >= trim.end - 0.02 && trim.end > 0) {
      el.currentTime = trim.start
      if (!el.paused && trim.end - trim.start < 0.2) el.pause()
    }
    setNow(el.currentTime)
  }

  const toggle = (): void => {
    const el = v()
    if (!el) return
    if (el.paused) {
      if (el.currentTime < trim.start || el.currentTime >= trim.end - 0.05) el.currentTime = trim.start
      void el.play()
    } else el.pause()
  }

  const seek = (t: number): void => {
    const el = v()
    if (!el) return
    el.currentTime = Math.min(Math.max(0, t), duration)
    setNow(el.currentTime)
  }

  const setStart = (t: number): void => setTrim((tr) => cleanTrim(Math.min(t, tr.end - 0.1), tr.end, duration))
  const setEnd = (t: number): void => setTrim((tr) => cleanTrim(tr.start, Math.max(t, tr.start + 0.1), duration))

  // Dragging on the bar: the handles move the trim, anywhere else moves the playhead.
  const timeAt = (clientX: number): number => {
    const box = track.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * duration
  }
  const drag = (what: 'start' | 'end' | 'seek') => (e: React.PointerEvent): void => {
    if (!duration) return
    e.preventDefault()
    e.stopPropagation()
    const move = (x: number): void => {
      const t = timeAt(x)
      if (what === 'start') {
        setStart(t)
        seek(t)
      } else if (what === 'end') {
        setEnd(t)
        seek(t)
      } else seek(t)
    }
    move(e.clientX)
    const onMove = (ev: PointerEvent): void => move(ev.clientX)
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // I and O set the start and end where the video is, like most video editors; Space plays.
  const onKey = (e: React.KeyboardEvent): void => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return
    if (e.key === 'i' || e.key === 'I') setStart(now)
    else if (e.key === 'o' || e.key === 'O') setEnd(now)
    else if (e.key === ' ') toggle()
    else if (e.key === 'ArrowLeft') seek(now - (e.shiftKey ? 1 : 1 / 30))
    else if (e.key === 'ArrowRight') seek(now + (e.shiftKey ? 1 : 1 / 30))
    else return
    e.preventDefault()
  }

  // How big the picture is on screen, so the caption preview matches what's made.
  useEffect(() => {
    const el = v()
    if (!el) return
    const measure = (): void => {
      const vw = el.videoWidth
      const vh = el.videoHeight
      const bw = el.clientWidth
      const bh = el.clientHeight
      const scale = vw && vh ? Math.min(bw / vw, bh / vh) : 1
      const w = vw && vh ? vw * scale : bw
      const h = vw && vh ? vh * scale : bh
      setShown({ w, h, x: el.offsetLeft + (bw - w) / 2, y: el.offsetTop + (bh - h) / 2 })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.addEventListener('loadedmetadata', measure)
    return () => {
      ro.disconnect()
      el.removeEventListener('loadedmetadata', measure)
    }
  }, [])

  /** Makes the trimmed, captioned copy. */
  const make = async (forDiscord: boolean, label: string): Promise<{ path: string; size: number } | null> => {
    const el = v()
    if (!el) return null
    el.pause()
    setBusy({ label, done: 0 })
    try {
      let captionPng: Uint8Array | undefined
      if (caption.text.trim() && el.videoWidth) captionPng = await drawCaption(caption, el.videoWidth).png
      const made = await window.api.clipsExport(folder, { path: clip.path, start: trim.start, end: trim.end, captionPng, captionPosition: caption.position, forDiscord })
      clipsChanged()
      return made
    } catch (err) {
      if (errorMessage(err) !== 'Stopped.') notify(`Couldn’t make the clip: ${errorMessage(err)}`)
      return null
    } finally {
      setBusy(null)
    }
  }

  const save = async (forDiscord: boolean): Promise<void> => {
    const made = await make(forDiscord, forDiscord ? 'Making it fit Discord…' : 'Saving the clip…')
    if (!made) return
    notify(`Saved ${made.path.split(/[\\/]/).pop()} (${megabytes(made.size)}).`, 'info')
    onMade(made.path)
  }

  const remove = async (): Promise<void> => {
    if (!window.confirm(`Move “${clip.name}” to the ${navigator.platform.startsWith('Mac') ? 'Bin' : 'Recycle Bin'}?`)) return
    try {
      await window.api.clipsTrash(folder, clip.path)
      clipsChanged()
      onGone()
    } catch (err) {
      notify(err)
    }
  }

  // Dragging the clip out of Orbit, with a picture of the current frame as the drag image.
  const dragOut = (e: React.DragEvent): void => {
    e.preventDefault()
    let icon = ''
    try {
      const el = v()
      if (el && el.videoWidth) {
        const c = document.createElement('canvas')
        c.width = 160
        c.height = Math.round((160 * el.videoHeight) / el.videoWidth)
        c.getContext('2d')!.drawImage(el, 0, 0, c.width, c.height)
        icon = c.toDataURL('image/png')
      }
    } catch {
      // No picture: a plain one is used.
    }
    window.api.clipsDrag(folder, clip.path, icon)
  }

  const pct = (t: number): string => `${duration ? (t / duration) * 100 : 0}%`
  const captionPx = shown.w * caption.size

  return (
    <div className="clips-editor" tabIndex={-1} onKeyDown={onKey} data-clip-editor>
      <div className="clips-stage">
        {broken ? (
          <p className="clips-problem">This video can’t be played here. It may still be being saved, or be in a format Orbit can’t show.</p>
        ) : (
          <video
            ref={video}
            src={clipUrl(clip)}
            crossOrigin="anonymous"
            preload="auto"
            onLoadedMetadata={onMeta}
            onTimeUpdate={onTime}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => setBroken(true)}
            onClick={toggle}
          />
        )}
        {caption.text.trim() && shown.w > 0 && (
          <div
            className={`clips-caption-preview ${caption.position}`}
            style={{
              width: shown.w,
              fontSize: captionPx,
              padding: `${captionPx * 0.4}px 4%`,
              WebkitTextStrokeWidth: Math.max(1, captionPx * 0.14),
              left: shown.x + shown.w / 2,
              top: caption.position === 'top' ? shown.y : shown.y + shown.h,
              transform: `translate(-50%, ${caption.position === 'top' ? '0' : '-100%'})`
            }}
          >
            {caption.text}
          </div>
        )}
      </div>

      <div className="clips-controls">
        <button className="icon-btn" onClick={toggle} title={playing ? 'Pause (Space)' : 'Play (Space)'} disabled={!duration}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <span className="clips-time">
          {formatDuration(now * 1000)} / {formatDuration(duration * 1000)}
        </span>
        <div className="clips-track" ref={track} onPointerDown={drag('seek')} data-clip-track>
          <div className="clips-track-kept" style={{ left: pct(trim.start), width: pct(length) }} />
          <div className="clips-handle start" style={{ left: pct(trim.start) }} onPointerDown={drag('start')} title="Drag to set the start (or press I)" />
          <div className="clips-handle end" style={{ left: pct(trim.end) }} onPointerDown={drag('end')} title="Drag to set the end (or press O)" />
          <div className="clips-playhead" style={{ left: pct(now) }} />
        </div>
        <button className="btn" onClick={() => setStart(now)} title="Start the clip here (I)" disabled={!duration}>
          Start here
        </button>
        <button className="btn" onClick={() => setEnd(now)} title="End the clip here (O)" disabled={!duration}>
          End here
        </button>
      </div>
      <p className="clips-hint">
        Keeping {length.toFixed(1)} of {duration.toFixed(1)} seconds. Drag the ends of the bar, or press <kbd>I</kbd> and <kbd>O</kbd> while it plays.
      </p>

      <div className="clips-panels">
        <section className="clips-box">
          <h3>Caption</h3>
          <textarea
            className="text-input"
            rows={2}
            placeholder="Type a caption (optional)"
            value={caption.text}
            maxLength={200}
            onChange={(e) => setCaption({ ...caption, text: e.target.value })}
            data-clip-caption
          />
          <div className="clips-row">
            {(['top', 'bottom'] as const).map((p) => (
              <button key={p} className={`clips-chip ${caption.position === p ? 'on' : ''}`} onClick={() => setCaption({ ...caption, position: p })}>
                {p === 'top' ? 'Top' : 'Bottom'}
              </button>
            ))}
            <label className="clips-size">
              Size
              <input type="range" min={0.03} max={0.1} step={0.005} value={caption.size} onChange={(e) => setCaption({ ...caption, size: Number(e.target.value) })} />
            </label>
          </div>
        </section>

        <section className="clips-box">
          <h3>Save</h3>
          {busy ? (
            <div className="clips-busy">
              <span>
                {busy.label} {Math.round(busy.done * 100)}%
              </span>
              <div className="clips-meter">
                <div style={{ transform: `scaleX(${busy.done})` }} />
              </div>
              <button className="btn" onClick={() => void window.api.clipsCancel()}>
                <X size={13} /> Stop
              </button>
            </div>
          ) : (
            <div className="clips-row">
              <button className="btn btn-primary" onClick={() => void save(false)} disabled={!edited || !duration} title={edited ? 'Save the trimmed clip as a new video' : 'Trim it or add a caption first'} data-clip-save>
                <Save size={13} /> Save clip
              </button>
              <button className="btn" onClick={() => void save(true)} disabled={!duration} title="A smaller copy, under Discord’s 10 MB limit">
                Make it fit Discord
              </button>
            </div>
          )}
          <div className="clips-row">
            <span className="clips-drag" draggable onDragStart={dragOut} title="Drag this video into Discord, a chat or a folder" data-clip-drag>
              <GripVertical size={14} /> Drag this video out
            </span>
            <button className="icon-btn" title="Show in folder" onClick={() => void window.api.clipsReveal(folder, clip.path).catch(notify)}>
              <FolderOpen size={14} />
            </button>
            <button className="icon-btn" title="Delete" onClick={() => void remove()}>
              <Trash2 size={14} />
            </button>
          </div>
          <p className="clips-hint">
            {megabytes(clip.size)}
            {clip.size > DISCORD_LIMIT ? ': too big to drag straight into Discord without Nitro. Use “Make it fit Discord” first.' : '.'}
          </p>
        </section>

        <DiscordBox
          disabled={!!busy || !duration}
          send={async (hook, message) => {
            // An edited clip, or one that's too big, is made to fit first; then that's sent.
            let path = clip.path
            if (edited || clip.size > DISCORD_LIMIT) {
              const made = await make(true, 'Making it fit Discord…')
              if (!made) return false
              path = made.path
            }
            setBusy({ label: 'Sending to Discord…', done: 0.5 })
            try {
              await window.api.discordSend(folder, hook.id, path, message)
              notify(`Sent to ${hook.name}.`, 'info')
              if (path !== clip.path) onMade(path)
              return true
            } catch (err) {
              notify(err)
              return false
            } finally {
              setBusy(null)
            }
          }}
        />
      </div>
    </div>
  )
}

// ---------- Discord ----------

function DiscordBox({ disabled, send }: { disabled: boolean; send: (hook: DiscordHook, message: string) => Promise<boolean> }) {
  const [hooks, setHooks] = useState<DiscordHook[]>([])
  const [hookId, setHookId] = useState<string>(() => localStorage.getItem('clips.discordHook') ?? '')
  const [message, setMessage] = useState('')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.discordHooks().then((list) => {
      setHooks(list)
      if (!list.length) setAdding(true)
    })
  }, [])
  const hook = hooks.find((h) => h.id === hookId) ?? hooks[0] ?? null

  const add = async (): Promise<void> => {
    setError(null)
    try {
      const list = await window.api.discordAddHook(name, url)
      setHooks(list)
      const added = list[list.length - 1]
      if (added) {
        setHookId(added.id)
        localStorage.setItem('clips.discordHook', added.id)
      }
      setAdding(false)
      setName('')
      setUrl('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <section className="clips-box" data-discord-box>
      <h3>Send to Discord</h3>
      {hooks.length > 0 && (
        <>
          <div className="clips-row">
            <select
              className="text-input"
              value={hook?.id ?? ''}
              onChange={(e) => {
                setHookId(e.target.value)
                localStorage.setItem('clips.discordHook', e.target.value)
              }}
              aria-label="Channel"
            >
              {hooks.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
            <button className="icon-btn" title="Add a channel" onClick={() => setAdding((a) => !a)}>
              <Plus size={14} />
            </button>
            {hook && (
              <button
                className="icon-btn"
                title={`Forget ${hook.name}`}
                onClick={() => void window.api.discordRemoveHook(hook.id).then((list) => setHooks(list))}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <input className="text-input" placeholder="Message (optional)" value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} />
          <button
            className="btn btn-primary"
            disabled={disabled || !hook}
            onClick={() => hook && void send(hook, message).then((ok) => ok && setMessage(''))}
            data-discord-send
          >
            <Send size={13} /> Send to {hook?.name ?? 'Discord'}
          </button>
        </>
      )}
      {adding && (
        <div className="clips-add-hook">
          <p className="clips-hint">
            In Discord, open the channel’s settings (the cog beside it) → Integrations → Webhooks → New Webhook, then Copy Webhook URL and paste it here.
            Orbit keeps it encrypted on this computer.
          </p>
          <input className="text-input" placeholder="Name, e.g. #clips" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="text-input" placeholder="https://discord.com/api/webhooks/…" value={url} onChange={(e) => setUrl(e.target.value)} data-discord-url />
          <div className="clips-row">
            <button className="btn btn-primary" disabled={!url.trim()} onClick={() => void add()}>
              Save channel
            </button>
            {hooks.length > 0 && (
              <button className="btn" onClick={() => setAdding(false)}>
                Cancel
              </button>
            )}
          </div>
          {error && <p className="clips-problem">{error}</p>}
        </div>
      )}
      <p className="clips-hint">No webhook? Use “Drag this video out” and drop it into any Discord chat instead.</p>
    </section>
  )
}
