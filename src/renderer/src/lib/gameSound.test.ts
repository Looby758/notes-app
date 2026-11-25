import { describe, expect, it } from 'vitest'
import { mergeHz, noteHz, scaleNote } from './gameSound'

describe('game sound pitches', () => {
  it('tunes notes from A4', () => {
    expect(noteHz(0)).toBe(440)
    expect(noteHz(12)).toBeCloseTo(880)
  })

  it('climbs a pentatonic scale, an octave every five notes', () => {
    expect(scaleNote(0)).toBe(-9)
    expect(scaleNote(5)).toBe(3)
    expect([0, 1, 2, 3, 4, 5, 6].map(scaleNote)).toEqual([-9, -7, -5, -2, 0, 3, 5])
  })

  it('rings higher for every bigger 2048 tile', () => {
    const values = [4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096]
    const pitches = values.map(mergeHz)
    pitches.slice(1).forEach((p, i) => expect(p).toBeGreaterThan(pitches[i]))
  })
})
