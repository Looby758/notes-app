import { create } from 'zustand'
import { recordUndo } from '../lib/undo'
import { cuesFile, type Cue } from '../lib/teleprompter'
import { useStudio } from './studio'
import { notify } from './notify'

/**
 * The Studio's teleprompter: which script it shows, how it looks (remembered), and whether it's
 * scrolling. The scrolling itself is in components/Studio/Teleprompter.tsx.
 */

export interface PrompterLook {
  /** Speed on top of your speaking pace (Settings → script words a minute): 1 = your pace. */
  speed: number
  /** Text size, px. */
  fontSize: number
  /** Where the reading line sits, as a fraction of the height from the top. */
  linePos: number
  /** Flip it left to right, for a teleprompter glass. */
  mirror: boolean
  /** Start scrolling (after a 3-second count) when you press Record. */
  autoStart: boolean
  /** Stop for a moment at each [PAUSE] marker. */
  holdPauses: boolean
}

export const DEFAULT_LOOK: PrompterLook = { speed: 1, fontSize: 40, linePos: 0.35, mirror: false, autoStart: true, holdPauses: true }

export const LOOK_LIMITS = { speed: [0.5, 2], fontSize: [20, 96], linePos: [0.15, 0.7] } as const

export interface PrompterState extends PrompterLook {
  open: boolean
  /** The script note (a path in your notes). */
  script: string | null
  playing: boolean
  /** 3, 2, 1 before it starts, or null. */
  countdown: number | null
  /** Asked to go back to the top (the scroller watches this). */
  restartAt: number
}

const KEY = 'studio.teleprompter'

const clampNum = (v: unknown, [lo, hi]: readonly [number, number], d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)

export function cleanLook(raw: unknown): PrompterLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<PrompterLook>
  return {
    speed: clampNum(r.speed, LOOK_LIMITS.speed, DEFAULT_LOOK.speed),
    fontSize: clampNum(r.fontSize, LOOK_LIMITS.fontSize, DEFAULT_LOOK.fontSize),
    linePos: clampNum(r.linePos, LOOK_LIMITS.linePos, DEFAULT_LOOK.linePos),
    mirror: r.mirror === true,
    autoStart: r.autoStart !== false,
    holdPauses: r.holdPauses !== false
  }
}

function load(): Partial<PrompterState> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PrompterState>
    return { ...cleanLook(raw), open: raw.open === true, script: typeof raw.script === 'string' ? raw.script : null }
  } catch {
    return {}
  }
}

export const usePrompter = create<PrompterState>(() => ({ ...DEFAULT_LOOK, open: false, script: null, ...load(), playing: false, countdown: null, restartAt: 0 }))

let saveTimer: ReturnType<typeof setTimeout> | undefined
usePrompter.subscribe((s) => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const { speed, fontSize, linePos, mirror, autoStart, holdPauses, open, script } = s
      localStorage.setItem(KEY, JSON.stringify({ speed, fontSize, linePos, mirror, autoStart, holdPauses, open, script }))
    } catch {
      // Not remembered this time; it still works.
    }
  }, 300)
})

const LOOK_LABELS: Record<keyof PrompterLook, string> = {
  speed: 'Changed the teleprompter speed',
  fontSize: 'Changed the teleprompter text size',
  linePos: 'Moved the reading line',
  mirror: 'Flipped the teleprompter',
  autoStart: 'Changed when the teleprompter starts',
  holdPauses: 'Changed stopping at pauses'
}

/** Changes how the teleprompter looks or scrolls; Ctrl+Z puts it back (a slider drag is one step). */
export function setLook<K extends keyof PrompterLook>(key: K, value: PrompterLook[K]): void {
  const before = usePrompter.getState()[key]
  const after = cleanLook({ ...pickLook(usePrompter.getState()), [key]: value })[key]
  if (before === after) return
  usePrompter.setState({ [key]: after } as Partial<PrompterState>)
  recordUndo({
    label: LOOK_LABELS[key],
    mergeKey: `prompter.${key}`,
    undo: () => usePrompter.setState({ [key]: before } as Partial<PrompterState>),
    redo: () => usePrompter.setState({ [key]: after } as Partial<PrompterState>)
  })
}

const pickLook = (s: PrompterState): PrompterLook => ({ speed: s.speed, fontSize: s.fontSize, linePos: s.linePos, mirror: s.mirror, autoStart: s.autoStart, holdPauses: s.holdPauses })

export function nudgeSpeed(by: number): void {
  setLook('speed', Math.round((usePrompter.getState().speed + by) * 20) / 20)
}

export function openPrompter(open = true): void {
  usePrompter.setState({ open, playing: false, countdown: null })
}

export function chooseScript(path: string | null): void {
  const before = usePrompter.getState().script
  if (before === path) return
  usePrompter.setState({ script: path, playing: false, countdown: null, restartAt: Date.now() })
  recordUndo({
    label: 'Changed the teleprompter script',
    undo: () => usePrompter.setState({ script: before, playing: false, restartAt: Date.now() }),
    redo: () => usePrompter.setState({ script: path, playing: false, restartAt: Date.now() })
  })
}

let countTimer: ReturnType<typeof setInterval> | undefined

/** Starts scrolling after a 3, 2, 1 (or straight away). */
export function startPrompter(count = true): void {
  clearInterval(countTimer)
  if (!count) return usePrompter.setState({ playing: true, countdown: null })
  usePrompter.setState({ playing: false, countdown: 3 })
  countTimer = setInterval(() => {
    const c = usePrompter.getState().countdown
    if (c === null) return clearInterval(countTimer)
    if (c <= 1) {
      clearInterval(countTimer)
      usePrompter.setState({ countdown: null, playing: true })
    } else usePrompter.setState({ countdown: c - 1 })
  }, 1000)
}

export function pausePrompter(): void {
  clearInterval(countTimer)
  usePrompter.setState({ playing: false, countdown: null })
}

/** Pause / resume (Space on the teleprompter, or the shortcut from anywhere). */
export function togglePrompter(): void {
  const s = usePrompter.getState()
  if (!s.open || !s.script) return notify('Open the teleprompter in the Studio and pick a script first.', 'info')
  if (s.playing || s.countdown !== null) pausePrompter()
  else startPrompter(false)
}

export function restartPrompter(): void {
  pausePrompter()
  usePrompter.setState({ restartAt: Date.now() })
}

// ---------- cue times while recording ----------

let take: { path: string; startedAt: number; script: string; cues: Cue[] } | null = null

/** A marker reached the reading line (called by the scroller). */
export function markerReached(at: number, marker: string): void {
  if (!take) return
  take.cues.push({ at, marker, t: (Date.now() - take.startedAt) / 1000 })
}

export const isTakeRunning = (): boolean => !!take

/** Starts and stops with every Studio recording made while the teleprompter is open. */
useStudio.subscribe((s, prev) => {
  if (s.recording && !prev.recording) {
    const p = usePrompter.getState()
    if (!p.open || !p.script) return
    take = { path: s.recording.path, startedAt: s.recording.startedAt, script: p.script, cues: [] }
    if (p.autoStart) startPrompter(true)
  } else if (!s.recording && prev.recording) {
    const done = take
    take = null
    if (usePrompter.getState().playing || usePrompter.getState().countdown !== null) pausePrompter()
    if (done && done.cues.length) void saveCues(done)
  }
})

async function saveCues(done: { path: string; script: string; cues: Cue[] }): Promise<void> {
  try {
    await window.api.studioWriteCues(done.path, JSON.stringify(cuesFile(done.script, done.cues), null, 2))
  } catch (err) {
    console.error('[teleprompter] cues', err)
  }
}
