import { create } from 'zustand'
import { recordUndo } from '../lib/undo'
import { cuesFile } from '../lib/teleprompter'
import { chosenTake, joinPlan, listTitles, takeNumber, type Take, type TakeSection } from '../lib/takes'
import { setAudioOnly, useStudio } from './studio'
import { cuesOf, jumpPrompter, openPrompter, startPrompter, usePrompter } from './teleprompter'
import { notify } from './notify'

/**
 * Record by section (the teleprompter's "By section"): record one section of the script at a time,
 * stop by itself at the section's end, Quick retake to throw a take away and go again, pick the
 * best take of each section, then join them into one voiceover. Takes are remembered per script.
 */

export interface ScriptTakes {
  takes: Take[]
  /** The take each section uses (section key → file), when you've picked one. */
  chosen: Record<string, string>
}

interface Active {
  key: string
  script: string
  path: string | null
  startedAt: number
  /** When the teleprompter started scrolling (the words start just before). */
  playingAt: number | null
  /** The section's end reached the reading line: it's stopping. */
  ended: boolean
  /** Quick retake: start this section again as soon as it stops. */
  retake: boolean
}

export interface TakesState {
  /** "By section" is on. */
  on: boolean
  /** The section that's selected (recorded next). */
  current: string | null
  /** The script on the teleprompter and its sections (set by the teleprompter as it loads). */
  script: string | null
  sections: TakeSection[]
  active: Active | null
  byScript: Record<string, ScriptTakes>
  joining: { state: 'working' | 'done' | 'error'; message?: string; path?: string; needsFfmpeg?: boolean } | null
}

const KEY = 'studio.takes'
/** How long it keeps recording after the section's end reaches the reading line (your last words). */
export const TAIL_MS = 1500
/** How much of the quiet before your first word is kept (seconds). */
const LEAD_IN = 0.35

function load(): Pick<TakesState, 'on' | 'byScript'> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<TakesState>
    const byScript: Record<string, ScriptTakes> = {}
    for (const [script, v] of Object.entries(raw.byScript ?? {})) {
      if (!v || !Array.isArray(v.takes)) continue
      const takes = v.takes.filter((t): t is Take => !!t && typeof t.path === 'string' && typeof t.key === 'string')
      byScript[script] = { takes, chosen: v.chosen && typeof v.chosen === 'object' ? v.chosen : {} }
    }
    return { on: raw.on === true, byScript }
  } catch {
    return { on: false, byScript: {} }
  }
}

export const useTakes = create<TakesState>(() => ({ current: null, script: null, sections: [], active: null, joining: null, ...load() }))

let saveTimer: ReturnType<typeof setTimeout> | undefined
useTakes.subscribe((s, prev) => {
  if (s.on === prev.on && s.byScript === prev.byScript) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      // The newest 400 takes of the 30 most recent scripts.
      const scripts = Object.entries(s.byScript)
        .sort((a, b) => Math.max(0, ...b[1].takes.map((t) => t.at)) - Math.max(0, ...a[1].takes.map((t) => t.at)))
        .slice(0, 30)
      const byScript = Object.fromEntries(scripts.map(([k, v]) => [k, { ...v, takes: v.takes.slice(-400) }]))
      localStorage.setItem(KEY, JSON.stringify({ on: s.on, byScript }))
    } catch {
      // Not remembered this time.
    }
  }, 300)
})

const empty: ScriptTakes = { takes: [], chosen: {} }
export const takesOf = (s: TakesState, script = s.script): ScriptTakes => (script ? (s.byScript[script] ?? empty) : empty)

function setScriptTakes(script: string, next: ScriptTakes): void {
  useTakes.setState((s) => ({ byScript: { ...s.byScript, [script]: next } }))
}

/** The teleprompter loaded a script: these are its sections. */
export function setTakeSections(script: string | null, sections: TakeSection[]): void {
  const s = useTakes.getState()
  const current = s.script === script && sections.some((x) => x.key === s.current) ? s.current : (sections[0]?.key ?? null)
  useTakes.setState({ script, sections, current })
}

/** Turns "By section" on or off. It records your voice only, so it switches the Studio to Audio only. */
export function setBySection(on: boolean): void {
  if (useTakes.getState().active) return notify('Stop recording first.', 'info')
  useTakes.setState({ on, joining: null })
  if (on) {
    if (!useStudio.getState().audioOnly) setAudioOnly(true)
    openPrompter(true)
    const cur = currentSection()
    if (cur) jumpPrompter(cur.from)
  }
}

export const currentSection = (): TakeSection | null => {
  const s = useTakes.getState()
  return s.sections.find((x) => x.key === s.current) ?? null
}

