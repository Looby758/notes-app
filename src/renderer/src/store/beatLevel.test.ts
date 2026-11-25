import { describe, expect, it, vi } from 'vitest'

vi.mock('./music', () => ({ useMusic: { getState: () => ({}), setState: () => undefined } }))
vi.mock('./musicData', () => ({ recordPlay: () => undefined }))
vi.mock('./prefs', () => ({ usePrefs: { getState: () => ({ prefs: {} }), subscribe: () => () => undefined } }))

const { beatLevel } = await import('./localMusic')

describe('visualiser levels', () => {
  it('moves a lot with the beat even when the song stays loud', () => {
    const low = new Float32Array(1).fill(1)
    const high = new Float32Array(1)
    const seen: number[] = []
    // A loud song (0.8) with a small beat on top (±0.06), for ten seconds at 60 frames a second.
    for (let f = 0; f < 600; f++) seen.push(beatLevel(0.8 + (f % 30 < 5 ? 0.06 : -0.02), 0, low, high))
    const last = seen.slice(-120)
    expect(Math.max(...last) - Math.min(...last)).toBeGreaterThan(0.5)
  })
  it('stays still in silence', () => {
    const low = new Float32Array(1).fill(1)
    const high = new Float32Array(1)
    for (let f = 0; f < 100; f++) expect(beatLevel(0, 0, low, high)).toBe(0)
  })
})
