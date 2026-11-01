import './video.css'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  ArrowLeft,
  AudioLines,
  Captions,
  Download,
  Film,
  FolderOpen,
  Gauge,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  SquareArrowDownLeft,
  SquareArrowOutUpRight,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import type { FfmpegState } from '@shared/types'
import {
  SPEEDS,
  cuesAt,
  formatTime,
  isSubtitleFile,
  isVideoFile,
  maybeNative,
  parseSubtitles,
  playMode,
  resumePoint,
  stepSpeed,
  trackLabel,
  videoStreamUrl,
  videoUrl,
  type Cue,
  type PlayMode,
  type VideoInfo
} from '@shared/videoPlayer'
import { FILE_MANAGER } from '@shared/platform'
import { notify } from '../../store/notify'
import { IN_VIDEO_WINDOW, closeVideo, forgetVideo, openVideo, remember, useVideoPlayer, watchedOf, type SubtitleChoice } from '../../store/videoPlayer'
import { unloadMedia } from '../../lib/media'

/**
 * The video player tab: plays any video on the computer (MKV, AVI, WMV… through the video helper,
 * ffmpeg, when the window can't play them itself), with subtitles, sound tracks, speed and
 * carrying on where you stopped. With no video open it lists the ones you've watched.
 */
export default function VideoPage({ autoFocus }: { autoFocus?: boolean }) {
  const current = useVideoPlayer((s) => s.current)
  return current ? <Player key={current} path={current} autoFocus={autoFocus} /> : <VideoList />
}

const fileName = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)

async function pickVideo(): Promise<void> {
  const path = await window.api.pickVideoFile('video').catch((e) => (notify(e), null))
  if (path) openVideo(path)
}

/** The video helper's (ffmpeg's) state, kept up to date while it downloads. */
function useFfmpeg(): FfmpegState | null {
  const [state, setState] = useState<FfmpegState | null>(null)
  useEffect(() => {
    void window.api.videoConverterStatus().then(setState)
    return window.api.onVideoConverterStatus(setState)
  }, [])
  return state
}

function HelperDownload({ state, compact }: { state: FfmpegState | null; compact?: boolean }) {
  if (!state || state.state === 'ready') return null
  if (state.state === 'unsupported') return <p className="video-helper-note">The video helper isn’t available for this computer, so only MP4 and WebM videos play.</p>
  if (state.state === 'downloading')
    return (
      <p className="video-helper-note">
        <Loader2 size={14} className="spin" /> Downloading the video helper… {Math.round((state.progress ?? 0) * 100)}%
      </p>
    )
  return (
    <div className={`video-helper ${compact ? 'compact' : ''}`} data-video-helper>
      <span>
        {compact
          ? 'MKV, AVI, WMV and other videos, their sound tracks and their own subtitles need the video helper (ffmpeg, a free video tool). It’s a one-time download of about 25 MB.'
          : 'This kind of video needs the video helper (ffmpeg, a free video tool). It’s a one-time download of about 25 MB, and Convert files and the Studio use it too.'}
        {state.error && <small className="video-helper-error">{state.error}</small>}
      </span>
      <button className="btn btn-primary" onClick={() => void window.api.getVideoConverter()} data-video-get-helper>
        <Download size={13} /> Download
      </button>
    </div>
  )
}

/** Dropping a video file anywhere on the page plays it. */
function dropVideo(e: DragEvent): string | null {
  const file = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).find((p) => p && isVideoFile(p))
  return file ?? null
}

