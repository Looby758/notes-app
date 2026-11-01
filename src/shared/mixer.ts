/**
 * The volume mixer: one slider per app that's making sound (a game, Discord, Spotify...), plus the
 * whole computer's volume. main/mixer.ts reads and sets them; this file has the parts both sides
 * use, with no Electron in them, so they can be tested.
 */

export type MixerKind = 'master' | 'app' | 'system'

export interface MixerApp {
  /** 'master', 'system', or the app ('win:discord.exe', 'mac:spotify'). */
  id: string
  name: string
  kind: MixerKind
  /** 0 to 100. */
  volume: number
  muted: boolean
  /** How loud it is right now, 0 to 100 (Windows only; undefined where it can't be read). */
  level?: number
  /** The program's icon as a data URL, when there is one. */
  icon?: string
}

export interface MixerState {
  /** Master first, then apps by name, then system sounds. */
  apps: MixerApp[]
  /** The speakers or headphones the master slider changes. */
  device?: string
  /** Why the mixer can't work here, shown instead of the sliders. */
  problem?: string
  /** A line of help shown under the sliders. */
  note?: string
}

/** One sound session as the Windows helper reports it (an app can have several). */
export interface RawSession {
  pid: number
  /** The program's full path ('' if Windows wouldn't say). */
  exe: string
  /** The process name, without .exe. */
  proc: string
  /** The program's own description (e.g. "Google Chrome"). */
  desc: string
  /** The name the app gave its sound, if any (can be "@%SystemRoot%..." for Windows' own). */
  display: string
  /** The app's main window title. */
  title: string
  /** 0 to 1. */
  vol: number
  mute: boolean
  /** 0 to 1. */
  peak: number
  sys: boolean
}

export interface RawMaster {
  name: string
  vol: number
  mute: boolean
  peak: number
}

/** What the Windows helper sends back for 'list'. */
export interface RawList {
  ok: boolean
  master: RawMaster | null
  sessions: RawSession[]
}

export const clampVolume = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

const toPercent = (v: number): number => clampVolume((Number.isFinite(v) ? v : 0) * 100)

/** Programs whose own name says nothing about what's running (Minecraft is javaw). */
const GENERIC = new Set(['java', 'javaw', 'python', 'pythonw', 'node', 'rundll32', 'dllhost', 'svchost', 'wscript', 'cscript'])

/** Names that read better than the program's own description. */
const KNOWN: Record<string, string> = {
  discord: 'Discord',
  discordptb: 'Discord PTB',
  discordcanary: 'Discord Canary',
  spotify: 'Spotify',
  chrome: 'Chrome',
  msedge: 'Edge',
  firefox: 'Firefox',
  opera: 'Opera',
  brave: 'Brave',
  steam: 'Steam',
  steamwebhelper: 'Steam',
  vlc: 'VLC',
  teams: 'Teams',
  'ms-teams': 'Teams',
  zoom: 'Zoom',
  obs64: 'OBS',
  obs: 'OBS'
}

const capitalise = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** The name to show for an app's slider. */
export function friendlyName(s: Pick<RawSession, 'proc' | 'desc' | 'display' | 'title' | 'sys'>): string {
  if (s.sys) return 'System sounds'
  const proc = s.proc.toLowerCase().replace(/\.exe$/, '')
  if (KNOWN[proc]) return KNOWN[proc]
  if (GENERIC.has(proc) && s.title.trim()) return s.title.trim().slice(0, 48)
  const display = s.display.trim()
  if (display && !display.startsWith('@')) return display.slice(0, 48)
  const desc = s.desc.trim()
  if (desc && !/^(java\(tm\)|python|node\.js)/i.test(desc)) return desc.slice(0, 48)
  if (s.title.trim()) return s.title.trim().slice(0, 48)
  return capitalise(proc) || 'App'
}

/** Which app a session belongs to: one slider per program, however many sounds it plays. */
export function appKey(s: Pick<RawSession, 'exe' | 'proc' | 'sys'>): string {
  if (s.sys) return 'system'
  const file = s.exe.split(/[\\/]/).pop() || `${s.proc}.exe`
  return `win:${file.toLowerCase()}`
}

