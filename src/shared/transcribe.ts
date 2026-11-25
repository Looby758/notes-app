/**
 * Auto transcripts: what was said in a recording, word by word with times, worked out on this
 * computer by Whisper (OpenAI's speech-to-text model, MIT licence) running in a hidden Orbit
 * window through Transformers.js. Nothing is part of Orbit until you ask: the model is a one-time
 * download from Hugging Face, and the sound is read out of the recording with ffmpeg (the same
 * on-demand copy the video converter uses). The sound never leaves the computer.
 *
 * This file is the plain data and maths (no Electron, no DOM), so it can be tested.
 */

/** One spoken word: its text as Whisper wrote it (with any punctuation), and where it starts and ends, in seconds. */
export interface SpokenWord {
  w: string
  s: number
  e: number
}

/** The sample rate Whisper listens at. */
export const SAMPLE_RATE = 16000

/** A model Orbit can use. Both are English-only Whisper models with word timing. */
export interface TranscribeModel {
  id: string
  name: string
  repo: string
  /** About how big the download is, in MB, for the button. */
  mb: number
  /** Which file of each part to use (full size or squashed). */
  dtype: Record<string, string>
}

export const TRANSCRIBE_MODELS: TranscribeModel[] = [
  // Fast enough on a graphics card to do a 20-minute recording in a minute or two.
  {
    id: 'small',
    name: 'Accurate',
    repo: 'onnx-community/whisper-small.en_timestamped',
    mb: 590,
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }
  },
  // For computers where it has to run on the processor.
  {
    id: 'base',
    name: 'Quick',
    repo: 'onnx-community/whisper-base.en_timestamped',
    mb: 210,
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }
  }
]

export const transcribeModelById = (id: string | undefined): TranscribeModel | undefined => TRANSCRIBE_MODELS.find((m) => m.id === id)

/** The model to use: the accurate one with a graphics card to run it on, the quick one without. */
export const suggestedTranscribeModel = (gpu: boolean): TranscribeModel => TRANSCRIBE_MODELS[gpu ? 0 : 1]

/** How Orbit's transcriber is doing (Settings and the video page show it). */
export interface TranscriberState {
  /** ready: the model is here. missing: it needs downloading first. */
  state: 'missing' | 'downloading' | 'ready'
  /** The model downloaded (or being downloaded). */
  model?: string
  /** While downloading: how far (0–1), and the size in bytes when known. */
  progress?: number
  bytes?: number
  /** Whether ffmpeg (for reading sound out of recordings) is here too. */
  ffmpeg: boolean
  /** Runs on the graphics card (WebGPU) rather than the processor; null until it's been checked. */
  gpu: boolean | null
  error?: string
}

/** How a transcript is getting on. */
export interface TranscribeProgress {
  /** The recording (a path in the notes folder). */
  path: string
  stage: 'download' | 'reading' | 'listening'
  /** 0–1. */
  progress: number
  /** Listening: how far into the recording it's got, in seconds, and how long it is. */
  at?: number
  length?: number
}

// ---------- Cutting a long recording into pieces ----------

/** Whisper is given a few minutes at a time, so a long recording shows progress and can be stopped. */
export const PIECE_SECONDS = 120
/** How far either side of a cut it looks for a quiet moment to cut at, so no word is split. */
const LOOK_SECONDS = 8
/** The window used to measure loudness, in seconds. */
const WINDOW_SECONDS = 0.1

/** The loudness (root mean square) of `samples` from `from` to `to`. */
function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0
  const end = Math.min(to, samples.length)
  for (let i = from; i < end; i++) sum += samples[i] * samples[i]
  return end > from ? Math.sqrt(sum / (end - from)) : 0
}

/**
 * Where to cut a recording into pieces of about PIECE_SECONDS: at the quietest moment near each
 * cut. Returns the start of each piece in samples (the first is always 0).
 */
export function quietCuts(samples: Float32Array, rate = SAMPLE_RATE, piece = PIECE_SECONDS): number[] {
  const cuts = [0]
  const win = Math.round(WINDOW_SECONDS * rate)
  const look = LOOK_SECONDS * rate
  for (let target = piece * rate; target < samples.length - look; target += piece * rate) {
    let best = target
    let quietest = Infinity
    for (let at = Math.max(cuts[cuts.length - 1] + rate * 10, target - look); at <= target + look; at += win) {
      const level = rms(samples, at, at + win)
      if (level < quietest) {
        quietest = level
        best = at + Math.round(win / 2)
      }
    }
    cuts.push(best)
    target = best
  }
  return cuts
}

/** Below this loudness a piece is taken to be silence (Whisper makes words up out of silence, so it isn't asked). */
export const SILENCE_RMS = 0.004

export const isSilent = (samples: Float32Array): boolean => {
  // The loudest tenth of a second decides it, so a quiet voice in a quiet piece still counts.
  const win = Math.round(WINDOW_SECONDS * SAMPLE_RATE)
  for (let at = 0; at < samples.length; at += win) if (rms(samples, at, at + win) >= SILENCE_RMS) return false
  return true
}

/** Whisper's words for one piece, as Transformers.js gives them, turned into SpokenWords from `offset` seconds. */
export function piecesWords(chunks: { text: string; timestamp: [number | null, number | null] }[], offset: number, length: number): SpokenWord[] {
  const out: SpokenWord[] = []
  for (const c of chunks) {
    const w = c.text.trim()
    if (!w) continue
    const prev = out[out.length - 1]
    const s = c.timestamp[0] ?? (prev ? prev.e - offset : 0)
    const e = c.timestamp[1] ?? Math.min(length, s + 0.3)
    out.push({
      w,
      s: round(offset + Math.max(0, s)),
      e: round(offset + Math.max(s, Math.min(length, e)))
    })
  }
  return dropRepeats(out)
}

const round = (n: number): number => Math.round(n * 100) / 100

/**
 * Whisper sometimes gets stuck and writes the same few words over and over. Five or more of the
 * same run of up to four words in a row are cut back to one.
 */
export function dropRepeats(words: SpokenWord[]): SpokenWord[] {
  const key = (w: SpokenWord): string => w.w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
  const out = words.slice()
  for (let size = 1; size <= 4; size++) {
    for (let i = 0; i + size * 5 <= out.length; i++) {
      let reps = 1
      const same = (a: number, b: number): boolean => {
        for (let k = 0; k < size; k++) if (key(out[a + k]) !== key(out[b + k])) return false
        return true
      }
      while (i + (reps + 1) * size <= out.length && same(i, i + reps * size)) reps++
      if (reps >= 5) out.splice(i + size, (reps - 1) * size)
    }
  }
  return out
}

/** "1:05", "12:40", "1:02:03". */
export function clock(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
