import { create } from 'zustand'
import type { LiveService, LiveStats } from '@shared/live'
import { cleanScenes, defaultScenes, qualityById, type StudioItem, type StudioQuality, type StudioScene } from '@shared/studio'
import {
  cleanMicSettings,
  cleanPresets,
  cleanTrim,
  DEFAULT_MIC,
  DEFAULT_TRIM,
  matchesPreset,
  presetName,
  resolvePresetMic,
  type MicPreset,
  type MicSettings,
  type TrimSettings
} from '@shared/studioAudio'
import { recordUndo } from '../lib/undo'
import { notify } from './notify'

/**
 * The Studio's settings and scenes (saved between visits) and what it's doing right now. The
 * capturing, drawing and recording is in lib/studio.ts.
 */

export interface StudioState {
  scenes: StudioScene[]
  activeScene: string
  selected: string | null
  quality: StudioQuality['id']
  /** Where recordings go; null = Videos/Orbit Recordings. */
  folder: string | null
  /** The microphone: '' = the default one, 'off' = none. */
  micId: string
  micGain: number
  micMuted: boolean
  /** The mic clean-up switches (the gain is micGain). */
  micClean: MicCleanup
  /** Saved mic settings ("HyperX QuadCast 2"), and the one loaded last (loaded again next time). */
  presets: MicPreset[]
  presetId: string | null
  /** Record sound only (voiceovers): no screen or webcam, an .m4a file. */
  audioOnly: boolean
  /** Shortening long pauses after an audio-only recording. */
  trim: TrimSettings
  /** The last silence trim: running, finished or failed. */
  trimming: { source: string; state: 'working' | 'done' | 'error'; path?: string; message?: string; needsFfmpeg?: boolean } | null
  /** The mic is too loud right now: 'mic' = before Orbit's gain (turn the mic itself down), 'gain' = after it. */
  clipping: 'mic' | 'gain' | null
  /** How many times the mic clipped in this recording. */
  clips: number
  /** Desktop sound (everything you hear), Windows only for now. */
  desktopOn: boolean
  desktopGain: number
  desktopMuted: boolean
  recording: { startedAt: number; path: string; audioOnly: boolean } | null
  /** The last finished recording, to show in its folder. */
  lastRecording: string | null
  /** Whether that one was sound only (so it can be trimmed), how many times it clipped, and its length in seconds. */
  lastRecordingInfo: { audioOnly: boolean; clips: number; length: number } | null
  /** Problems with a source, by item id ("That window was closed."). */
  problems: Record<string, string>
  audioProblem: string | null
  /** Streaming right now. */
  live: { startedAt: number; service: LiveService } | null
  liveStats: LiveStats | null
}

export type MicCleanup = Omit<MicSettings, 'gain'>

const SCENES_KEY = 'studio.scenes'
const SETTINGS_KEY = 'studio.settings'

const cleanup = ({ noiseSuppression, echoCancellation, autoGain, lowCut }: MicSettings): MicCleanup => ({ noiseSuppression, echoCancellation, autoGain, lowCut })

function load(): Partial<StudioState> {
  try {
    const scenes = cleanScenes(JSON.parse(localStorage.getItem(SCENES_KEY) ?? 'null'))
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<StudioState>
    const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : d)
    return {
      ...(scenes ? { scenes } : {}),
      ...(typeof s.activeScene === 'string' ? { activeScene: s.activeScene } : {}),
      quality: qualityById(s.quality).id,
      folder: typeof s.folder === 'string' ? s.folder : null,
      micId: typeof s.micId === 'string' ? s.micId : '',
      micGain: num(s.micGain, 1),
      micMuted: s.micMuted === true,
      desktopOn: s.desktopOn !== false,
      desktopGain: num(s.desktopGain, 1),
      desktopMuted: s.desktopMuted === true,
      micClean: cleanup(cleanMicSettings(s.micClean)),
      presets: cleanPresets(s.presets),
      presetId: typeof s.presetId === 'string' ? s.presetId : null,
      audioOnly: s.audioOnly === true,
      trim: cleanTrim(s.trim)
    }
  } catch {
    return {}
  }
}

const initialScenes = defaultScenes()
const saved = load()
const scenes = saved.scenes ?? initialScenes

export const useStudio = create<StudioState>(() => ({
  quality: '1080p30',
  folder: null,
  micId: '',
  micGain: 1,
  micMuted: false,
  desktopOn: true,
  desktopGain: 1,
  desktopMuted: false,
  micClean: cleanup(DEFAULT_MIC),
  presets: [],
  presetId: null,
  audioOnly: false,
  trim: DEFAULT_TRIM,
  ...saved,
  scenes,
  activeScene: scenes.some((s) => s.id === saved.activeScene) ? saved.activeScene! : scenes[0].id,
  selected: null,
  recording: null,
  lastRecording: null,
  lastRecordingInfo: null,
  trimming: null,
  clipping: null,
  clips: 0,
  problems: {},
  audioProblem: null,
  live: null,
  liveStats: null
}))

