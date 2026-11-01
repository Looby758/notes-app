import { IS_MAC } from '@shared/platform'
import { CLIP_RATE } from '@shared/songId'

/**
 * Records a few seconds of sound for "What's this song?": everything the computer is playing
 * (Windows can record that, like the Studio's desktop sound), or the microphone (a Mac can't
 * record its own sound without extra software, so it listens through the mic instead).
 */

export type ListenSource = 'desktop' | 'mic'

/** Whether this computer can record its own sound. */
export const desktopListenSupported = !IS_MAC

async function openStream(source: ListenSource): Promise<MediaStream> {
  if (source === 'mic') {
    await window.api.micAccess()
    // No echo cancelling or noise removal: they'd take the music out, which is the bit we want.
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true }, video: false })
  }
  // Windows records everything you hear alongside a screen; the picture part is thrown away.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop' } },
    video: { mandatory: { chromeMediaSource: 'desktop', maxWidth: 16, maxHeight: 16, maxFrameRate: 1 } }
  } as unknown as MediaStreamConstraints)
  stream.getVideoTracks().forEach((t) => {
    t.stop()
    stream.removeTrack(t)
  })
  return stream
}

/** Mixes down to mono at CLIP_RATE. */
async function toClip(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    const length = Math.max(1, Math.ceil(decoded.duration * CLIP_RATE))
    const offline = new OfflineAudioContext(1, length, CLIP_RATE)
    const src = offline.createBufferSource()
    src.buffer = decoded
    src.connect(offline.destination)
    src.start()
    return (await offline.startRendering()).getChannelData(0)
  } finally {
    void ctx.close()
  }
}

/**
 * Listens for `seconds` and gives back the clip (mono, CLIP_RATE). `level` is called about 20
 * times a second with how loud it is (0–1), for the listening animation. Aborting stops early and
 * throws an AbortError.
 */
export async function listen(source: ListenSource, seconds: number, opts: { signal?: AbortSignal; level?: (v: number) => void } = {}): Promise<Float32Array> {
  const stream = await openStream(source)
  const meterCtx = new AudioContext()
  let meterTimer: ReturnType<typeof setInterval> | undefined
  try {
    if (!stream.getAudioTracks().length) throw new Error(source === 'mic' ? 'No microphone was found.' : 'Windows didn’t share the computer’s sound.')
    if (opts.level) {
      const analyser = meterCtx.createAnalyser()
      analyser.fftSize = 512
      meterCtx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      meterTimer = setInterval(() => {
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += v * v
        opts.level!(Math.min(1, Math.sqrt(sum / buf.length) * 4))
      }, 50)
    }
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128_000 })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()))
    let aborted = false
    const stop = (): void => {
      if (recorder.state !== 'inactive') recorder.stop()
    }
    const onAbort = (): void => {
      aborted = true
      stop()
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    recorder.start()
    const timer = setTimeout(stop, seconds * 1000)
    await done
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
    if (aborted) throw new DOMException('Stopped', 'AbortError')
    return await toClip(new Blob(chunks, { type: recorder.mimeType }))
  } finally {
    clearInterval(meterTimer)
    stream.getTracks().forEach((t) => t.stop())
    void meterCtx.close()
  }
}
