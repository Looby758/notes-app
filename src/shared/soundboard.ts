/**
 * The soundboard and voice changer. Sound clips are copied into Orbit's own folder (so moving or
 * deleting the original doesn't break a button) and listed in board.json there. Each clip can have
 * a system-wide hotkey, which works while a game or Discord is in front.
 *
 * Getting sound "into the mic": Orbit can't make a microphone of its own, so it plays everything
 * (your mic with the voice changer, the clips, your music) into a virtual cable (VB-CABLE on
 * Windows, BlackHole or VB-CABLE on a Mac), and Discord or the game uses the cable's other end
 * as its microphone.
 */

import { IS_MAC } from './platform'

export const SOUND_TYPES = ['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.opus', '.webm']
/** Clips longer than this are refused when added (it's a soundboard, not a music player). */
export const SOUND_MAX_BYTES = 40 * 1024 * 1024
export const SOUND_LIMIT = 200

export const SOUND_COLOURS = ['#7c6cf2', '#e0566b', '#f29a38', '#e8c547', '#4fbf73', '#3fb5c9', '#4d8ef0', '#c368e0', '#8a8f98'] as const

export interface SoundClip {
  id: string
  name: string
  /** The copy in Orbit's soundboard folder (just the file name). */
  file: string
  /** System-wide hotkey as an Electron accelerator ("Control+Alt+1", "num5", "F13"), or ''. */
  hotkey: string
  /** 0 to 2 (100% is 1). */
  volume: number
  colour: string
  emoji: string
}

/** Hotkeys for the board itself, not for one clip. */
export interface BoardHotkeys {
  stopAll: string
  voiceToggle: string
  /** Hold-free mute of everything Orbit sends to the call. */
  muteToggle: string
}

export interface SoundboardData {
  clips: SoundClip[]
  hotkeys: BoardHotkeys
}

/** What a hotkey does, sent from the main process to the window. */
export type SoundboardAction = { kind: 'clip'; id: string } | { kind: 'stopAll' } | { kind: 'voiceToggle' } | { kind: 'muteToggle' }

export interface SoundboardStatus {
  board: SoundboardData
  /** Hotkeys that couldn't be taken (another app has them), by clip id or board hotkey name. */
  hotkeyErrors: Record<string, string>
}

export const EMPTY_HOTKEYS: BoardHotkeys = { stopAll: '', voiceToggle: '', muteToggle: '' }

const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown, d: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)

/** A clip's name from its file name: "airhorn_sound-effect.mp3" → "Airhorn sound effect". */
export function nameFromFile(file: string): string {
  const base = (file.split(/[\\/]/).pop() ?? file).replace(/\.[^.]+$/, '')
  const words = base.replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!words) return 'Sound'
  return (words[0].toUpperCase() + words.slice(1)).slice(0, 60)
}

/** Safe to keep: drops anything malformed, fixes ranges, removes duplicate hotkeys (the first keeps it). */
export function cleanBoard(raw: unknown): SoundboardData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { clips?: unknown; hotkeys?: Partial<Record<keyof BoardHotkeys, unknown>> }
  const used = new Set<string>()
  const take = (accel: string): string => {
    const a = normalizeAccelerator(accel)
    if (!a || used.has(a.toLowerCase())) return ''
    used.add(a.toLowerCase())
    return a
  }
  const h = r.hotkeys ?? {}
  const hotkeys: BoardHotkeys = { stopAll: take(str(h.stopAll)), voiceToggle: take(str(h.voiceToggle)), muteToggle: take(str(h.muteToggle)) }
  const ids = new Set<string>()
  const clips: SoundClip[] = []
  for (const c of Array.isArray(r.clips) ? r.clips : []) {
    if (!c || typeof c !== 'object') continue
    const o = c as Record<string, unknown>
    const id = str(o.id, 40)
    const file = str(o.file, 200)
    // Only a plain file name inside the soundboard folder.
    if (!id || ids.has(id) || !file || /[\\/]|^\.\.?$/.test(file)) continue
    if (!SOUND_TYPES.some((t) => file.toLowerCase().endsWith(t))) continue
    ids.add(id)
    const colour = str(o.colour, 9)
    clips.push({
      id,
      file,
      name: str(o.name, 60).trim() || nameFromFile(file),
      hotkey: take(str(o.hotkey, 60)),
      volume: num(o.volume, 1, 0, 2),
      colour: /^#[0-9a-f]{6}$/i.test(colour) ? colour : SOUND_COLOURS[clips.length % SOUND_COLOURS.length],
      emoji: str(o.emoji, 16)
    })
    if (clips.length >= SOUND_LIMIT) break
  }
  return { clips, hotkeys }
}

