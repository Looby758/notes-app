import { create } from 'zustand'
import { AUDIO_EDITOR_TAB, openSpecialTab } from '../lib/editorController'
import { decodeAudio, SAMPLE_RATE, type AudioFormat } from '../lib/convert/audio'
import { fixSelection, type Selection, type TrimMode } from '../lib/audioTrim'

/**
 * The sound open in the audio editor (components/AudioEditor) and how it's being trimmed. It lives
 * here rather than in the page so switching tabs and back doesn't lose it.
 */

export interface OpenAudio {
  name: string
  /** The sound, one or two channels at SAMPLE_RATE. */
  channels: Float32Array[]
  sampleRate: number
  duration: number
}

interface AudioEditorState {
  audio: OpenAudio | null
  /** Reading a file: its name. */
  loading: string | null
  error: string | null
  sel: Selection
  mode: TrimMode
  fadeIn: number
  fadeOut: number
  format: AudioFormat
}

export const useAudioEditor = create<AudioEditorState>(() => ({
  audio: null,
  loading: null,
  error: null,
  sel: { start: 0, end: 0 },
  mode: 'keep',
  fadeIn: 0,
  fadeOut: 0,
  format: 'mp3'
}))

/** Reads a sound file into the editor, replacing what was open. */
export async function openAudio(name: string, data: Blob | ArrayBuffer): Promise<void> {
  useAudioEditor.setState({ loading: name, error: null })
  try {
    const channels = await decodeAudio(data)
    const duration = (channels[0]?.length ?? 0) / SAMPLE_RATE
    if (!duration) throw new Error('This sound file is empty.')
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
    useAudioEditor.setState({
      audio: { name, channels, sampleRate: SAMPLE_RATE, duration },
      loading: null,
      sel: { start: 0, end: duration },
      mode: 'keep',
      fadeIn: 0,
      fadeOut: 0,
      // A WAV stays a WAV; everything else is saved as an MP3 unless you pick otherwise.
      format: ext === 'wav' ? 'wav' : 'mp3'
    })
  } catch (err) {
    useAudioEditor.setState({ loading: null, error: err instanceof Error ? err.message : String(err) })
  }
}

/** Opens a sound file from the notes folder or the computer (by its vault:// address) in the audio editor. */
export async function openInAudioEditor(name: string, url: string): Promise<void> {
  openSpecialTab(AUDIO_EDITOR_TAB)
  useAudioEditor.setState({ loading: name, error: null })
  const res = await fetch(url, { cache: 'no-store' }).catch(() => null)
  if (!res?.ok) {
    useAudioEditor.setState({ loading: null, error: `“${name}” couldn’t be read.` })
    return
  }
  await openAudio(name, await res.arrayBuffer())
}

export function setSelection(sel: Selection): void {
  const audio = useAudioEditor.getState().audio
  if (audio) useAudioEditor.setState({ sel: fixSelection(sel, audio.duration) })
}

export const closeAudio = (): void => useAudioEditor.setState({ audio: null, error: null, loading: null })