/** Picks a section and scrolls the teleprompter to its start. */
export function selectSection(key: string): void {
  const s = useTakes.getState()
  const sec = s.sections.find((x) => x.key === key)
  if (!sec || s.active) return
  useTakes.setState({ current: key })
  jumpPrompter(sec.from)
}

/** The section before (-1) or after (+1) the selected one. */
export function stepSection(dir: 1 | -1): void {
  const s = useTakes.getState()
  const i = s.sections.findIndex((x) => x.key === s.current)
  const next = s.sections[Math.max(0, Math.min(s.sections.length - 1, i + dir))]
  if (next) selectSection(next.key)
}

/** Records the selected section (or `key`): scrolls to its start, counts 3, 2, 1, and stops by itself at its end. */
export async function recordSection(key?: string): Promise<void> {
  const s = useTakes.getState()
  if (s.active) return stopSection()
  if (useStudio.getState().recording) return notify('Stop the recording that’s going first.', 'info')
  const script = usePrompter.getState().script
  const sec = s.sections.find((x) => x.key === (key ?? s.current))
  if (!script || !sec || script !== s.script) return notify('Open the teleprompter in the Studio and pick a script first.', 'info')
  useTakes.setState({ current: sec.key, joining: null, active: { key: sec.key, script, path: null, startedAt: Date.now(), playingAt: null, ended: false, retake: false } })
  jumpPrompter(sec.from)
  const { startRecording } = await import('../lib/studio')
  await startRecording({ take: { script, index: sec.index, title: sec.title } })
  const rec = useStudio.getState().recording
  if (!rec) {
    useTakes.setState({ active: null })
    return
  }
  useTakes.setState((st) => ({ active: st.active && { ...st.active, path: rec.path, startedAt: rec.startedAt } }))
  // Takes always count you in, so the words start at the same place every time.
  if (!usePrompter.getState().autoStart) startPrompter(true)
}

/** Stops the take that's going (it's kept). */
export async function stopSection(): Promise<void> {
  const { stopRecording } = await import('../lib/studio')
  await stopRecording()
}

/** Quick retake: throws away the take that's going and starts that section again. Not recording: records the selected section again. */
export function quickRetake(): void {
  const a = useTakes.getState().active
  if (!a) return void recordSection()
  useTakes.setState({ active: { ...a, retake: true } })
  void stopSection()
}

let tailTimer: ReturnType<typeof setTimeout> | undefined

/** The teleprompter: a [SECTION] marker reached the reading line. */
export function sectionMarkerReached(from: number): void {
  const s = useTakes.getState()
  const sec = s.active && s.sections.find((x) => x.key === s.active!.key)
  if (!s.active || !sec || s.active.ended || from < sec.to) return
  endTake()
}

/** The teleprompter scrolled to the very end of the script. */
export function scriptEndReached(): void {
  if (useTakes.getState().active && !useTakes.getState().active!.ended) endTake()
}

function endTake(): void {
  useTakes.setState((st) => ({ active: st.active && { ...st.active, ended: true } }))
  clearTimeout(tailTimer)
  tailTimer = setTimeout(() => void stopSection(), TAIL_MS)
}

// When the count-in ends, the words start.
usePrompter.subscribe((p, prev) => {
  const a = useTakes.getState().active
  if (a && p.playing && !prev.playing && a.playingAt === null) useTakes.setState({ active: { ...a, playingAt: Date.now() } })
})

// A take finished: keep it, and get ready for the next section (or go again, for a quick retake).
useStudio.subscribe((st, prev) => {
  if (st.recording || !prev.recording) return
  const a = useTakes.getState().active
  if (!a) return
  clearTimeout(tailTimer)
  useTakes.setState({ active: null })
  const path = st.lastRecording
  if (!path || (a.path && path !== a.path)) return
  const length = st.lastRecordingInfo?.length ?? (Date.now() - a.startedAt) / 1000
  const start = a.playingAt ? Math.max(0, (a.playingAt - a.startedAt) / 1000 - LEAD_IN) : 0
  const take: Take = { key: a.key, path, n: takeNumber(path), at: Date.now(), start, length, cues: cuesOf(path), early: !a.ended, scrapped: a.retake }
  const mine = takesOf(useTakes.getState(), a.script)
  const chosen = { ...mine.chosen }
  // A new good take is the one used, until you pick another.
  if (!a.retake) chosen[a.key] = path
  setScriptTakes(a.script, { takes: [...mine.takes, take], chosen })
  if (a.retake) {
    setTimeout(() => void recordSection(a.key), 250)
    return
  }
  if (a.ended) {
    // On to the next section, ready to go.
    const s = useTakes.getState()
    const i = s.sections.findIndex((x) => x.key === a.key)
    const next = s.sections[i + 1]
    if (next) selectSection(next.key)
    else notify('That was the last section. Join the takes when you’re happy with them.', 'info')
  }
})

