import { create } from 'zustand'
import { SEGMENT_MS, segmentsLength, segmentsToKeep } from '@shared/clips'
import { IS_MAC } from '@shared/platform'
import { useStudio } from '../store/studio'
import { errorMessage } from './paths'

/**
 * The Discord voice pop-out's sound: your mic level (so you can see you're coming through), and
 * the call clip, which works like instant replay (lib/replay.ts): while you're in a call, the
 * call's sound is recorded in pieces of a few seconds and only the newest are kept, in memory.
 * The clip button joins the last 30 seconds into a file in the recordings folder (through the same
 * main/clips.ts join, without re-encoding). Nothing is saved until you press it.
 *
 * The call's sound is everything you hear (Windows records that along with a screen; a Mac can't,
 * so there it's only your mic) mixed with your mic.
 */

export const CALL_CLIP_SECONDS = 30
const MIME = 'audio/webm;codecs=opus'

export interface CallAudioState {
  /** The mic is open for the level meter. */
  micOn: boolean
  micProblem: string | null
  /** The clip buffer is recording. */
  buffering: boolean
  /** Seconds in the buffer so far (up to 30). */
  buffered: number
  saving: boolean
  clipProblem: string | null
  /** The video add-on (ffmpeg) is needed to join the pieces. */
  needsFfmpeg: boolean
  lastSaved: string | null
}

export const useCallAudio = create<CallAudioState>(() => ({
  micOn: false,
  micProblem: null,
  buffering: false,
  buffered: 0,
  saving: false,
  clipProblem: null,
  needsFfmpeg: false,
  lastSaved: null
}))

// ---------------------------------------------------------------------------------------------
// The mic meter

let micStream: MediaStream | null = null
let micCtx: AudioContext | null = null
let micMeter: AnalyserNode | null = null
let micOpening: Promise<void> | null = null

export function openMic(): Promise<void> {
  if (micStream) return Promise.resolve()
  micOpening ??= (async () => {
    try {
      await window.api.micAccess()
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
      micStream = s
      micCtx = new AudioContext()
      micMeter = micCtx.createAnalyser()
      micMeter.fftSize = 512
      micCtx.createMediaStreamSource(s).connect(micMeter)
      useCallAudio.setState({ micOn: true, micProblem: null })
    } catch (err) {
      useCallAudio.setState({ micOn: false, micProblem: `Your mic couldn’t be opened: ${errorMessage(err)}` })
    } finally {
      micOpening = null
    }
  })()
  return micOpening
}

export function closeMic(): void {
  micStream?.getTracks().forEach((t) => t.stop())
  micStream = null
  void micCtx?.close()
  micCtx = null
  micMeter = null
  useCallAudio.setState({ micOn: false })
}

/** How loud your mic is right now, 0 to 1. */
export function micLevel(): number {
  if (!micMeter) return 0
  const data = new Float32Array(micMeter.fftSize)
  micMeter.getFloatTimeDomainData(data)
  let sum = 0
  for (const v of data) sum += v * v
  return Math.min(1, Math.sqrt(sum / data.length) * 4)
}

// ---------------------------------------------------------------------------------------------
// The call clip buffer

interface Piece {
  blob: Blob
  start: number
  end: number
}

let desktop: MediaStream | null = null
let mixCtx: AudioContext | null = null
let mixed: MediaStream | null = null
let recorder: { rec: MediaRecorder; stopped: Promise<void> } | null = null
let pieces: Piece[] = []
let timer: ReturnType<typeof setInterval> | undefined
let runId = 0

function newRecorder(): { rec: MediaRecorder; stopped: Promise<void> } {
  const stream = mixed!
  const rec = new MediaRecorder(stream, { mimeType: MIME, audioBitsPerSecond: 128_000 })
  const chunks: Blob[] = []
  const start = Date.now()
  const stopped = new Promise<void>((resolve) => {
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      if (chunks.length && stream === mixed) {
        pieces.push({ blob: new Blob(chunks, { type: MIME }), start, end: Date.now() })
        pieces = segmentsToKeep(pieces, CALL_CLIP_SECONDS)
        useCallAudio.setState({ buffered: Math.min(CALL_CLIP_SECONDS, Math.round(segmentsLength(pieces))) })
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
  if (!mixed) return Promise.resolve()
  const old = recorder
  try {
    recorder = newRecorder()
  } catch (err) {
    stopClipBuffer(`The call clip stopped: ${errorMessage(err)}`)
    return Promise.resolve()
  }
  if (!old) return Promise.resolve()
  if (old.rec.state !== 'inactive') old.rec.stop()
  return old.stopped
}

/** What you hear (Windows only: it comes along with a screen, whose picture isn't used). */
async function openDesktop(): Promise<MediaStream | null> {
  if (IS_MAC) return null
  const screenId = await window.api.replayScreen()
  if (!screenId) return null
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop' } },
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: screenId, maxWidth: 320, maxHeight: 180, maxFrameRate: 1 } }
    } as unknown as MediaStreamConstraints)
  } catch {
    return null
  }
}