let saveTimer: ReturnType<typeof setTimeout> | undefined
useStudio.subscribe((s, prev) => {
  const changed =
    s.scenes !== prev.scenes ||
    s.activeScene !== prev.activeScene ||
    s.quality !== prev.quality ||
    s.folder !== prev.folder ||
    s.micId !== prev.micId ||
    s.micGain !== prev.micGain ||
    s.micMuted !== prev.micMuted ||
    s.desktopOn !== prev.desktopOn ||
    s.desktopGain !== prev.desktopGain ||
    s.desktopMuted !== prev.desktopMuted ||
    s.micClean !== prev.micClean ||
    s.presets !== prev.presets ||
    s.presetId !== prev.presetId ||
    s.audioOnly !== prev.audioOnly ||
    s.trim !== prev.trim
  if (!changed) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(SCENES_KEY, JSON.stringify(s.scenes))
      const { activeScene, quality, folder, micId, micGain, micMuted, desktopOn, desktopGain, desktopMuted, micClean, presets, presetId, audioOnly, trim } = s
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ activeScene, quality, folder, micId, micGain, micMuted, desktopOn, desktopGain, desktopMuted, micClean, presets, presetId, audioOnly, trim })
      )
    } catch {
      // Too big (lots of large pictures): it still works, it just won't be remembered.
    }
  }, 400)
})

export const activeScene = (s: StudioState = useStudio.getState()): StudioScene => s.scenes.find((x) => x.id === s.activeScene) ?? s.scenes[0]

export function updateScene(id: string, patch: Partial<StudioScene>): void {
  useStudio.setState((s) => ({ scenes: s.scenes.map((sc) => (sc.id === id ? { ...sc, ...patch } : sc)) }))
}

export function updateItem(itemId: string, patch: Partial<StudioItem>): void {
  useStudio.setState((s) => ({
    scenes: s.scenes.map((sc) => (sc.items.some((i) => i.id === itemId) ? { ...sc, items: sc.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) } : sc))
  }))
}

export function addItem(item: StudioItem): void {
  const scene = activeScene()
  // A whole screen or window usually goes behind everything else (the webcam and text sit on it).
  updateScene(scene.id, { items: item.kind === 'screen' ? [item, ...scene.items] : [...scene.items, item] })
  useStudio.setState({ selected: item.id })
}

export function removeItem(itemId: string): void {
  useStudio.setState((s) => ({
    scenes: s.scenes.map((sc) => ({ ...sc, items: sc.items.filter((i) => i.id !== itemId) })),
    selected: s.selected === itemId ? null : s.selected
  }))
}

/** Moves a source towards the front (+1) or back (-1). */
export function reorderItem(itemId: string, by: 1 | -1): void {
  const scene = activeScene()
  const i = scene.items.findIndex((x) => x.id === itemId)
  const j = i + by
  if (i < 0 || j < 0 || j >= scene.items.length) return
  const items = scene.items.slice()
  ;[items[i], items[j]] = [items[j], items[i]]
  updateScene(scene.id, { items })
}

export function switchScene(id: string): void {
  if (useStudio.getState().scenes.some((s) => s.id === id)) useStudio.setState({ activeScene: id, selected: null })
}

// ---------- mic presets and sound settings (every change can be undone with Ctrl+Z) ----------

type MicState = Pick<StudioState, 'micId' | 'micGain' | 'micClean' | 'presets' | 'presetId'>
const micState = (s: StudioState = useStudio.getState()): MicState => ({ micId: s.micId, micGain: s.micGain, micClean: s.micClean, presets: s.presets, presetId: s.presetId })

/** Changes the mic settings as one undoable step. `mergeKey` joins a slider drag into one step. */
function changeMic(label: string, patch: Partial<MicState>, mergeKey?: string): void {
  const before = micState()
  useStudio.setState(patch)
  const after = micState()
  recordUndo({ label, mergeKey, undo: () => useStudio.setState(before), redo: () => useStudio.setState(after) })
}

export const currentMicSettings = (s: StudioState = useStudio.getState()): MicSettings => ({ gain: s.micGain, ...s.micClean })

/** The preset the settings in use match exactly, if any. */
export function activePreset(s: StudioState = useStudio.getState()): MicPreset | null {
  const p = s.presets.find((x) => x.id === s.presetId)
  return p && matchesPreset(p, s.micId, currentMicSettings(s)) ? p : null
}

export function setMicGain(gain: number): void {
  changeMic('Changed the mic volume', { micGain: Math.min(2, Math.max(0, gain)) }, 'studio.micGain')
}