/** Uses this take for its section; Ctrl+Z puts the last one back. */
export function chooseTake(path: string): void {
  const s = useTakes.getState()
  const script = s.script
  if (!script) return
  const mine = takesOf(s)
  const take = mine.takes.find((t) => t.path === path)
  if (!take) return
  const before = chosenTake(take.key, mine.takes, mine.chosen)?.path
  if (before === path) return
  const apply = (p: string | undefined): void => {
    const cur = takesOf(useTakes.getState(), script)
    const chosen = { ...cur.chosen }
    if (p) chosen[take.key] = p
    else delete chosen[take.key]
    setScriptTakes(script, { ...cur, chosen })
  }
  apply(path)
  recordUndo({ label: `Picked take ${take.n}`, undo: () => apply(before), redo: () => apply(path) })
}

/** Takes a take off the list (the file stays where it is); Ctrl+Z brings it back. */
export function forgetTake(path: string): void {
  const script = useTakes.getState().script
  if (!script) return
  const before = takesOf(useTakes.getState(), script)
  const take = before.takes.find((t) => t.path === path)
  if (!take) return
  const chosen = { ...before.chosen }
  if (chosen[take.key] === path) delete chosen[take.key]
  setScriptTakes(script, { takes: before.takes.filter((t) => t.path !== path), chosen })
  recordUndo({
    label: `Took take ${take.n} off the list`,
    undo: () => setScriptTakes(script, before),
    redo: () => {
      const cur = takesOf(useTakes.getState(), script)
      setScriptTakes(script, { takes: cur.takes.filter((t) => t.path !== path), chosen })
    }
  })
}

/** Joins each section's chosen take, in order, into one voiceover (with its cues for the shot list). */
export async function joinTakes(): Promise<void> {
  const s = useTakes.getState()
  if (s.joining?.state === 'working' || s.active) return
  const script = s.script
  if (!script) return
  const plan = joinPlan(s.sections, takesOf(s).takes, takesOf(s).chosen)
  if (!plan.parts.length) {
    useTakes.setState({ joining: { state: 'error', message: 'Record a section first.' } })
    return
  }
  const status = await window.api.videoConverterStatus().catch(() => null)
  if (status?.state !== 'ready') {
    useTakes.setState({
      joining: {
        state: 'error',
        needsFfmpeg: status?.state === 'missing',
        message:
          status?.state === 'downloading'
            ? 'The sound and video converter is still downloading. Try again in a moment.'
            : status?.state === 'unsupported'
              ? 'Joining takes needs the converter, which isn’t available for this computer.'
              : 'Joining takes uses Orbit’s sound and video converter (ffmpeg). Download it once, then join.'
      }
    })
    return
  }
  useTakes.setState({ joining: { state: 'working', message: `Joining ${plan.parts.length} take${plan.parts.length === 1 ? '' : 's'}…` } })
  try {
    const res = await window.api.studioJoinTakes(plan.parts, script)
    if (plan.cues.length) await window.api.studioWriteCues(res.path, JSON.stringify(cuesFile(script, plan.cues), null, 2)).catch(() => undefined)
    const left = plan.missing.length ? ` ${listTitles(plan.missing)} ${plan.missing.length === 1 ? 'has' : 'have'} no take yet, so ${plan.missing.length === 1 ? 'it’s' : 'they’re'} left out.` : ''
    useTakes.setState({ joining: { state: 'done', path: res.path, message: `Joined ${plan.parts.length} section${plan.parts.length === 1 ? '' : 's'}.${left}` } })
    // It's the voiceover now: Clean up works on it, like any recording.
    useStudio.setState({ lastRecording: res.path, lastRecordingInfo: { audioOnly: true, clips: 0, length: res.length || plan.length }, trimming: null })
    if (useStudio.getState().trim.auto) void import('../lib/studio').then((m) => m.trimRecording(res.path))
  } catch (err) {
    useTakes.setState({ joining: { state: 'error', message: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The takes couldn’t be joined.' } })
  }
}

/** Downloads the converter, then joins. */
export async function getConverterAndJoin(): Promise<void> {
  useTakes.setState({ joining: { state: 'working', message: 'Downloading the converter…' } })
  const state = await window.api.getVideoConverter().catch(() => null)
  if (state?.state !== 'ready') {
    useTakes.setState({ joining: { state: 'error', needsFfmpeg: true, message: state?.error ? `The download didn’t work: ${state.error}` : 'The download didn’t work. Try again.' } })
    return
  }
  useTakes.setState({ joining: null })
  await joinTakes()
}
