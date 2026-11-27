import { describe, expect, it } from 'vitest'
import {
  fadeGain,
  fitFades,
  fixSelection,
  formatTime,
  isAudioName,
  keptParts,
  parseTime,
  partsFrom,
  peaks,
  resultLength,
  resultTime,
  rulerStep,
  trimChannels,
  trimmedName
} from './audioTrim'

describe('picking a part', () => {
  it('keeps the selection inside the sound and the right way round', () => {
    expect(fixSelection({ start: 5, end: 2 }, 10)).toEqual({ start: 2, end: 5 })
    expect(fixSelection({ start: -3, end: 40 }, 10)).toEqual({ start: 0, end: 10 })
    expect(fixSelection({ start: 4, end: 4 }, 10)).toEqual({ start: 4, end: 4.05 })
    expect(fixSelection({ start: 10, end: 10 }, 10)).toEqual({ start: 9.95, end: 10 })
  })

  it('knows what’s kept', () => {
    const sel = { start: 2, end: 5 }
    expect(keptParts(sel, 'keep', 10)).toEqual([[2, 5]])
    expect(keptParts(sel, 'cut', 10)).toEqual([[0, 2], [5, 10]])
    expect(keptParts({ start: 0, end: 5 }, 'cut', 10)).toEqual([[5, 10]])
    expect(resultLength(sel, 'keep', 10)).toBe(3)
    expect(resultLength(sel, 'cut', 10)).toBe(7)
  })
})

describe('listening', () => {
  const sel = { start: 2, end: 5 }
  it('plays only what’s kept', () => {
    expect(partsFrom(3, sel, 'keep', 10)).toEqual([[3, 5]])
    expect(partsFrom(0, sel, 'keep', 10)).toEqual([[2, 5]])
    // Past the end starts again from the top.
    expect(partsFrom(7, sel, 'keep', 10)).toEqual([[2, 5]])
    expect(partsFrom(1, sel, 'cut', 10)).toEqual([[1, 2], [5, 10]])
    expect(partsFrom(3, sel, 'cut', 10)).toEqual([[5, 10]])
    expect(partsFrom(10, sel, 'cut', 10)).toEqual([[0, 2], [5, 10]])
  })

  it('maps times onto the saved sound', () => {
    expect(resultTime(3, sel, 'keep', 10)).toBe(1)
    expect(resultTime(1, sel, 'keep', 10)).toBe(0)
    expect(resultTime(6, sel, 'cut', 10)).toBe(3)
    expect(resultTime(3, sel, 'cut', 10)).toBe(2)
  })

  it('fades in and out', () => {
    expect(fadeGain(0, 10, 2, 2)).toBe(0)
    expect(fadeGain(1, 10, 2, 2)).toBe(0.5)
    expect(fadeGain(5, 10, 2, 2)).toBe(1)
    expect(fadeGain(9, 10, 2, 2)).toBe(0.5)
    expect(fadeGain(5, 10, 0, 0)).toBe(1)
    expect(fitFades(2, 2, 2)).toEqual({ fadeIn: 1, fadeOut: 1 })
    expect(fitFades(10, 2, 3)).toEqual({ fadeIn: 2, fadeOut: 3 })
  })
})

describe('trimming', () => {
  const rate = 10
  const ramp = Float32Array.from({ length: 100 }, (_, i) => i / 100)
  it('keeps just the selection', () => {
    const [out] = trimChannels([ramp], rate, { start: 2, end: 5 }, 'keep')
    expect(out.length).toBe(30)
    expect(out[0]).toBeCloseTo(0.2)
    expect(out[29]).toBeCloseTo(0.49)
  })

  it('cuts the selection out and joins the rest', () => {
    const [out] = trimChannels([ramp], 1000, { start: 0.02, end: 0.05 }, 'cut')
    expect(out.length).toBe(70)
  })

  it('does every channel the same', () => {
    const out = trimChannels([ramp, ramp], rate, { start: 1, end: 3 }, 'keep')
    expect(out).toHaveLength(2)
    expect([...out[0]]).toEqual([...out[1]])
  })

  it('puts the fades on', () => {
    const ones = new Float32Array(100).fill(1)
    const [out] = trimChannels([ones], rate, { start: 0, end: 10 }, 'keep', { fadeIn: 1, fadeOut: 1 })
    expect(out[0]).toBe(0)
    expect(out[5]).toBeCloseTo(0.5)
    expect(out[50]).toBe(1)
    expect(out[99]).toBe(0)
  })
})

describe('the waveform', () => {
  it('finds the loudest and quietest point in each column', () => {
    const ch = Float32Array.from([0, 0.5, -0.25, 0, 1, -1, 0, 0])
    const p = peaks([ch], 8, 0, 1, 2)
    expect([...p]).toEqual([-0.25, 0.5, -1, 1])
  })
})

describe('times', () => {
  it('writes times', () => {
    expect(formatTime(75.25)).toBe('1:15.25')
    expect(formatTime(3.5)).toBe('0:03.50')
    expect(formatTime(3723.5)).toBe('1:02:03.50')
    expect(formatTime(59.999)).toBe('1:00.00')
    expect(formatTime(65, 0)).toBe('1:05')
  })

  it('reads typed times', () => {
    expect(parseTime('1:15.5')).toBe(75.5)
    expect(parseTime('75.5')).toBe(75.5)
    expect(parseTime('1:02:03')).toBe(3723)
    expect(parseTime(' 0:03,25 ')).toBe(3.25)
    expect(parseTime('1:75')).toBe(null)
    expect(parseTime('abc')).toBe(null)
    expect(parseTime('')).toBe(null)
  })

  it('picks ruler steps', () => {
    expect(rulerStep(0.3)).toBe(0.5)
    expect(rulerStep(7)).toBe(10)
    expect(rulerStep(100000)).toBe(3600)
  })
})

describe('files', () => {
  it('names the trimmed file', () => {
    expect(trimmedName('song.m4a', 'mp3')).toBe('song (trimmed).mp3')
    expect(trimmedName('voice memo.wav', 'wav')).toBe('voice memo (trimmed).wav')
    expect(trimmedName('.mp3', 'wav')).toBe('Audio (trimmed).wav')
  })

  it('knows sound files', () => {
    expect(isAudioName('Track 01.FLAC')).toBe(true)
    expect(isAudioName('notes.md')).toBe(false)
  })
})
