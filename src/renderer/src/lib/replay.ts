import { create } from 'zustand'
import { SEGMENT_MS, segmentsLength, segmentsToKeep } from '@shared/clips'
import { pickRecordingType, qualityById } from '@shared/studio'
import { IS_MAC } from '@shared/platform'
import type { Prefs } from '@shared/prefs'
import { usePrefs } from '../store/prefs'
import { useStudio } from '../store/studio'
import { notify } from '../store/notify'
import { errorMessage } from './paths'
import { CLIPS_TAB, openSpecialTab } from './editorController'

/**
 * Instant replay: while it's on, the main screen (and what you hear, and your mic if you like) is
 * recorded all the time, in pieces of a few seconds, and only the newest pieces are kept. The
 * shortcut (Alt+Shift+R by default, from any app or game) joins the last 30 seconds into a video
 * in the Studio's recordings folder. Nothing is saved until you press it.
 *
 * Each piece is its own little video starting on a keyframe, so main/clips.ts can join them with
 * ffmpeg without re-encoding: saving takes a moment, even mid-game. The pieces are kept in memory
 * (about 50 MB for 30 seconds at 1080p60).
 */

export interface ReplayState {
  /** Recording into the buffer right now. */
  running: boolean
  starting: boolean
  saving: boolean
  /** Why it isn't running when it should be. */
  problem: string | null
  /** Waiting for the video add-on (ffmpeg) to be downloaded. */
  needsFfmpeg: boolean
  /** The last saved replay's path. */
  lastSaved: string | null
  /** Bumped whenever a replay or clip is saved, so the clip list refreshes. */
  version: number
  /** A clip to open in the clip editor (from the "Replay saved" notification). */
  request: string | null
}

export const useReplay = create<ReplayState>(() => ({
  running: false,
  starting: false,
  saving: false,
  problem: null,
  needsFfmpeg: false,
  lastSaved: null,
  version: 0,
  request: null
}))

interface Piece {
  blob: Blob
  start: number
  end: number
}

interface Current {
  rec: MediaRecorder
  stopped: Promise<void>
}

let stream: MediaStream | null = null
let extraStreams: MediaStream[] = []
let audio: AudioContext | null = null
let current: Current | null = null
let pieces: Piece[] = []
let timer: ReturnType<typeof setInterval> | undefined
let type: { mime: string; ext: 'mp4' | 'webm' } | null = null
let runId = 0

const prefs = (): Prefs => usePrefs.getState().prefs

function newRecorder(): Current {
  const s = stream!
  const q = qualityById(prefs().replayQuality)
  const rec = new MediaRecorder(s, { mimeType: type!.mime, videoBitsPerSecond: q.bitrate, audioBitsPerSecond: 160_000 })
  const chunks: Blob[] = []
  const start = Date.now()
  const mime = type!.mime
  const stopped = new Promise<void>((resolve) => {
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      if (chunks.length && rec.stream === stream) {
        pieces.push({ blob: new Blob(chunks, { type: mime }), start, end: Date.now() })
        pieces = segmentsToKeep(pieces, prefs().replaySeconds)
      }
      resolve()
    }
    rec.onerror = () => resolve()
  })
  rec.start()
  return { rec, stopped }
}

/** Starts the next piece, then finishes the one before (so nothing is missed between them). */
function rotate(): Promise<void> {
  if (!stream) return Promise.resolve()
  const old = current
  try {
    current = newRecorder()
  } catch (err) {
    stopBuffer(`Instant replay stopped: ${errorMessage(err)}`)
    return Promise.resolve()
  }
  if (!old) return Promise.resolve()
  if (old.rec.state !== 'inactive') old.rec.stop()
  return old.stopped
}

async function openStreams(): Promise<MediaStream> {
  const p = prefs()
  const q = qualityById(p.replayQuality)
  if (!(await window.api.studioAccess('screen'))) throw new Error('Orbit isn’t allowed to record the screen. Turn it on in System Settings → Privacy & Security → Screen Recording.')
  const screenId = await window.api.replayScreen()
  if (!screenId) throw new Error('No screen to record was found.')
  const video = { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: screenId, maxWidth: q.width, maxHeight: q.height, maxFrameRate: q.fps } }
  // Windows records everything you hear along with a screen; a Mac can't.
  const wantSound = p.replaySound && !IS_MAC
  let screen: MediaStream
  try {
    screen = await navigator.mediaDevices.getUserMedia({ audio: wantSound ? { mandatory: { chromeMediaSource: 'desktop' } } : false, video } as unknown as MediaStreamConstraints)
  } catch (err) {
    if (!wantSound) throw err
    // Some computers have no sound device to listen to: keep the picture at least.
    screen = await navigator.mediaDevices.getUserMedia({ audio: false, video } as unknown as MediaStreamConstraints)
  }
  const sounds: MediaStream[] = screen.getAudioTracks().length ? [new MediaStream(screen.getAudioTracks())] : []
  if (p.replayMic) {
    try {
      await window.api.micAccess()
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
      extraStreams.push(mic)
      sounds.push(mic)
    } catch {
      notify('Instant replay couldn’t use your microphone, so it’s recording without it.')
    }
  }
  const out = new MediaStream(screen.getVideoTracks())
  extraStreams.push(screen)
  if (sounds.length === 1) {
    sounds[0].getAudioTracks().forEach((t) => out.addTrack(t))
  } else if (sounds.length > 1) {
    // Desktop sound and the mic mixed into one track.
    audio = new AudioContext()
    const mix = audio.createMediaStreamDestination()
    for (const s of sounds) audio.createMediaStreamSource(s).connect(mix)
    mix.stream.getAudioTracks().forEach((t) => out.addTrack(t))
  }
  return out
}

