import { usePrefs } from '../store/prefs'
import { useUI } from '../store/ui'

/**
 * Soft interface sounds: a click for buttons, a whoosh when panels and dialogs slide in or out,
 * a tick for ticking a task. They're made with Web Audio (no sound files), stay quiet, and turn
 * off with Settings → Appearance → Interface sounds.
 */
export type Sound = 'click' | 'tick' | 'whooshIn' | 'whooshOut'

let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null
const lastPlayed: Partial<Record<Sound, number>> = {}

function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext()
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function whiteNoise(ac: AudioContext): AudioBuffer {
  if (noise) return noise
  noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.5), ac.sampleRate)
  const data = noise.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return noise
}

/** A short sine blip that drops in pitch: the click and the tick. */
function blip(ac: AudioContext, out: AudioNode, from: number, to: number, ms: number, level: number): void {
  const t = ac.currentTime
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(from, t)
  osc.frequency.exponentialRampToValueAtTime(to, t + ms / 1000)
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(level, t + 0.003)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000)
  osc.connect(gain).connect(out)
  osc.start(t)
  osc.stop(t + ms / 1000 + 0.02)
}

/** Filtered noise swept up (in) or down (out), timed like the app's slide animations. */
function whoosh(ac: AudioContext, out: AudioNode, rising: boolean, level: number): void {
  const t = ac.currentTime
  const dur = 0.22
  const src = ac.createBufferSource()
  src.buffer = whiteNoise(ac)
  const filter = ac.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 1.2
  filter.frequency.setValueAtTime(rising ? 500 : 1800, t)
  filter.frequency.exponentialRampToValueAtTime(rising ? 1800 : 450, t + dur)
  const gain = ac.createGain()
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(level, t + dur * 0.4)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(filter).connect(gain).connect(out)
  src.start(t)
  src.stop(t + dur + 0.02)
}

/** Plays a sound if interface sounds are on. Repeats within a moment are skipped, so nothing rattles. */
export function playSound(sound: Sound): void {
  const { interfaceSounds, interfaceSoundsVolume } = usePrefs.getState().prefs
  if (!interfaceSounds || interfaceSoundsVolume <= 0) return
  const now = performance.now()
  if (now - (lastPlayed[sound] ?? -Infinity) < 60) return
  lastPlayed[sound] = now
  const ac = audio()
  if (!ac) return
  const out = ac.createGain()
  out.gain.value = interfaceSoundsVolume
  out.connect(ac.destination)
  if (sound === 'click') blip(ac, out, 1400, 700, 45, 0.12)
  else if (sound === 'tick') blip(ac, out, 900, 1500, 90, 0.16)
  else whoosh(ac, out, sound === 'whooshIn', 0.22)
}

const CLICKABLE = 'button, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], input[type="checkbox"], input[type="radio"], select, .tree-row'

/** Starts listening: clicks on buttons, and panels/dialogs opening and closing. Call once. */
export function startInterfaceSounds(): void {
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as Element | null)?.closest?.(CLICKABLE)
      if (el && !(el as HTMLButtonElement).disabled) playSound('click')
    },
    true
  )
  useUI.subscribe((s, prev) => {
    const opened = (s.modal && !prev.modal) || (s.leftOpen && !prev.leftOpen) || (s.rightOpen && !prev.rightOpen)
    const closed = (!s.modal && prev.modal) || (!s.leftOpen && prev.leftOpen) || (!s.rightOpen && prev.rightOpen)
    if (opened) playSound('whooshIn')
    else if (closed) playSound('whooshOut')
  })
}