function VideoList() {
  const history = useVideoPlayer((s) => s.history)
  const ffmpeg = useFfmpeg()
  const [over, setOver] = useState(false)

  return (
    <div
      className={`video-list-page ${over ? 'drop' : ''}`}
      data-video-list
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const path = dropVideo(e)
        if (!path) return
        e.preventDefault()
        openVideo(path)
      }}
    >
      <div className="video-list-inner">
        <div className="video-list-head">
          <h2>
            <Film size={20} /> Video player
          </h2>
          <button className="btn btn-primary" onClick={() => void pickVideo()} data-video-open>
            <FolderOpen size={13} /> Open a video…
          </button>
        </div>
        <p className="video-list-blurb">
          Plays any video: MP4, MKV, AVI, WMV, MOV and more, with subtitles, a choice of sound track and speed. Each video carries on where you stopped.
          Drop one here, or open one from Files.
        </p>
        <HelperDownload state={ffmpeg} compact />
        {history.length > 0 && (
          <>
            <h3>Carry on watching</h3>
            <ul className="video-history">
              {history.map((h) => (
                <li key={h.path}>
                  <button className="video-history-item" onClick={() => openVideo(h.path)} title={h.path}>
                    <Play size={14} />
                    <span className="video-history-name">{h.name}</span>
                    <span className="video-history-time">
                      {h.at > 0 ? (h.duration ? `${formatTime(h.at)} of ${formatTime(h.duration)}` : formatTime(h.at)) : 'Watched'}
                    </span>
                    {h.duration ? (
                      <span className="video-history-bar">
                        <span style={{ width: `${h.at > 0 ? Math.min(100, (h.at / h.duration) * 100) : 100}%` }} />
                      </span>
                    ) : null}
                  </button>
                  <button className="icon-btn" title="Take off the list" onClick={() => forgetVideo(h.path)}>
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- the player ----------

/** `offset`: where the stream's own clock starts in the video; `target`: where to jump to once it's loaded. */
type Source = { mode: PlayMode; src: string; offset: number; target: number } | { mode: 'needs-helper' | 'broken' }

const sameChoice = (a: SubtitleChoice, b: SubtitleChoice): boolean =>
  a.kind === b.kind && (a.kind !== 'file' || a.path === (b as { path: string }).path) && (a.kind !== 'stream' || a.stream === (b as { stream: number }).stream)

const choiceKey = (c: SubtitleChoice): string => (c.kind === 'file' ? `f:${c.path}` : c.kind === 'stream' ? `s:${c.stream}` : 'off')

/** Subtitles when a video is first opened: a file beside it, else its own default text track. */
function firstSubtitles(info: VideoInfo): SubtitleChoice {
  if (info.subtitleFiles[0]) return { kind: 'file', path: info.subtitleFiles[0] }
  const own = info.probe?.subtitles.find((s) => s.text && s.isDefault)
  return own ? { kind: 'stream', stream: own.stream } : { kind: 'off' }
}

function Player({ path, autoFocus }: { path: string; autoFocus?: boolean }) {
  const video = useRef<HTMLVideoElement | null>(null)
  // A video taken off the page is emptied, so the window stops reading its file straight away.
  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    video.current = el
    return el
      ? () => {
          if (video.current === el) video.current = null
          unloadMedia(el)
        }
      : undefined
  }, [])
  const wrap = useRef<HTMLDivElement>(null)
  const session = useMemo(() => Math.random().toString(36).slice(2), [])
  const saved = useMemo(() => watchedOf(path), [path])
  const ffmpeg = useFfmpeg()
  const volume = useVideoPlayer((s) => s.volume)
  const muted = useVideoPlayer((s) => s.muted)

  const [info, setInfo] = useState<VideoInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [failed, setFailed] = useState<PlayMode[]>([])
  const [audio, setAudio] = useState(saved?.audio ?? 0)
  /** Where the next stream starts (live streams restart from here after a big jump). */
  const [streamStart, setStreamStart] = useState(() => resumePoint(saved?.at, saved?.duration) ?? 0)
  const [source, setSource] = useState<Source | null>(null)
  const [time, setTime] = useState(streamStart)
  const [duration, setDuration] = useState<number | null>(saved?.duration ?? null)
  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(true)
  const [ended, setEnded] = useState(false)
  const [speed, setSpeed] = useState(saved?.speed ?? 1)
  const [scrub, setScrub] = useState<number | null>(null)
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)
  const [menu, setMenu] = useState<'speed' | 'subtitles' | 'audio' | null>(null)
  const [controls, setControls] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [resumed, setResumed] = useState<number | null>(() => resumePoint(saved?.at, saved?.duration))
  const [hintClosed, setHintClosed] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const [subtitles, setSubtitles] = useState<SubtitleChoice | null>(saved?.subtitles ?? null)
  const [extraFiles, setExtraFiles] = useState<string[]>(() => (saved?.subtitles?.kind === 'file' ? [saved.subtitles.path] : []))
  const [cues, setCues] = useState<Cue[]>([])
  const [cueText, setCueText] = useState('')
  const [subsLoading, setSubsLoading] = useState(false)
  const [delay, setDelay] = useState(saved?.subtitleDelay ?? 0)

  const speedRef = useRef(speed)
  speedRef.current = speed
  const offset = source && 'offset' in source ? source.offset : 0
  const live = source && 'src' in source && source.mode !== 'direct'
  const lastSave = useRef(0)
  const timeRef = useRef(time)
  timeRef.current = time
  const durationRef = useRef(duration)
  durationRef.current = duration
  const sourceRef = useRef(source)
  sourceRef.current = source

  // ---- what's in it ----
  const helperReady = ffmpeg?.state === 'ready'
  useEffect(() => {
    let alive = true
    window.api
      .videoInfo(path)
      .then((i) => {
        if (!alive) return
        // Read again while playing (the helper just arrived): carry on from here, not from the start.
        if (sourceRef.current && 'src' in sourceRef.current) setStreamStart(timeRef.current)
        setInfo(i)
        if (i.probe?.duration) setDuration(i.probe.duration)
        setSubtitles((s) => s ?? firstSubtitles(i))
      })
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)))
    return () => {
      alive = false
    }
    // Read again once the helper arrives, to see the tracks.
  }, [path, helperReady])

  // ---- how to play it ----
  useEffect(() => {
    if (!info) return
    let alive = true
    const probe = info.probe
    const mode: PlayMode | 'needs-helper' = probe ? playMode(probe, audio, failed) : maybeNative(info.name) && !failed.includes('direct') ? 'direct' : 'needs-helper'
    if (mode === 'needs-helper') return setSource({ mode })
    if (mode === 'transcode' && failed.includes('transcode')) return setSource({ mode: 'broken' })
    if (mode === 'direct') return setSource({ mode, src: videoUrl(info.path), offset: 0, target: streamStart })
    setWaiting(true)
    void (async () => {
      const start = mode === 'remux' ? await window.api.videoKeyframe(info.path, streamStart, probe?.start ?? 0).catch(() => streamStart) : streamStart
      if (alive) setSource({ mode, offset: start, target: streamStart, src: videoStreamUrl(info.path, { mode, start, audio, session }) })
    })()
    return () => {
      alive = false
    }
    // streamStart only matters for live streams (direct files seek by themselves).
  }, [info, failed, audio, streamStart])

  useEffect(() => () => void window.api.stopVideoStream(session), [session])
  // Closing the player (or moving on to another video) lets go of this one, so it can be deleted or
  // moved without closing Orbit.
  useEffect(() => () => void window.api.releaseVideo(path).catch(() => undefined), [path])

  /** The window couldn't play it this way: try the next. */
  const fail = (mode: PlayMode): void => {
    setStreamStart(timeRef.current)
    setFailed((f) => (f.includes(mode) ? f : [...f, mode]))
  }

  // ---- remembering ----
  const save = (at = timeRef.current): void => remember(path, { at, duration: durationRef.current })
  useEffect(() => () => save(), [])
  useEffect(() => remember(path, { audio, speed, subtitleDelay: delay, ...(subtitles ? { subtitles } : {}) }), [audio, speed, delay, subtitles])

  // ---- the video element's settings ----
  useEffect(() => {
    const v = video.current
    if (!v) return
    v.defaultPlaybackRate = speed
    if (skipTo.current === null) v.playbackRate = speed
  }, [speed, source])
  useEffect(() => {
    const v = video.current
    if (!v) return
    v.volume = volume
    if (skipTo.current === null) v.muted = muted
  }, [volume, muted, source])

  // ---- subtitles ----
  useEffect(() => {
    setCues([])
    if (!subtitles || subtitles.kind === 'off') return
    let alive = true
    setSubsLoading(true)
    const name = subtitles.kind === 'file' ? subtitles.path : 'track.vtt'
    window.api
      .videoSubtitles(path, subtitles.kind === 'file' ? { file: subtitles.path } : { stream: subtitles.stream })
      .then((text) => {
        if (!alive) return
        const list = parseSubtitles(text, name)
        setCues(list)
        if (!list.length) notify('Those subtitles are empty, or in a kind Orbit can’t read.', 'info')
      })
      .catch((e) => alive && notify(e))
      .finally(() => alive && setSubsLoading(false))
    return () => {
      alive = false
    }
  }, [path, subtitles && choiceKey(subtitles)])

  // Subtitles follow the picture closely, so they're checked every frame (not just on timeupdate).
  useEffect(() => {
    if (!cues.length) return setCueText('')
    let raf = 0
    const tick = (): void => {
      const v = video.current
      if (v) {
        const now = offset + v.currentTime - delay
        const text = cuesAt(cues, now)
          .map((c) => c.text)
          .join('\n')
        setCueText((old) => (old === text ? old : text))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [cues, offset, delay])

  // ---- moving around ----
  const skipTo = useRef<number | null>(null)
  const [skipping, setSkipping] = useState(false)
  const catchUp = (v: HTMLVideoElement): void => {
    const to = skipTo.current
    if (to === null) return
    if (v.currentTime < to - 0.04) return
    skipTo.current = null
    v.playbackRate = speedRef.current
    v.muted = useVideoPlayer.getState().muted
    setSkipping(false)
  }
  const pendingSeek = useRef<{ t: number; timer: ReturnType<typeof setTimeout> } | null>(null)
  const seek = (target: number): void => {
    const v = video.current
    if (!v || !source || !('src' in source)) return
    const t = Math.max(0, duration ? Math.min(target, duration - 0.5) : target)
    setEnded(false)
    setResumed(null)
    setTime(t)
    if (!live) {
      v.currentTime = t
      return
    }
    // In a live stream, a spot that's already loaded is jumped to; anything else restarts the stream there.
    const rel = t - offset
    for (let i = 0; i < v.buffered.length; i++) {
      if (rel >= v.buffered.start(i) && rel <= v.buffered.end(i) - 0.5) {
        v.currentTime = rel
        return
      }
    }
    // Quick key presses add up before the stream restarts once.
    if (pendingSeek.current) clearTimeout(pendingSeek.current.timer)
    pendingSeek.current = {
      t,
      timer: setTimeout(() => {
        pendingSeek.current = null
        setStreamStart(t)
      }, 300)
    }
  }
  const nudge = (by: number): void => seek((pendingSeek.current?.t ?? timeRef.current) + by)

  const togglePlay = (): void => {
    const v = video.current
    if (!v) return
    if (ended) seek(0)
    if (v.paused) void v.play().catch(() => undefined)
    else v.pause()
  }

  const setVolume = (n: number): void => useVideoPlayer.setState({ volume: Math.min(1, Math.max(0, n)), muted: n <= 0 })
  const toggleMute = (): void => useVideoPlayer.setState((s) => ({ muted: !s.muted }))
  const changeSpeed = (s: number): void => {
    setSpeed(s)
    show(`${s}×`)
  }
  const show = (text: string): void => {
    setFlash(text)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 900)
  }
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  /** Into a window of its own, which can go full screen on its screen while Orbit carries on. */
  const popOut = async (): Promise<void> => {
    save()
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
    closeVideo()
    await window.api.releaseVideo(path).catch(() => undefined)
    await window.api.popOutVideo(path).catch(notify)
  }
  /** From the video window back into the player tab. */
  const popIn = (): void => {
    save()
    void window.api.popInVideo(path).catch(notify)
  }

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void wrap.current?.requestFullscreen().catch(() => undefined)
  }
  useEffect(() => {
    const on = (): void => setFullscreen(document.fullscreenElement === wrap.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  const pickSubtitles = async (): Promise<void> => {
    setMenu(null)
    const file = await window.api.pickVideoFile('subtitles', path).catch((e) => (notify(e), null))
    if (file) loadSubtitleFile(file)
  }
  const loadSubtitleFile = (file: string): void => {
    setExtraFiles((list) => (list.includes(file) || info?.subtitleFiles.includes(file) ? list : [...list, file]))
    setSubtitles({ kind: 'file', path: file })
  }
  const toggleSubtitles = (): void => {
    if (subtitles && subtitles.kind !== 'off') {
      setSubtitles({ kind: 'off' })
      show('Subtitles off')
      return
    }
    const first: SubtitleChoice | null = info?.subtitleFiles[0] || extraFiles[0] ? { kind: 'file', path: info?.subtitleFiles[0] || extraFiles[0] } : null
    const own = info?.probe?.subtitles.find((s) => s.text)
    const next = first ?? (own ? ({ kind: 'stream', stream: own.stream } as SubtitleChoice) : null)
    if (next) {
      setSubtitles(next)
      show('Subtitles on')
    } else show('No subtitles')
  }

  // ---- controls that hide while you watch ----
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const wake = (): void => {
    setControls(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControls(false), 2500)
  }
  useEffect(() => () => clearTimeout(hideTimer.current), [])
  const showControls = controls || !playing || !!menu || scrub !== null

  const onKeyDown = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key
    let done = true
    if (k === ' ' || k === 'k' || k === 'K') togglePlay()
    else if (k === 'ArrowLeft') nudge(-5)
    else if (k === 'ArrowRight') nudge(5)
    else if (k === 'j' || k === 'J') nudge(-10)
    else if (k === 'l' || k === 'L') nudge(10)
    else if (k === 'ArrowUp') (setVolume(volume + 0.05), show(`${Math.round(Math.min(1, volume + 0.05) * 100)}%`))
    else if (k === 'ArrowDown') (setVolume(volume - 0.05), show(`${Math.round(Math.max(0, volume - 0.05) * 100)}%`))
    else if (k === 'm' || k === 'M') toggleMute()
    else if (k === 'f' || k === 'F') toggleFullscreen()
    else if ((k === 'o' || k === 'O') && IN_VIDEO_WINDOW) popIn()
    else if (k === 'o' || k === 'O') void popOut()
    else if (k === 'c' || k === 'C') toggleSubtitles()
    else if (k === ']' || k === '>') changeSpeed(stepSpeed(speed, 1))
    else if (k === '[' || k === '<') changeSpeed(stepSpeed(speed, -1))
    else if (k === '\\') changeSpeed(1)
    else if (k === 'Home') seek(0)
    else if (/^[0-9]$/.test(k) && duration) seek((Number(k) / 10) * duration)
    else if (k === 'Escape' && menu) setMenu(null)
    else done = false
    if (done) {
      e.preventDefault()
      e.stopPropagation()
      wake()
    }
  }

  useEffect(() => {
    if (autoFocus) wrap.current?.focus({ preventScroll: true })
  }, [autoFocus])

  // "Carrying on from…" goes away by itself once it's been seen.
  const playingSource = !!source && 'src' in source
  useEffect(() => {
    if (resumed === null || !playingSource) return
    const t = setTimeout(() => setResumed(null), 8000)
    return () => clearTimeout(t)
  }, [resumed === null, playingSource])

  // ---- the seek bar ----
  const bar = useRef<HTMLDivElement>(null)
  const timeAt = (clientX: number): number => {
    const r = bar.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (duration ?? 0)
  }
  const onBarDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!duration) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const t = timeAt(e.clientX)
    setScrub(t)
    if (!live) seek(t)
  }
  const onBarMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!duration) return
    const t = timeAt(e.clientX)
    const r = bar.current!.getBoundingClientRect()
    setHover({ x: e.clientX - r.left, t })
    if (scrub !== null) {
      setScrub(t)
      if (!live) seek(t)
    }
  }
  const onBarUp = (): void => {
    if (scrub === null) return
    seek(scrub)
    setScrub(null)
  }

  const shown = scrub ?? pendingSeek.current?.t ?? time
  const buffered = (() => {
    const v = video.current
    if (!v || !duration || !v.buffered.length) return 0
    const rel = shown - offset
    for (let i = 0; i < v.buffered.length; i++) if (rel >= v.buffered.start(i) - 1 && rel <= v.buffered.end(i)) return Math.min(1, (offset + v.buffered.end(i)) / duration)
    return 0
  })()

  const probe = info?.probe ?? null
  const audioTracks = probe?.audio ?? []
  const ownSubs = probe?.subtitles ?? []
  const subFiles = [...(info?.subtitleFiles ?? []), ...extraFiles.filter((f) => !info?.subtitleFiles.includes(f))]
  const name = fileName(path)

  if (loadError)
    return (
      <div className="video-player-page" data-video-player>
        <div className="video-message">
          <p>{loadError}</p>
          <button className="btn" onClick={() => (forgetVideo(path), closeVideo())}>
            <ArrowLeft size={13} /> All videos
          </button>
        </div>
      </div>
    )

  return (
    <div
      ref={wrap}
      className={`video-player-page ${showControls ? '' : 'idle'} ${fullscreen ? 'fullscreen' : ''}`}
      tabIndex={0}
      data-video-player
      data-mode={source?.mode ?? ''}
      onKeyDown={onKeyDown}
      onMouseMove={wake}
      onMouseLeave={() => setControls(false)}
      onDragOver={(e) => [...e.dataTransfer.types].includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        const file = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).find(Boolean)
        if (!file) return
        e.preventDefault()
        if (isSubtitleFile(file)) loadSubtitleFile(file)
        else if (isVideoFile(file)) (save(), openVideo(file))
      }}
    >
      {source && 'src' in source && (
        <video
          ref={videoRef}
          key={source.src}
          className={skipping ? 'skipping' : ''}
          src={source.src}
          autoPlay
          onClick={() => (menu ? setMenu(null) : togglePlay())}
          onDoubleClick={toggleFullscreen}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            // Plays, but with no picture: the window can't decode this one after all.
            if (probe?.video && v.videoWidth === 0 && source.mode !== 'transcode') return fail(source.mode)
            if (source.mode === 'direct' && !probe?.duration && Number.isFinite(v.duration)) setDuration(v.duration)
            const skip = source.target - source.offset
            if (source.mode === 'direct') {
              if (skip > 0.05) v.currentTime = skip
            } else if (skip > 0.05) {
              // A copied stream starts at the keyframe before the spot asked for, and a live stream can't
              // jump ahead to what hasn't arrived: the few seconds before the spot play hidden, silent and fast.
              skipTo.current = skip
              setSkipping(true)
              v.muted = true
              v.playbackRate = 16
            }
          }}
          onProgress={(e) => catchUp(e.currentTarget)}
          onTimeUpdate={(e) => {
            if (skipTo.current !== null) return catchUp(e.currentTarget)
            // A jump is about to restart the stream: the old one's clock no longer counts.
            if (pendingSeek.current) return
            const t = offset + e.currentTarget.currentTime
            setTime(t)
            if (Math.abs(t - lastSave.current) > 5) {
              lastSave.current = t
              save(t)
            }
          }}
          onPlay={() => (setPlaying(true), setEnded(false), wake())}
          onPause={() => (setPlaying(false), save())}
          onWaiting={() => setWaiting(true)}
          onPlaying={() => setWaiting(false)}
          onCanPlay={() => setWaiting(false)}
          onEnded={() => {
            setEnded(true)
            setPlaying(false)
            remember(path, { at: 0, duration })
          }}
          onError={() => fail(source.mode)}
        />
      )}

      {cueText && (
        <div className="video-cues" data-video-cues>
          {cueText.split('\n').map((line, i) => (
            <span key={i}>{line}</span>
          ))}
        </div>
      )}

      {source?.mode === 'needs-helper' && (
        <div className="video-message">
          <Film size={34} strokeWidth={1.3} />
          <h3>{name}</h3>
          {ffmpeg?.state === 'ready' ? <Loader2 size={18} className="spin" /> : <HelperDownload state={ffmpeg} />}
        </div>
      )}
      {source?.mode === 'broken' && (
        <div className="video-message">
          <Film size={34} strokeWidth={1.3} />
          <h3>{name}</h3>
          <p>This video couldn’t be played. It may be damaged, or not finished downloading.</p>
          <button className="btn" onClick={() => window.api.explorerOpen(path).catch(notify)}>
            Open in its usual app
          </button>
        </div>
      )}
      {(!source || ('src' in source && (waiting || skipping) && !ended)) && !loadError && (
        <div className="video-spinner">
          <Loader2 size={30} className="spin" />
        </div>
      )}
      {flash && <div className="video-flash">{flash}</div>}

      <div className="video-top">
        <button className="btn video-back" onClick={() => (save(), closeVideo())} title={IN_VIDEO_WINDOW ? 'Close' : 'All videos'}>
          {IN_VIDEO_WINDOW ? <X size={14} /> : <ArrowLeft size={14} />}
        </button>
        <span className="video-title" title={path}>
          {name}
        </span>
        {live && <span className="video-badge" title={source?.mode === 'remux' ? 'The sound is converted as it plays' : 'Converted as it plays'}>{source?.mode === 'remux' ? 'Sound converted' : 'Converted'}</span>}
        <span className="video-top-gap" />
        <button className="btn" onClick={() => window.api.explorerReveal(path).catch(notify)} title={`Show in ${FILE_MANAGER}`}>
          <FolderOpen size={13} />
        </button>
        <button className="btn" onClick={() => (save(), void pickVideo())}>
          Open another…
        </button>
      </div>

      {resumed !== null && source && 'src' in source && (
        <div className="video-resumed" data-video-resumed>
          Carrying on from {formatTime(resumed)}
          <button className="btn" onClick={() => seek(0)}>
            Start from the beginning
          </button>
          <button className="icon-btn" onClick={() => setResumed(null)} title="Close">
            <X size={13} />
          </button>
        </div>
      )}

      {!info?.probe && source?.mode === 'direct' && ffmpeg?.state === 'missing' && !hintClosed && /\.mkv$/i.test(path) && (
        <div className="video-hint">
          <span>No sound, or subtitles missing? Many MKVs need the video helper for those (a one-time 25 MB download).</span>
          <button className="btn btn-primary" onClick={() => void window.api.getVideoConverter()}>
            <Download size={13} /> Download
          </button>
          <button className="icon-btn" onClick={() => setHintClosed(true)} title="Close">
            <X size={13} />
          </button>
        </div>
      )}

      {source && 'src' in source && (
        <div className="video-controls" onClick={(e) => e.stopPropagation()}>
          <div
            ref={bar}
            className={`video-bar ${duration ? '' : 'unknown'}`}
            onPointerDown={onBarDown}
            onPointerMove={onBarMove}
            onPointerUp={onBarUp}
            onPointerLeave={() => setHover(null)}
            data-video-bar
          >
            <div className="video-bar-track">
              <div className="video-bar-buffered" style={{ width: `${buffered * 100}%` }} />
              <div className="video-bar-played" style={{ width: `${duration ? Math.min(100, (shown / duration) * 100) : 0}%` }} />
            </div>
            {hover && duration && (
              <span className="video-bar-tip" style={{ left: hover.x }}>
                {formatTime(hover.t)}
              </span>
            )}
          </div>
          <div className="video-buttons">
            <button className="icon-btn" onClick={togglePlay} title={playing ? 'Pause (Space)' : 'Play (Space)'} data-video-play>
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button className="icon-btn" onClick={() => nudge(-10)} title="Back 10 seconds (J)">
              <RotateCcw size={16} />
            </button>
            <button className="icon-btn" onClick={() => nudge(10)} title="Forward 10 seconds (L)">
              <RotateCw size={16} />
            </button>
            <div className="video-volume">
              <button className="icon-btn" onClick={toggleMute} title="Mute (M)">
                {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume" />
            </div>
            <span className="video-time" data-video-time>
              {formatTime(shown)}
              {duration ? ` / ${formatTime(duration)}` : ''}
            </span>
            <span className="video-buttons-gap" />

            {subsLoading && <Loader2 size={14} className="spin" />}
            <div className="video-menu-wrap">
              <button
                className={`icon-btn ${subtitles && subtitles.kind !== 'off' ? 'on' : ''}`}
                onClick={() => setMenu(menu === 'subtitles' ? null : 'subtitles')}
                title="Subtitles (C)"
                data-video-subtitles
              >
                <Captions size={17} />
              </button>
              {menu === 'subtitles' && (
                <div className="video-menu" data-video-subtitles-menu>
                  <div className="video-menu-title">Subtitles</div>
                  <MenuItem on={!subtitles || subtitles.kind === 'off'} onClick={() => setSubtitles({ kind: 'off' })}>
                    Off
                  </MenuItem>
                  {subFiles.map((f) => (
                    <MenuItem key={f} on={!!subtitles && sameChoice(subtitles, { kind: 'file', path: f })} onClick={() => setSubtitles({ kind: 'file', path: f })}>
                      {fileName(f)}
                    </MenuItem>
                  ))}
                  {ownSubs.map((s, i) => (
                    <MenuItem
                      key={s.stream}
                      on={!!subtitles && sameChoice(subtitles, { kind: 'stream', stream: s.stream })}
                      disabled={!s.text}
                      title={s.text ? undefined : 'These are pictures (from a Blu-ray or DVD), which can’t be shown yet'}
                      onClick={() => setSubtitles({ kind: 'stream', stream: s.stream })}
                    >
                      {trackLabel(s, i)}
                      {s.text ? '' : ' (pictures)'}
                    </MenuItem>
                  ))}
                  <button className="video-menu-item" onClick={() => void pickSubtitles()}>
                    <span className="video-menu-check" />
                    Load a subtitle file…
                  </button>
                  {subtitles && subtitles.kind !== 'off' && (
                    <div className="video-menu-delay">
                      <span>Timing</span>
                      <button className="btn" onClick={() => setDelay((d) => Math.round((d - 0.25) * 100) / 100)} title="Show subtitles sooner">
                        −
                      </button>
                      <span className="video-delay-value">{delay === 0 ? 'On time' : `${delay > 0 ? '+' : ''}${delay.toFixed(2)}s`}</span>
                      <button className="btn" onClick={() => setDelay((d) => Math.round((d + 0.25) * 100) / 100)} title="Show subtitles later">
                        +
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {audioTracks.length > 1 && (
              <div className="video-menu-wrap">
                <button className="icon-btn" onClick={() => setMenu(menu === 'audio' ? null : 'audio')} title="Sound track" data-video-audio>
                  <AudioLines size={17} />
                </button>
                {menu === 'audio' && (
                  <div className="video-menu">
                    <div className="video-menu-title">Sound</div>
                    {audioTracks.map((a, i) => (
                      <MenuItem
                        key={a.stream}
                        on={audio === i}
                        onClick={() => {
                          setMenu(null)
                          if (i === audio) return
                          setStreamStart(timeRef.current)
                          setAudio(i)
                        }}
                      >
                        {trackLabel(a, i)}
                      </MenuItem>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="video-menu-wrap">
              <button className={`icon-btn video-speed ${speed !== 1 ? 'on' : ''}`} onClick={() => setMenu(menu === 'speed' ? null : 'speed')} title="Speed ([ and ])" data-video-speed>
                {speed === 1 ? <Gauge size={17} /> : `${speed}×`}
              </button>
              {menu === 'speed' && (
                <div className="video-menu">
                  <div className="video-menu-title">Speed</div>
                  {SPEEDS.map((s) => (
                    <MenuItem key={s} on={speed === s} onClick={() => (setSpeed(s), setMenu(null))}>
                      {s === 1 ? 'Normal' : `${s}×`}
                    </MenuItem>
                  ))}
                </div>
              )}
            </div>

            {document.pictureInPictureEnabled && (
              <button
                className="icon-btn"
                title="Picture in picture"
                onClick={() => {
                  const v = video.current
                  if (!v) return
                  if (document.pictureInPictureElement) void document.exitPictureInPicture()
                  else void v.requestPictureInPicture().catch(() => undefined)
                }}
              >
                <PictureInPicture2 size={16} />
              </button>
            )}
            {IN_VIDEO_WINDOW ? (
              <button className="icon-btn" onClick={popIn} title="Back into Orbit (O)" data-video-pop-in>
                <SquareArrowDownLeft size={16} />
              </button>
            ) : (
              <button className="icon-btn" onClick={() => void popOut()} title="Pop out: its own window, which can go full screen while you use Orbit (O)" data-video-pop-out>
                <SquareArrowOutUpRight size={16} />
              </button>
            )}
            <button className="icon-btn" onClick={toggleFullscreen} title="Full screen (F)">
              {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function MenuItem({ on, disabled, title, onClick, children }: { on: boolean; disabled?: boolean; title?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`video-menu-item ${on ? 'on' : ''}`} disabled={disabled} title={title} onClick={onClick}>
      <span className="video-menu-check">{on ? '✓' : ''}</span>
      {children}
    </button>
  )
}