async function startBuffer(): Promise<void> {
  const st = useReplay.getState()
  if (st.running || st.starting) return
  const id = ++runId
  useReplay.setState({ starting: true, problem: null, needsFfmpeg: false })
  try {
    const ffmpeg = await window.api.videoConverterStatus()
    if (ffmpeg.state !== 'ready') {
      useReplay.setState({ starting: false, needsFfmpeg: ffmpeg.state !== 'unsupported', problem: ffmpeg.state === 'unsupported' ? 'Instant replay isn’t available on this kind of computer yet.' : null })
      return
    }
    type = pickRecordingType((m) => MediaRecorder.isTypeSupported(m))
    if (!type) throw new Error('This computer can’t record video.')
    const s = await openStreams()
    if (id !== runId || !prefs().replayOn) {
      s.getTracks().forEach((t) => t.stop())
      closeExtras()
      return
    }
    stream = s
    pieces = []
    s.getVideoTracks()[0]?.addEventListener('ended', () => stream === s && stopBuffer('The screen being recorded went away. Turn instant replay off and on again.'))
    await window.api.replayRunning(true)
    current = newRecorder()
    timer = setInterval(() => void rotate(), SEGMENT_MS)
    useReplay.setState({ running: true, starting: false })
  } catch (err) {
    closeExtras()
    if (id === runId) useReplay.setState({ starting: false, problem: `Instant replay couldn’t start: ${errorMessage(err)}` })
  }
}

function closeExtras(): void {
  for (const s of extraStreams) s.getTracks().forEach((t) => t.stop())
  extraStreams = []
  void audio?.close()
  audio = null
}

function stopBuffer(problem: string | null = null): void {
  runId++
  clearInterval(timer)
  timer = undefined
  const rec = current?.rec
  current = null
  const s = stream
  stream = null
  // Stopped after `stream` is cleared, so its last piece is thrown away rather than kept.
  if (rec && rec.state !== 'inactive') rec.stop()
  s?.getTracks().forEach((t) => t.stop())
  closeExtras()
  pieces = []
  void window.api.replayRunning(false)
  useReplay.setState({ running: false, starting: false, problem })
}

/** Saves the last few seconds (the shortcut, the button in Clips, or the phone deck). */
export async function saveReplay(): Promise<void> {
  const st = useReplay.getState()
  if (!st.running) {
    notify(prefs().replayOn ? 'Instant replay is still starting.' : 'Instant replay is off. Turn it on in Clips or Settings → Studio.')
    return
  }
  if (st.saving) return
  useReplay.setState({ saving: true })
  try {
    // Finish the piece being recorded, so the replay runs right up to now.
    await rotate()
    const seconds = prefs().replaySeconds
    const use = segmentsToKeep(pieces, seconds)
    if (!use.length) throw new Error('There’s nothing recorded yet. Give it a few seconds.')
    const parts = await Promise.all(use.map(async (p) => new Uint8Array(await p.blob.arrayBuffer())))
    const path = await window.api.replaySave(useStudio.getState().folder, parts, type!.ext, Math.min(seconds, Math.round(segmentsLength(use))))
    useReplay.setState((s) => ({ lastSaved: path, version: s.version + 1 }))
    notify(`Saved the last ${seconds} seconds: ${path.split(/[\\/]/).pop()}`, 'info')
  } catch (err) {
    notify(`Couldn’t save the replay: ${errorMessage(err)}`)
  } finally {
    useReplay.setState({ saving: false })
  }
}

/** A clip was made or removed: the clip list should look again. */
export const clipsChanged = (): void => useReplay.setState((s) => ({ version: s.version + 1 }))

/** Turns the buffer on and off with Settings, and listens for the shortcut. Main window only. */
export function watchReplay(): () => void {
  const sync = (): void => {
    if (prefs().replayOn) void startBuffer()
    else if (useReplay.getState().running || useReplay.getState().starting) stopBuffer()
    else useReplay.setState({ needsFfmpeg: false, problem: null })
  }
  sync()
  const offPrefs = usePrefs.subscribe((s, prev) => {
    const a = s.prefs
    const b = prev.prefs
    if (a.replayOn !== b.replayOn) sync()
    else if (a.replayOn && (a.replayQuality !== b.replayQuality || a.replaySound !== b.replaySound || a.replayMic !== b.replayMic)) {
      // Different quality or sound: start again with the new settings.
      stopBuffer()
      void startBuffer()
    }
  })
  // Once the video add-on is downloaded, a replay that was waiting for it starts.
  const offFfmpeg = window.api.onVideoConverterStatus((state) => {
    if (state.state === 'ready' && prefs().replayOn && !useReplay.getState().running) void startBuffer()
  })
  const offSave = window.api.onReplaySave(() => void saveReplay())
  const offOpen = window.api.onClipsOpen((path) => {
    useReplay.setState({ request: path })
    openSpecialTab(CLIPS_TAB)
  })
  return () => {
    offPrefs()
    offFfmpeg()
    offSave()
    offOpen()
    stopBuffer()
  }
}
