import { describe, expect, it } from 'vitest'
import { clock, dropRepeats, isSilent, piecesWords, quietCuts, SAMPLE_RATE } from './transcribe'

describe('quietCuts', () => {
  it('cuts long recordings at a quiet moment near each cut', () => {
    // 5 minutes of a tone with a quiet second at 2:03.
    const samples = new Float32Array(300 * SAMPLE_RATE)
    for (let i = 0; i < samples.length; i++) samples[i] = 0.3 * Math.sin(i / 10)
    samples.fill(0, 123 * SAMPLE_RATE, 124 * SAMPLE_RATE)
    const cuts = quietCuts(samples)
    expect(cuts[0]).toBe(0)
    expect(cuts[1] / SAMPLE_RATE).toBeGreaterThanOrEqual(123)
    expect(cuts[1] / SAMPLE_RATE).toBeLessThanOrEqual(124)
    expect(cuts.length).toBe(3)
  })

  it('leaves a short recording whole', () => {
    expect(quietCuts(new Float32Array(30 * SAMPLE_RATE))).toEqual([0])
  })
})

describe('words from Whisper', () => {
  it('moves them to where the piece starts and fills in missing times', () => {
    const words = piecesWords(
      [
        { text: ' Hello', timestamp: [0.5, 0.9] },
        { text: ' ', timestamp: [1, 1] },
        { text: ' there.', timestamp: [1, null] }
      ],
      120,
      10
    )
    expect(words).toEqual([
      { w: 'Hello', s: 120.5, e: 120.9 },
      { w: 'there.', s: 121, e: 121.3 }
    ])
  })

  it('cuts a stuck repeat down to one', () => {
    const w = (t: string) => ({ w: t, s: 0, e: 0 })
    const words = ['so', ...Array(8).fill(['thank', 'you.']).flat(), 'bye'].map(w)
    expect(dropRepeats(words).map((x) => x.w)).toEqual(['so', 'thank', 'you.', 'bye'])
    const fine = ['very', 'very', 'good'].map(w)
    expect(dropRepeats(fine)).toEqual(fine)
  })

  it('tells silence', () => {
    expect(isSilent(new Float32Array(SAMPLE_RATE))).toBe(true)
    const loud = new Float32Array(SAMPLE_RATE)
    loud[100] = 0.5
    loud.fill(0.2, 8000, 8800)
    expect(isSilent(loud)).toBe(false)
  })

  it('writes times as a clock', () => {
    expect(clock(65.7)).toBe('1:05')
    expect(clock(3723)).toBe('1:02:03')
  })
})
