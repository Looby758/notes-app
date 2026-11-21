import { describe, expect, it } from 'vitest'
import { buildShots, cueTimes, fineClock, parseClock, readCues, readShotOverrides, shotListText, shotMarkers, shotOverridesJson } from './shotList'
import { lineUp } from './transcript'
import type { SpokenWord } from '@shared/transcribe'

const said = (text: string, start = 0): SpokenWord[] =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => ({ w, s: start + i * 0.5, e: start + i * 0.5 + 0.4 }))

const script = '[SECTION: Prison]\nRick wakes up [IMAGE: rick.png] in the hospital.\n[CLIP: corridor] He walks out [IMAGE: rick.png] alone. [PAUSE]\n[NOTE: skip]'

describe('shotMarkers', () => {
  it('keeps pictures, clips and sections, with keys that tell repeats apart', () => {
    expect(shotMarkers(script).map((m) => m.key)).toEqual(['SECTION:prison#1', 'IMAGE:rick.png#1', 'CLIP:corridor#1', 'IMAGE:rick.png#2'])
  })
})

describe('buildShots', () => {
  const heard = said('Rick wakes up in the hospital. He walks out alone.')

  it('times shots from the transcript, and works out how long each is on screen', () => {
    const shots = buildShots(script, { lined: lineUp(script, heard), length: 10 })
    expect(shots.map((s) => [s.key, s.time, s.source])).toEqual([
      ['SECTION:prison#1', 0, 'transcript'],
      ['IMAGE:rick.png#1', 1.5, 'transcript'],
      ['CLIP:corridor#1', 3, 'transcript'],
      ['IMAGE:rick.png#2', 4.5, 'transcript']
    ])
    expect(shots[1].length).toBe(1.5)
    expect(shots[3].length).toBe(5.5)
    expect(shots[0].length).toBeNull()
  })

  it('uses the teleprompter when there is no transcript, and your times over both', () => {
    const cues = [
      { at: 31, marker: '[IMAGE: rick.png]', t: 2 },
      { at: 80, marker: '[IMAGE:  rick.png]', t: 6 },
      { at: 60, marker: '[CLIP: corridor]', t: 4 }
    ]
    const shots = buildShots(script, { cues, overrides: { 'CLIP:corridor#1': 3.25 } })
    expect(shots.map((s) => [s.time, s.source])).toEqual([
      [null, null],
      [2, 'teleprompter'],
      [3.25, 'you'],
      [6, 'teleprompter']
    ])
    // Preferring the teleprompter over the transcript.
    const both = buildShots(script, { lined: lineUp(script, heard), cues, prefer: 'teleprompter' })
    expect(both[1]).toMatchObject({ time: 2, source: 'teleprompter' })
    expect(both[0]).toMatchObject({ time: 0, source: 'transcript' })
  })

  it('matches cues to the nearest marker with the same text after the script changed', () => {
    const markers = shotMarkers(script)
    const t = cueTimes(script, markers, [{ at: 500, marker: '[IMAGE: rick.png]', t: 9 }])
    expect(t.get(markers[1].from)).toBe(9)
    expect(t.has(markers[3].from)).toBe(false)
  })

  it('writes it out as text', () => {
    const shots = buildShots(script, { lined: lineUp(script, heard) })
    expect(shotListText(shots, 'My video')).toBe('My video\n\n0:00  Prison\n0:01 – rick.png\n0:03 – Clip: corridor\n0:04 – rick.png\n')
  })
})

describe('files', () => {
  it('reads cues and your times, leaving broken bits out', () => {
    expect(readCues('{"version":1,"script":"a.md","cues":[{"at":1,"marker":"[PAUSE]","t":2},{"at":"x"}]}')).toEqual([{ at: 1, marker: '[PAUSE]', t: 2 }])
    expect(readCues('nope')).toBeNull()
    const o = { times: { 'IMAGE:a.png#1': 3 }, prefer: 'teleprompter' as const }
    expect(readShotOverrides(shotOverridesJson(o))).toEqual(o)
    expect(readShotOverrides('{"times":{"a":-1,"b":"2"}}')).toEqual({ times: {} })
  })

  it('reads times typed in', () => {
    expect(parseClock('1:05')).toBe(65)
    expect(parseClock('65.5')).toBe(65.5)
    expect(parseClock('1:02:03')).toBe(3723)
    expect(parseClock('soon')).toBeNull()
    expect(fineClock(65.44)).toBe('1:05.4')
    expect(parseClock(fineClock(3.25))).toBe(3.3)
  })
})
