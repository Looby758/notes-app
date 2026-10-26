import { formatDate } from './dates'

/**
 * Voice notes: record from the microphone and save the recording (.webm) into the attachments
 * folder, to be played back in the note.
 */

export interface Recording {
  /** 0–1, how loud it is right now (for the level meter). */
  level(): number
  /** Stops and gives back the audio. */
  stop(): Promise<Blob>
  /** Stops and throws the audio away. */
  cancel(): void
  startedAt: number
}

export const AUDIO_EXT = /\.(webm|mp3|m4a|wav|ogg|oga|aac)$/i

export async function startRecording(): Promise<Recording> {
  if (!(await window.api.micAccess())) {
    throw new Error('Notes isn’t allowed to use the microphone. Turn it on in System Settings → Privacy & Security → Microphone.')
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  } catch (err) {
    const name = (err as DOMException).name
    if (name === 'NotFoundError') throw new Error('No microphone was found.')
    if (name === 'NotAllowedError') throw new Error('The microphone is blocked. Check your system’s privacy settings for microphones.')
    throw err
  }
  const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
  const recorder = new MediaRecorder(stream, { mimeType: type })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  recorder.start(250)

  // Level meter.
  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  ctx.createMediaStreamSource(stream).connect(analyser)
  const buf = new Uint8Array(analyser.fftSize)

  let finished = false
  const finish = (): void => {
    if (finished) return
    finished = true
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => undefined)
  }

  return {
    startedAt: Date.now(),
    level() {
      analyser.getByteTimeDomainData(buf)
      let peak = 0
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128))
      return Math.min(1, peak / 90)
    },
    stop() {
      return new Promise((resolve) => {
        recorder.onstop = () => {
          finish()
          resolve(new Blob(chunks, { type: 'audio/webm' }))
        }
        recorder.stop()
      })
    },
    cancel() {
      recorder.onstop = finish
      if (recorder.state !== 'inactive') recorder.stop()
      else finish()
    }
  }
}

/** Saves a recording into `folder`; returns its path in the notes folder. */
export async function saveRecording(blob: Blob, folder: string): Promise<string> {
  const name = `Voice note ${formatDate(new Date(), 'YYYY-MM-DD HH-mm-ss')}.webm`
  return window.api.saveAttachment(folder, name, new Uint8Array(await blob.arrayBuffer()))
}

export const formatDuration = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