export interface GroupedApps {
  apps: MixerApp[]
  /** Each app's sessions, as the helper's targets ('master', 'sys', or process ids). */
  targets: Record<string, string[]>
  /** Each app's program path, for its icon. */
  exes: Record<string, string>
}

/** Turns the helper's sessions into one slider per app (the loudest part of each one wins). */
export function groupSessions(list: RawList): GroupedApps {
  const apps: MixerApp[] = []
  const targets: Record<string, string[]> = {}
  const exes: Record<string, string> = {}
  const byKey = new Map<string, { app: MixerApp; vols: number[]; mutes: boolean[] }>()
  for (const s of list.sessions ?? []) {
    if (!s || typeof s.pid !== 'number') continue
    const key = appKey(s)
    let entry = byKey.get(key)
    if (!entry) {
      entry = { app: { id: key, name: friendlyName(s), kind: s.sys ? 'system' : 'app', volume: 0, muted: false, level: 0 }, vols: [], mutes: [] }
      byKey.set(key, entry)
      targets[key] = []
      if (s.exe) exes[key] = s.exe
    }
    const target = s.sys ? 'sys' : String(s.pid)
    if (!targets[key].includes(target)) targets[key].push(target)
    entry.vols.push(toPercent(s.vol))
    entry.mutes.push(!!s.mute)
    entry.app.level = Math.max(entry.app.level ?? 0, toPercent(s.peak))
    // A generic program (Java) gets the window title, which may only be on one of its sessions.
    if (entry.app.name === capitalise(s.proc) && friendlyName(s) !== entry.app.name) entry.app.name = friendlyName(s)
  }
  for (const { app, vols, mutes } of byKey.values()) {
    app.volume = Math.max(...vols)
    app.muted = mutes.every(Boolean)
    apps.push(app)
  }
  apps.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'system' ? 1 : -1))
  if (list.master) {
    apps.unshift({ id: 'master', name: 'Everything', kind: 'master', volume: toPercent(list.master.vol), muted: !!list.master.mute, level: toPercent(list.master.peak) })
    targets.master = ['master']
  }
  return { apps, targets, exes }
}

/** The Mac apps whose own volume Orbit can change (they let other apps do it). */
export const MAC_APPS: { id: string; name: string; app: string }[] = [
  { id: 'mac:spotify', name: 'Spotify', app: 'Spotify' },
  { id: 'mac:music', name: 'Music', app: 'Music' }
]

/** What the Mac helper sends back. */
export interface RawMacList {
  master: { vol: number | null; mute: boolean } | null
  apps: { id: string; vol: number }[]
}

/**
 * The Mac's sliders. Spotify and Music have no mute of their own, so muting sets them to 0 and
 * `remembered` holds the volume to go back to.
 */
export function macState(raw: RawMacList, remembered: Record<string, number>): MixerState {
  const apps: MixerApp[] = []
  let problem: string | undefined
  if (raw.master && raw.master.vol !== null) {
    apps.push({ id: 'master', name: 'Everything', kind: 'master', volume: clampVolume(raw.master.vol), muted: !!raw.master.mute })
  } else if (raw.master) {
    problem = 'This Mac’s sound is going somewhere macOS can’t set the volume of (some HDMI screens and USB speakers). Use the speaker’s own controls.'
  }
  for (const a of raw.apps ?? []) {
    const known = MAC_APPS.find((m) => m.id === a.id)
    if (!known) continue
    const vol = clampVolume(a.vol)
    const muted = vol === 0 && remembered[a.id] !== undefined
    apps.push({ id: a.id, name: known.name, kind: 'app', volume: muted ? remembered[a.id] : vol, muted })
  }
  return {
    apps,
    problem: apps.length ? undefined : problem,
    note: 'On a Mac, Orbit can set the volume of everything, Spotify and Music. macOS doesn’t let one app change another’s volume (like Discord or a game) without a sound add-on.'
  }
}
