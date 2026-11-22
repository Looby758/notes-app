import './clips.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Download, FolderInput, FolderOpen, Gamepad2, GripVertical, Pause, Pencil, Play, Plus, Save, Send, Settings, Star, Trash2, X } from 'lucide-react'
import { cleanTrim, DISCORD_LIMIT, EMPTY_CLIPS_META, megabytes, type CaptionPosition, type ClipsMeta, type DiscordHook } from '@shared/clips'
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

const clipUrl = (clip: ClipInfo): string => `vault://clips/${encodeURIComponent(clip.rel)}?v=${Math.round(clip.modified)}`
const when = (ms: number): string => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function ClipsPage() {
  const folder = useStudio((s) => s.folder)
  const version = useReplay((s) => s.version)
  const lastSaved = useReplay((s) => s.lastSaved)
  const request = useReplay((s) => s.request)
  const [clips, setClips] = useState<ClipInfo[]>([])
  const [meta, setMeta] = useState<ClipsMeta>(EMPTY_CLIPS_META)
  const [selected, setSelected] = useState<string | null>(null)
  /** Which clips the list shows: everything, the starred ones, one game's folder, or the ones in no folder. */
  const [view, setView] = useState<ClipView>({ kind: 'all' })

  const refresh = useCallback(async (): Promise<ClipInfo[]> => {
    const [list, m] = await Promise.all([window.api.clipsList(folder).catch(() => [] as ClipInfo[]), window.api.clipsMeta(folder).catch(() => EMPTY_CLIPS_META)])
    setClips(list)
    setMeta(m)
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
  // A folder that was renamed or emptied away goes back to showing everything.
  useEffect(() => {
    if (view.kind === 'folder' && !meta.folders.includes(view.name)) setView({ kind: 'all' })
  }, [meta, view])
  const shownClips = clips.filter((c) => (view.kind === 'starred' ? c.favourite : view.kind === 'folder' ? c.folder === view.name : view.kind === 'loose' ? !c.folder : true))

  const star = async (c: ClipInfo, on: boolean): Promise<void> => {
    // Shown straight away; the file is written behind it.
    setClips((list) => list.map((x) => (x.path === c.path ? { ...x, favourite: on } : x)))
    await window.api.clipsStar(folder, c.path, on).catch(notify)
    void refresh()
  }

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
          <ClipFolders clips={clips} meta={meta} view={view} setView={setView} folder={folder} refresh={refresh} />
          {clips.length === 0 && <p className="clips-empty">Nothing yet. Turn on instant replay, then press the shortcut after something good happens. Replays saved while a game is running go in a folder for that game.</p>}
          {clips.length > 0 && shownClips.length === 0 && (
            <p className="clips-empty">{view.kind === 'starred' ? 'No starred clips yet. Press the star on a clip to keep it here.' : 'Nothing in here.'}</p>
          )}
          {shownClips.map((c) => (
            <div key={c.path} className={`clips-item ${c.path === selected ? 'on' : ''}`} data-clip={c.name}>
              <button className="clips-item-open" onClick={() => setSelected(c.path)}>
                <span className="clips-item-name">{c.title}</span>
                <span className="clips-item-meta">
                  {view.kind !== 'folder' && c.folder && (
                    <>
                      <Gamepad2 size={10} /> {c.folder} ·{' '}
                    </>
                  )}
                  {when(c.modified)} · {megabytes(c.size)}
                </span>
              </button>
              <button
                className={`clips-star ${c.favourite ? 'on' : ''}`}
                title={c.favourite ? 'Unstar' : 'Star this clip'}
                aria-pressed={c.favourite}
                onClick={() => void star(c, !c.favourite)}
                data-clip-star
              >
                <Star size={14} fill={c.favourite ? 'currentColor' : 'none'} />
              </button>
            </div>
          ))}
        </aside>
        {clip ? (
          <ClipEditor
            key={clip.path}
            clip={clip}
            folder={folder}
            folders={meta.folders}
            onStar={(on) => void star(clip, on)}
            onMoved={(path) => void refresh().then(() => setSelected(path))}
            onMade={(path) => void refresh().then(() => setSelected(path))}
            onGone={() => void refresh()}
          />
        ) : (
          <div className="clips-none">Pick a clip to trim it, add a caption or send it.</div>
        )}
      </div>
    </div>
  )
}

// ---------- game folders ----------

type ClipView = { kind: 'all' } | { kind: 'starred' } | { kind: 'loose' } | { kind: 'folder'; name: string }

/** The chips above the list: All, Starred, a folder per game (named after it, renamable), and Not sorted. */
function ClipFolders({
  clips,
  meta,
  view,
  setView,
  folder,
  refresh
}: {
  clips: ClipInfo[]
  meta: ClipsMeta
  view: ClipView
  setView: (v: ClipView) => void
  folder: string | null
  refresh: () => Promise<ClipInfo[]>
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const starred = clips.filter((c) => c.favourite).length
  const loose = clips.filter((c) => !c.folder).length
  const count = (f: string): number => clips.filter((c) => c.folder === f).length
  const is = (v: ClipView): boolean => v.kind === view.kind && (v.kind !== 'folder' || (view.kind === 'folder' && view.name === v.name))
  const games = Object.entries(meta.games)

  const rename = async (): Promise<void> => {
    if (!renaming) return
    const to = name.trim()
    try {
      if (to && to !== renaming) await window.api.clipsRenameFolder(folder, renaming, to)
      setRenaming(null)
      await refresh()
      if (to) setView({ kind: 'folder', name: to })
    } catch (err) {
      notify(errorMessage(err))
    }
  }

  if (meta.folders.length === 0 && starred === 0) return null
  return (
    <div className="clips-folders" data-clip-folders>
      <div className="clips-chips">
        <button className={`clips-chip ${is({ kind: 'all' }) ? 'on' : ''}`} onClick={() => setView({ kind: 'all' })}>
          All <em>{clips.length}</em>
        </button>
        <button className={`clips-chip ${is({ kind: 'starred' }) ? 'on' : ''}`} onClick={() => setView({ kind: 'starred' })} data-clip-view="starred">
          <Star size={11} fill="currentColor" /> Starred <em>{starred}</em>
        </button>
        {meta.folders.map((f) => (
          <button key={f} className={`clips-chip ${is({ kind: 'folder', name: f }) ? 'on' : ''}`} onClick={() => setView({ kind: 'folder', name: f })} data-clip-view={f}>
            <Gamepad2 size={11} /> {f} <em>{count(f)}</em>
          </button>
        ))}
        {meta.folders.length > 0 && loose > 0 && (
          <button className={`clips-chip ${is({ kind: 'loose' }) ? 'on' : ''}`} onClick={() => setView({ kind: 'loose' })} title="Clips saved when no game was running, or before Orbit sorted them">
            Not sorted <em>{loose}</em>
          </button>
        )}
      </div>
      {view.kind === 'folder' &&
        (renaming === view.name ? (
          <form
            className="clips-rename"
            onSubmit={(e) => {
              e.preventDefault()
              void rename()
            }}
          >
            <input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} aria-label="Folder name" />
            <button className="icon-btn" title="Rename" type="submit">
              <Check size={13} />
            </button>
            <button className="icon-btn" title="Cancel" type="button" onClick={() => setRenaming(null)}>
              <X size={13} />
            </button>
          </form>
        ) : (
          <p className="clips-folder-note">
            {games.filter(([, f]) => f === view.name).length > 0 ? (
              <>Replays of {games.filter(([, f]) => f === view.name).map(([g]) => g).join(', ')} go here.</>
            ) : (
              'Clips you moved here.'
            )}
            <button
              className="icon-btn"
              title="Rename this folder (new replays of the game go to the new name)"
              onClick={() => {
                setName(view.name)
                setRenaming(view.name)
              }}
              data-clip-rename
            >
              <Pencil size={12} />
            </button>
          </p>
        ))}
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

function ClipEditor({
  clip,
  folder,
  folders,
  onStar,
  onMoved,
  onMade,
  onGone
}: {
  clip: ClipInfo
  folder: string | null
  folders: string[]
  onStar: (on: boolean) => void
  onMoved: (path: string) => void
  onMade: (path: string) => void
  onGone: () => void
}) {
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
    if (!window.confirm(`Move “${clip.title}” to the ${navigator.platform.startsWith('Mac') ? 'Bin' : 'Recycle Bin'}?`)) return
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
            <button className={`icon-btn clips-star ${clip.favourite ? 'on' : ''}`} title={clip.favourite ? 'Unstar' : 'Star this clip'} aria-pressed={clip.favourite} onClick={() => onStar(!clip.favourite)}>
              <Star size={14} fill={clip.favourite ? 'currentColor' : 'none'} />
            </button>
            <MoveTo clip={clip} folder={folder} folders={folders} onMoved={onMoved} />
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

/** Moves a clip into a game folder (an old clip from before Orbit sorted them, or one that landed in the wrong game). */
function MoveTo({ clip, folder, folders, onMoved }: { clip: ClipInfo; folder: string | null; folders: string[]; onMoved: (path: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const move = async (to: string): Promise<void> => {
    try {
      const path = await window.api.clipsMove(folder, clip.path, to)
      setOpen(false)
      setName('')
      clipsChanged()
      onMoved(path)
    } catch (err) {
      notify(errorMessage(err))
    }
  }
  return (
    <span className="clips-move">
      <button className="icon-btn" title="Move to a game folder" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-clip-move>
        <FolderInput size={14} />
      </button>
      {open && (
        <div className="clips-move-menu" role="menu" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          {folders
            .filter((f) => f !== clip.folder)
            .map((f) => (
              <button key={f} role="menuitem" onClick={() => void move(f)}>
                <Gamepad2 size={12} /> {f}
              </button>
            ))}
          {clip.folder && (
            <button role="menuitem" onClick={() => void move('')}>
              Out of folders
            </button>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) void move(name.trim())
            }}
          >
            <input placeholder="New folder…" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="New folder name" />
            <button className="icon-btn" type="submit" title="Move into a new folder" disabled={!name.trim()}>
              <Plus size={13} />
            </button>
          </form>
        </div>
      )}
    </span>
  )
}