/** Starts keeping the last 30 seconds of the call (while you're in one, with the pop-out open). */
export async function startClipBuffer(): Promise<void> {
  const st = useCallAudio.getState()
  if (st.buffering || mixed) return
  const id = ++runId
  useCallAudio.setState({ clipProblem: null, needsFfmpeg: false })
  try {
    const ffmpeg = await window.api.videoConverterStatus()
    if (ffmpeg.state !== 'ready') {
      useCallAudio.setState({
        needsFfmpeg: ffmpeg.state !== 'unsupported',
        clipProblem: ffmpeg.state === 'unsupported' ? 'Call clips aren’t available on this kind of computer yet.' : 'Call clips need the free video add-on: Settings → Studio.'
      })
      return
    }
    if (!MediaRecorder.isTypeSupported(MIME)) throw new Error('This computer can’t record sound.')
    await openMic()
    const d = await openDesktop()
    if (id !== runId) {
      d?.getTracks().forEach((t) => t.stop())
      return
    }
    if (!d && !micStream) throw new Error('There’s no sound to record: the mic couldn’t be opened.')
    desktop = d
    mixCtx = new AudioContext()
    const dest = mixCtx.createMediaStreamDestination()
    if (d?.getAudioTracks().length) mixCtx.createMediaStreamSource(new MediaStream(d.getAudioTracks())).connect(dest)
    if (micStream) mixCtx.createMediaStreamSource(micStream).connect(dest)
    mixed = dest.stream
    pieces = []
    recorder = newRecorder()
    timer = setInterval(() => void rotate(), SEGMENT_MS)
    useCallAudio.setState({
      buffering: true,
      buffered: 0,
      clipProblem: d?.getAudioTracks().length ? null : IS_MAC ? 'On a Mac only your mic can be recorded, so clips have just you in them.' : 'What you hear couldn’t be recorded, so clips have just your mic.'
    })
  } catch (err) {
    stopClipBuffer(`The call clip couldn’t start: ${errorMessage(err)}`)
  }
}

export function stopClipBuffer(problem: string | null = null): void {
  runId++
  clearInterval(timer)
  timer = undefined
  const rec = recorder?.rec
  recorder = null
  mixed = null
  // Stopped after `mixed` is cleared, so its last piece is thrown away rather than kept.
  if (rec && rec.state !== 'inactive') rec.stop()
  desktop?.getTracks().forEach((t) => t.stop())
  desktop = null
  void mixCtx?.close()
  mixCtx = null
  pieces = []
  useCallAudio.setState({ buffering: false, buffered: 0, ...(problem !== null ? { clipProblem: problem } : {}) })
}

/** The clip button: saves the last 30 seconds of the call. Returns the file's name, or throws. */
export async function saveCallClip(): Promise<string> {
  const st = useCallAudio.getState()
  if (!st.buffering) throw new Error(st.clipProblem ?? 'The call clip isn’t recording yet.')
  if (st.saving) throw new Error('Already saving one.')
  useCallAudio.setState({ saving: true })
  try {
    await rotate()
    const use = segmentsToKeep(pieces, CALL_CLIP_SECONDS)
    if (!use.length) throw new Error('There’s nothing recorded yet. Give it a few seconds.')
    const parts = await Promise.all(use.map(async (p) => new Uint8Array(await p.blob.arrayBuffer())))
    const seconds = Math.min(CALL_CLIP_SECONDS, Math.round(segmentsLength(use)))
    const path = await window.api.replaySave(useStudio.getState().folder, parts, 'webm', seconds, 'call')
    useCallAudio.setState({ lastSaved: path })
    return path.split(/[\\/]/).pop() ?? path
  } finally {
    useCallAudio.setState({ saving: false })
  }
}
