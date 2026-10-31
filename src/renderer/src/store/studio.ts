import { create } from 'zustand'
import type { LiveService, LiveStats } from '@shared/live'
import { cleanScenes, defaultScenes, qualityById, type StudioItem, type StudioQuality, type StudioScene } from '@shared/studio'

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
  /** Desktop sound (everything you hear), Windows only for now. */
  desktopOn: boolean
  desktopGain: number
  desktopMuted: boolean
  recording: { startedAt: number; path: string } | null
  /** The last finished recording, to show in its folder. */
  lastRecording: string | null
  /** Problems with a source, by item id ("That window was closed."). */
  problems: Record<string, string>
  audioProblem: string | null
  /** Streaming right now. */
  live: { startedAt: number; service: LiveService } | null
  liveStats: LiveStats | null
}

const SCENES_KEY = 'studio.scenes'
const SETTINGS_KEY = 'studio.settings'

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
      desktopMuted: s.desktopMuted === true
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
  ...saved,
  scenes,
  activeScene: scenes.some((s) => s.id === saved.activeScene) ? saved.activeScene! : scenes[0].id,
  selected: null,
  recording: null,
  lastRecording: null,
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
    s.desktopMuted !== prev.desktopMuted
  if (!changed) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(SCENES_KEY, JSON.stringify(s.scenes))
      const { activeScene, quality, folder, micId, micGain, micMuted, desktopOn, desktopGain, desktopMuted } = s
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ activeScene, quality, folder, micId, micGain, micMuted, desktopOn, desktopGain, desktopMuted }))
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
