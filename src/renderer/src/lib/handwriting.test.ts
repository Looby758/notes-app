import { describe, expect, it } from 'vitest'
import { cleanReading } from '@shared/handwriting'
import { inkBox, pickReader } from './handwriting'
import { emptySketch, type Stroke } from './sketch'

const pen = (points: number[], size = 4): Stroke => ({ tool: 'pen', color: '#000', size, points })

describe('pickReader', () => {
  it('uses the AI helper when set up, else offline', () => {
    expect(pickReader('auto', true)).toBe('ai')
    expect(pickReader('auto', false)).toBe('offline')
    expect(pickReader('offline', true)).toBe('offline')
    expect(pickReader('ai', false)).toBe('ai')
  })
})

describe('inkBox', () => {
  it('fits the pen lines with a margin', () => {
    const s = { ...emptySketch(), strokes: [pen([100, 200, 1, 300, 250, 1])] }
    expect(inkBox(s, 10)).toEqual({ x: 88, y: 188, width: 224, height: 74 })
  })
  it('stays on the page', () => {
    const s = { ...emptySketch(), strokes: [pen([2, 3, 1, 1598, 998, 1])] }
    expect(inkBox(s)).toEqual({ x: 0, y: 0, width: 1600, height: 1000 })
  })
  it('ignores the highlighter, and is null with no writing', () => {
    expect(inkBox(emptySketch())).toBeNull()
    const s = { ...emptySketch(), strokes: [{ ...pen([10, 10, 1, 50, 50, 1]), tool: 'highlighter' as const }] }
    expect(inkBox(s)).toBeNull()
  })
})

describe('cleanReading', () => {
  it('tidies spaces, specks and blank lines', () => {
    expect(cleanReading('  Buy   milk \r\n.\n\n\n\n- eggs\n , \n')).toBe('Buy milk\n\n- eggs')
  })
  it('keeps numbers and other languages', () => {
    expect(cleanReading('3x + 2 = 11\nCafé crème')).toBe('3x + 2 = 11\nCafé crème')
  })
})
