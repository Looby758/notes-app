import { encodeWav, toInt16 } from './wav'

export type AudioFormat = 'mp3' | 'wav'

/** MP3s are made at this quality: good for music, and a minute is about 1.4 MB. */
const MP3_KBPS = 192
const SAMPLE_RATE = 44100

/** The sound in a file, as one or two channels (more are mixed down to two). */
async function decode(file: File): Promise<Float32Array[]> {
  const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE)
  let audio: AudioBuffer
  try {
    audio = await ctx.decodeAudioData(await file.arrayBuffer())
  } catch {
    throw new Error('This sound file couldn’t be read. It may be damaged, or in a kind this computer can’t play.')
  }
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i))
  if (channels.length <= 2) return channels
  const left = new Float32Array(audio.length)
  const right = new Float32Array(audio.length)
  channels.forEach((ch, c) => {
    const into = c % 2 === 0 ? left : right
    for (let i = 0; i < ch.length; i++) into[i] += ch[i] / Math.ceil(channels.length / 2)
  })
  return [left, right]
}

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function toMp3(channels: Float32Array[], onProgress?: (done: number) => void): Promise<Uint8Array> {
  const { Mp3Encoder } = await import('@breezystack/lamejs')
  const encoder = new Mp3Encoder(channels.length, SAMPLE_RATE, MP3_KBPS)
  const frames = channels[0].length
  const parts: Uint8Array[] = []
  const block = 1152 * 20
  for (let at = 0, n = 0; at < frames; at += block, n++) {
    const pcm = channels.map((ch) => {
      const part = ch.subarray(at, at + block)
      const out = new Int16Array(part.length)
      for (let i = 0; i < part.length; i++) out[i] = toInt16(part[i])
      return out
    })
    parts.push(encoder.encodeBuffer(pcm[0], pcm[1]))
    // Lets the window keep responding during long recordings.
    if (n % 20 === 19) {
      onProgress?.(at / frames)
      await pause()
    }
  }
  parts.push(encoder.flush())
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** Converts a sound file (anything this computer can play) to MP3 or WAV. */
export async function convertAudio(file: File, format: AudioFormat, onProgress?: (done: number) => void): Promise<Uint8Array> {
  const channels = await decode(file)
  if (!channels.length || !channels[0].length) throw new Error('This sound file is empty.')
  return format === 'wav' ? encodeWav(channels, SAMPLE_RATE) : toMp3(channels, onProgress)
}
