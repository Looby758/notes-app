import { describe, expect, it } from 'vitest'
import { activeGains, cleanEq, DEFAULT_EQ, eqFromPreset, eqWithBand, EQ_BANDS, EQ_PRESETS, fadeCurve, fadeLength, nextVisualiser, presetPreamp, shouldCrossfade } from './musicSound'

describe('equaliser', () => {
  it('has a gain for every band in every preset', () => {
    for (const p of EQ_PRESETS) expect(p.bands).toHaveLength(EQ_BANDS.length)
  })
  it('makes room for boosts with the preamp', () => {
    expect(presetPreamp([6, 0, 0])).toBe(-3.6)
    expect(presetPreamp([-3, -2])).toBe(0)
    expect(eqFromPreset('bass')).toMatchObject({ on: true, preset: 'bass', preamp: -3.6 })
  })
  it('becomes custom when a band is moved, and keeps it in range', () => {
    const eq = eqWithBand(eqFromPreset('rock'), 2, 40)
    expect(eq.preset).toBe('custom')
    expect(eq.bands[2]).toBe(12)
    expect(eqWithBand(eq, 99, 3)).toBe(eq)
  })
  it('repairs a broken saved equaliser', () => {
    expect(cleanEq(null)).toEqual(DEFAULT_EQ)
    const eq = cleanEq({ on: true, preset: 'nope', bands: [3, 'x', 99], preamp: -50 })
    expect(eq.preset).toBe('custom')
    expect(eq.bands).toEqual([3, 0, 12, 0, 0, 0, 0, 0, 0, 0])
    expect(eq.preamp).toBe(-12)
  })
  it('is flat while off', () => {
    expect(activeGains({ ...eqFromPreset('bass'), on: false })).toEqual({ bands: EQ_BANDS.map(() => 0), preamp: 0 })
  })
})

describe('crossfade', () => {
  it('is never more than a third of either song', () => {
    expect(fadeLength(8, 240, 200)).toBe(8)
    expect(fadeLength(8, 15, 200)).toBe(5)
    expect(fadeLength(8, 200, 9)).toBe(3)
    expect(fadeLength(0, 200, 200)).toBe(0)
  })
  it('starts once the end is within the fade', () => {
    const base = { fade: 6, duration: 200, repeatOne: false, hasNext: true }
    expect(shouldCrossfade({ ...base, position: 150 })).toBe(false)
    expect(shouldCrossfade({ ...base, position: 194.5 })).toBe(true)
    expect(shouldCrossfade({ ...base, position: 195, repeatOne: true })).toBe(false)
    expect(shouldCrossfade({ ...base, position: 195, hasNext: false })).toBe(false)
    expect(shouldCrossfade({ ...base, position: 195, duration: NaN })).toBe(false)
  })
  it('keeps the loudness steady through the fade', () => {
    const a = fadeCurve(33, 'in')
    const b = fadeCurve(33, 'out')
    expect(a[0]).toBe(0)
    expect(b[0]).toBe(1)
    for (let i = 0; i < 33; i++) expect(a[i] ** 2 + b[i] ** 2).toBeCloseTo(1, 5)
  })
})

it('cycles through the visualisers', () => {
  expect(nextVisualiser('bars')).toBe('wave')
  expect(nextVisualiser('dots')).toBe('bars')
})
