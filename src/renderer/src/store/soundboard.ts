import { create } from 'zustand'
import { EMPTY_HOTKEYS, voiceEffect, type SoundboardData, type VoiceEffectId } from '@shared/soundboard'

/**
 * The soundboard's settings (kept on this computer) and what it's doing right now. The clips and
 * hotkeys live in the main process (main/soundboard.ts); the sound is made in lib/soundboard.ts.
 */

export type RepeatPress = 'restart' | 'stop' | 'overlap'

export interface SoundboardSettings {
  /** Your mic goes through Orbit (with the voice changer) into the call. */
  micOn: boolean
  /** The microphone: '' = the default one. */
  micId: string
  /** Where Orbit sends the call's sound: the virtual cable's input ('' = nowhere yet). */
  sendId: string
  /** Where you hear things yourself: your headphones ('' = the default speakers/headphones). */
  monitorId: string
  voice: VoiceEffectId
  /** The voice changer can be switched off (by hotkey) without losing which voice is picked. */
  voiceOn: boolean
  /** Hear your own mic, through the voice changer, in your headphones. */
  hearYourself: boolean
  /** Hear the soundboard's sounds yourself too. */
  hearSounds: boolean
  /** Your own Orbit music goes into the call. */
  musicOn: boolean
  /** 0 to 2 (100% is 1). */
  micVolume: number
  soundsVolume: number
  musicVolume: number
  /** How loud you hear yourself and the sounds (doesn't change what the call hears). */
  monitorVolume: number
  /** Mic muted (the sounds and music still go through). */
  micMuted: boolean
  noiseSuppression: boolean
  repeat: RepeatPress
}

export interface SoundboardState extends SoundboardSettings {
  board: SoundboardData
  hotkeyErrors: Record<string, string>
  loaded: boolean
  /** Clip ids playing right now. */
  playing: string[]
  /** The sound engine is running (the mic is open, or a sound is going). */
  running: boolean
  problem: string | null
}

const KEY = 'soundboard.settings'

export const DEFAULT_SETTINGS: SoundboardSettings = {
  micOn: false,
  micId: '',
  sendId: '',
  monitorId: '',
  voice: 'none',
  voiceOn: true,
  hearYourself: false,
  hearSounds: true,
  musicOn: false,
  micVolume: 1,
  soundsVolume: 0.8,
  musicVolume: 0.4,
  monitorVolume: 0.8,
  micMuted: false,
  noiseSuppression: true,
  repeat: 'restart'
}

function load(): SoundboardSettings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<SoundboardSettings>
    const vol = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : d)
    const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
    const text = (v: unknown): string => (typeof v === 'string' ? v : '')
    return {
      micOn: bool(s.micOn, DEFAULT_SETTINGS.micOn),
      micId: text(s.micId),
      sendId: text(s.sendId),
      monitorId: text(s.monitorId),
      voice: voiceEffect(text(s.voice)).id,
      voiceOn: bool(s.voiceOn, true),
      hearYourself: bool(s.hearYourself, false),
      hearSounds: bool(s.hearSounds, true),
      musicOn: bool(s.musicOn, false),
      micVolume: vol(s.micVolume, DEFAULT_SETTINGS.micVolume),
      soundsVolume: vol(s.soundsVolume, DEFAULT_SETTINGS.soundsVolume),
      musicVolume: vol(s.musicVolume, DEFAULT_SETTINGS.musicVolume),
      monitorVolume: vol(s.monitorVolume, DEFAULT_SETTINGS.monitorVolume),
      micMuted: bool(s.micMuted, false),
      noiseSuppression: bool(s.noiseSuppression, true),
      repeat: s.repeat === 'stop' || s.repeat === 'overlap' ? s.repeat : 'restart'
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export const useSoundboard = create<SoundboardState>(() => ({
  ...load(),
  board: { clips: [], hotkeys: { ...EMPTY_HOTKEYS } },
  hotkeyErrors: {},
  loaded: false,
  playing: [],
  running: false,
  problem: null
}))

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof SoundboardSettings)[]

let saveTimer: ReturnType<typeof setTimeout> | undefined
useSoundboard.subscribe((s, before) => {
  if (!SETTING_KEYS.some((k) => s[k] !== before[k])) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(SETTING_KEYS.map((k) => [k, useSoundboard.getState()[k]]))))
    } catch {
      // Only a convenience.
    }
  }, 300)
})

export const setSoundboard = (patch: Partial<SoundboardSettings>): void => useSoundboard.setState(patch)