const CLEAN_LABELS: Record<keyof MicCleanup, string> = {
  noiseSuppression: 'background noise removal',
  echoCancellation: 'echo removal',
  autoGain: 'automatic mic volume',
  lowCut: 'the low rumble cut'
}

export function setMicClean(key: keyof MicCleanup, on: boolean): void {
  changeMic(`Turned ${on ? 'on' : 'off'} ${CLEAN_LABELS[key]}`, { micClean: { ...useStudio.getState().micClean, [key]: on } })
}

export function setMic(micId: string): void {
  changeMic('Changed the microphone', { micId })
}

/** Saves the settings in use as a new preset named after the mic (or `name`). Returns it. */
export function savePreset(micLabel: string, name?: string): MicPreset {
  const s = useStudio.getState()
  const preset: MicPreset = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: (name ?? '').trim() || presetName(micLabel, s.presets.map((p) => p.name)),
    micId: s.micId,
    micLabel,
    ...currentMicSettings(s)
  }
  changeMic(`Saved the mic preset “${preset.name}”`, { presets: [...s.presets, preset], presetId: preset.id })
  return preset
}

/** Puts the settings in use into a preset (after tweaking it). */
export function updatePreset(id: string, micLabel: string): void {
  const s = useStudio.getState()
  const p = s.presets.find((x) => x.id === id)
  if (!p) return
  const next: MicPreset = { ...p, micId: s.micId, micLabel: micLabel || p.micLabel, ...currentMicSettings(s) }
  changeMic(`Updated the mic preset “${p.name}”`, { presets: s.presets.map((x) => (x.id === id ? next : x)), presetId: id })
}

export function renamePreset(id: string, name: string): void {
  const s = useStudio.getState()
  const p = s.presets.find((x) => x.id === id)
  const clean = name.trim().slice(0, 60)
  if (!p || !clean || clean === p.name) return
  changeMic(`Renamed the mic preset to “${clean}”`, { presets: s.presets.map((x) => (x.id === id ? { ...x, name: clean } : x)) })
}

export function deletePreset(id: string): void {
  const s = useStudio.getState()
  const p = s.presets.find((x) => x.id === id)
  if (!p) return
  changeMic(`Deleted the mic preset “${p.name}”`, { presets: s.presets.filter((x) => x.id !== id), presetId: s.presetId === id ? null : s.presetId })
}

/**
 * Loads a preset: its mic (found by name if its id changed) and its settings. `devices` is the
 * list of mics plugged in; says so if the preset's mic isn't one of them.
 */
export function loadPreset(id: string, devices: { deviceId: string; label: string }[]): void {
  const all = useStudio.getState().presets
  const p = all.find((x) => x.id === id)
  if (!p) return
  const mic = resolvePresetMic(p, devices)
  if (mic.missing) notify(`“${p.micLabel || p.name}” isn’t plugged in, so the default mic is used with this preset’s settings.`, 'info')
  // Keep the preset pointing at the mic's id today, so it's found straight away next time.
  const presets = mic.missing || mic.micId === p.micId ? all : all.map((x) => (x.id === id ? { ...x, micId: mic.micId } : x))
  changeMic(`Loaded the mic preset “${p.name}”`, { presets, presetId: id, micId: mic.micId, micGain: p.gain, micClean: cleanup(p) })
}

/** The mics plugged in, for presets (empty until the mic permission is given). */
export async function micDevices(): Promise<{ deviceId: string; label: string }[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    return all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => ({ deviceId: d.deviceId, label: d.label }))
  } catch {
    return []
  }
}

/** Loads the next preset in the list (Ctrl+K). */
export async function nextPreset(): Promise<void> {
  const s = useStudio.getState()
  if (!s.presets.length) return notify('Save a mic preset in the Studio first (Sound → Save as a preset).', 'info')
  const i = s.presets.findIndex((p) => p.id === s.presetId)
  const p = s.presets[(i + 1) % s.presets.length]
  loadPreset(p.id, await micDevices())
  notify(`Mic preset: ${p.name}`, 'info')
}

export function setAudioOnly(on: boolean): void {
  const s = useStudio.getState()
  if (s.recording || s.live) return notify('Stop recording first, then switch.', 'info')
  if (s.audioOnly === on) return
  useStudio.setState({ audioOnly: on })
  recordUndo({
    label: on ? 'Turned on audio-only recording' : 'Turned off audio-only recording',
    undo: () => useStudio.setState({ audioOnly: !on }),
    redo: () => useStudio.setState({ audioOnly: on })
  })
}

export function setTrim(patch: Partial<TrimSettings>): void {
  const before = useStudio.getState().trim
  const after = cleanTrim({ ...before, ...patch })
  useStudio.setState({ trim: after })
  recordUndo({ label: 'Changed the silence trimming', mergeKey: 'studio.trim', undo: () => useStudio.setState({ trim: before }), redo: () => useStudio.setState({ trim: after }) })
}
