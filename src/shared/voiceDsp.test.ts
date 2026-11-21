import { describe, expect, it } from 'vitest'
import { DeEsser, Gate } from './voiceDsp'

const RATE = 48000
const sine = (freq: number, amp: number, seconds: number): Float32Array => {
  const out = new Float32Array(Math.round(RATE * seconds))
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / RATE)
  return out
}
const rms = (b: Float32Array, from = 0): number => {
  let s = 0
  for (let i = from; i < b.length; i++) s += b[i] * b[i]
  return Math.sqrt(s / (b.length - from))
}
const db = (r: number): number => 20 * Math.log10(r)

describe('noise gate', () => {
  it('turns quiet noise between words down by its range', () => {
    const g = new Gate({ on: true, threshold: -45, range: 24 }, RATE)
    const quiet = sine(200, 0.002, 1) // about −57 dB: room noise
    const before = rms(quiet)
    g.process(quiet)
    expect(db(rms(quiet, RATE / 2) / before)).toBeLessThan(-20)
  })

  it('leaves your voice alone', () => {
    const g = new Gate({ on: true, threshold: -45, range: 24 }, RATE)
    const voice = sine(200, 0.3, 0.5)
    const before = rms(voice)
    g.process(voice)
    expect(Math.abs(db(rms(voice, 200) / before))).toBeLessThan(0.5)
  })

  it('holds open for a moment after you stop, so word endings aren’t cut', () => {
    const g = new Gate({ on: true, threshold: -45, range: 24 }, RATE)
    g.process(sine(200, 0.3, 0.2))
    const tail = sine(200, 0.002, 0.1)
    const before = rms(tail)
    g.process(tail)
    expect(Math.abs(db(rms(tail) / before))).toBeLessThan(1)
  })

  it('does nothing when off', () => {
    const g = new Gate({ on: false, threshold: -45, range: 24 }, RATE)
    const quiet = sine(200, 0.002, 0.5)
    const copy = quiet.slice()
    g.process(quiet)
    expect(quiet).toEqual(copy)
  })
})

describe('de-esser', () => {
  it('turns a harsh "s" down', () => {
    const d = new DeEsser({ on: true, amount: 0.7 }, RATE)
    const s = sine(8000, 0.3, 0.5)
    const before = rms(s)
    d.process(s)
    expect(db(rms(s, RATE / 4) / before)).toBeLessThan(-4)
  })

  it('leaves the body of your voice alone', () => {
    for (const freq of [250, 1000, 2500]) {
      const d = new DeEsser({ on: true, amount: 0.7 }, RATE)
      const v = sine(freq, 0.3, 0.5)
      const before = rms(v)
      d.process(v)
      expect(Math.abs(db(rms(v, RATE / 4) / before))).toBeLessThan(1)
    }
  })
})