// ---------------------------------------------------------------------------------------------
// Hotkeys

const NAMED: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec'
}

const MODS = ['Control', 'Alt', 'Shift', 'Super'] as const

/** Keys fine on their own as a system-wide hotkey (nobody types with them). */
const isLoneKey = (key: string): boolean => /^F(1[3-9]|2[0-4]|[1-9]|1[0-2])$/.test(key) || /^num/.test(key) || ['Insert', 'Home', 'End', 'PageUp', 'PageDown'].includes(key)

/**
 * The Electron accelerator for a key press, or null while only modifier keys are down. Letters,
 * numbers and symbols need Ctrl, Alt, Shift or ⌘ with them, so the hotkey doesn't stop you typing
 * that key everywhere else; F keys and the number pad's keys can be used on their own.
 */
export function acceleratorFromEvent(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS'].includes(e.key)) return null
  const code = e.code ?? ''
  let key = ''
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3)
  else if (/^Digit\d$/.test(code)) key = code.slice(5)
  else if (/^Numpad\d$/.test(code)) key = `num${code.slice(6)}`
  else if (/^F\d{1,2}$/.test(code)) key = code
  else if (NAMED[code]) key = NAMED[code]
  if (!key) return null
  const mods = [e.ctrlKey ? 'Control' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', e.metaKey ? 'Super' : ''].filter(Boolean)
  // Shift alone with a number-pad key turns it into an arrow or Home on Windows: don't offer it.
  if (mods.length === 0 && !isLoneKey(key)) return null
  if (mods.length === 1 && mods[0] === 'Shift' && !isLoneKey(key)) return null
  return [...mods, key].join('+')
}

/** Tidies a saved accelerator (modifier order, known keys); '' if it isn't one. */
export function normalizeAccelerator(accel: string): string {
  const parts = accel.split('+').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return ''
  const key = parts.pop()!
  const alias: Record<string, string> = { Ctrl: 'Control', Command: 'Super', Cmd: 'Super', Meta: 'Super', Option: 'Alt', CommandOrControl: 'Control', CmdOrCtrl: 'Control' }
  const mods = new Set(parts.map((p) => alias[p] ?? p))
  if (![...mods].every((m) => (MODS as readonly string[]).includes(m))) return ''
  if ((MODS as readonly string[]).includes(alias[key] ?? key)) return ''
  if (!/^([A-Z0-9]|F\d{1,2}|num(\d|add|sub|mult|div|dec)|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|[-=[\]\\;',./`])$/.test(key)) return ''
  if (mods.size === 0 && !isLoneKey(key)) return ''
  return [...MODS.filter((m) => mods.has(m)), key].join('+')
}

/** How a hotkey is written for people: "Ctrl+Alt+1", "Num 5", or ⌃⌥1 on a Mac. */
export function hotkeyLabel(accel: string, mac = IS_MAC): string {
  if (!accel) return ''
  const parts = accel.split('+')
  const raw = parts.pop()!
  const pad: Record<string, string> = { add: '+', sub: '−', mult: '×', div: '÷', dec: '.' }
  const key = raw.startsWith('num') ? `Num ${pad[raw.slice(3)] ?? raw.slice(3)}` : raw
  if (mac) {
    const sym: Record<string, string> = { Control: '⌃', Alt: '⌥', Shift: '⇧', Super: '⌘' }
    return parts.map((p) => sym[p] ?? p).join('') + (parts.length && key.startsWith('Num') ? ' ' : '') + key
  }
  const names: Record<string, string> = { Control: 'Ctrl', Super: 'Win' }
  return [...parts.map((p) => names[p] ?? p), key].join('+')
}

/** Every hotkey in use on the board, by what it's for ("clip:<id>", "stopAll"…). */
export function boardHotkeys(board: SoundboardData): Map<string, SoundboardAction> {
  const out = new Map<string, SoundboardAction>()
  for (const c of board.clips) if (c.hotkey) out.set(c.hotkey, { kind: 'clip', id: c.id })
  const h = board.hotkeys
  if (h.stopAll) out.set(h.stopAll, { kind: 'stopAll' })
  if (h.voiceToggle) out.set(h.voiceToggle, { kind: 'voiceToggle' })
  if (h.muteToggle) out.set(h.muteToggle, { kind: 'muteToggle' })
  return out
}

/** Who already has a hotkey on the board (a clip's name, or a board action), or null. */
export function hotkeyOwner(board: SoundboardData, accel: string, except?: string): string | null {
  if (!accel) return null
  const a = accel.toLowerCase()
  for (const c of board.clips) if (c.id !== except && c.hotkey.toLowerCase() === a) return `“${c.name}”`
  const labels: Record<keyof BoardHotkeys, string> = { stopAll: 'Stop all sounds', voiceToggle: 'Voice changer on/off', muteToggle: 'Mute what Orbit sends' }
  for (const k of Object.keys(labels) as (keyof BoardHotkeys)[]) if (k !== except && board.hotkeys[k].toLowerCase() === a) return labels[k]
  return null
}

// ---------------------------------------------------------------------------------------------
// The voice changer

export type VoiceEffectId = 'none' | 'robot' | 'deep' | 'chipmunk' | 'demon' | 'radio' | 'cave' | 'alien'

export interface VoiceEffect {
  id: VoiceEffectId
  name: string
  emoji: string
  blurb: string
  /** How much higher (above 1) or lower (below 1) the voice goes. */
  pitch: number
}

export const VOICE_EFFECTS: VoiceEffect[] = [
  { id: 'none', name: 'Normal', emoji: '🙂', blurb: 'Your own voice', pitch: 1 },
  { id: 'robot', name: 'Robot', emoji: '🤖', blurb: 'Metallic and buzzy', pitch: 1 },
  { id: 'deep', name: 'Deep', emoji: '🐻', blurb: 'Lower and bigger', pitch: 0.72 },
  { id: 'chipmunk', name: 'Chipmunk', emoji: '🐿️', blurb: 'High and squeaky', pitch: 1.7 },
  { id: 'demon', name: 'Demon', emoji: '😈', blurb: 'Very low and growly', pitch: 0.55 },
  { id: 'radio', name: 'Radio', emoji: '📻', blurb: 'Old walkie-talkie', pitch: 1 },
  { id: 'cave', name: 'Cave', emoji: '🪨', blurb: 'Big echo', pitch: 1 },
  { id: 'alien', name: 'Alien', emoji: '👽', blurb: 'Wobbly and high', pitch: 1.3 }
]

export const voiceEffect = (id: string): VoiceEffect => VOICE_EFFECTS.find((v) => v.id === id) ?? VOICE_EFFECTS[0]

/**
 * The pitch shifter (two delay lines whose delay time slides, faded between) moves the pitch by
 * 1 - slope, where the slope is how fast the delay changes. Returns which way to slide and the
 * size of the slide for a pitch ratio (1.7 = 70% higher).
 */
export function pitchShiftSettings(ratio: number): { up: boolean; amount: number } {
  const r = Math.min(2, Math.max(0.5, ratio))
  return r >= 1 ? { up: true, amount: 2 * (r - 1) } : { up: false, amount: 2 * (1 - r) }
}

// ---------------------------------------------------------------------------------------------
// The virtual cable

/** Output devices that are the "speaker" end of a virtual cable, so whatever plays there reaches the other end (a mic). */
export function isVirtualCableOutput(label: string): boolean {
  return /cable input|vb-audio|voicemeeter (vaio |aux )?input|blackhole|virtual (audio )?cable|loopback audio/i.test(label)
}

/** The mic end of the same cables (what Discord should use as its input), so Orbit never listens to its own output. */
export function isVirtualCableInput(label: string): boolean {
  return /cable output|voicemeeter (out|output)|blackhole|virtual (audio )?cable/i.test(label)
}
