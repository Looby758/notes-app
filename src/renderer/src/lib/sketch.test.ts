import { describe, expect, it } from 'vitest'
import { emptySketch, looksLikeSketch, paperLines, parseSketch, sketchFileName, sketchToSvg, strokeHits, strokePath, type Sketch } from './sketch'

const drawing = (): Sketch => ({
  ...emptySketch('grid'),
  strokes: [
    { tool: 'pen', color: '#1f2328', size: 4, points: [10, 10, 0.5, 50.04, 12, 0.8, 90, 40, 1] },
    { tool: 'highlighter', color: '#ffd43b', size: 24, points: [100, 100, 1, 300, 100, 1] }
  ]
})

describe('sketch files', () => {
  it('saves a picture that can be opened again for editing', () => {
    const svg = sketchToSvg(drawing())
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1600" height="1000"/)
    expect(svg).toContain('fill-opacity="0.35"')
    const back = parseSketch(svg)!
    expect(back.paper).toBe('grid')
    expect(back.strokes).toHaveLength(2)
    expect(back.strokes[0].points).toEqual([10, 10, 0.5, 50, 12, 0.8, 90, 40, 1])
    expect(back.strokes[1].tool).toBe('highlighter')
  })
  it('keeps odd colour text from breaking the file', () => {
    const s = drawing()
    s.strokes[0].color = '"><script>'
    const svg = sketchToSvg(s)
    expect(svg).not.toContain('<script>')
    expect(parseSketch(svg)!.strokes[0].color).toBe('"><script>')
  })
  it("says no to pictures that weren't drawn in Notes", () => {
    expect(parseSketch('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toBeNull()
    expect(parseSketch('<svg><metadata id="notes-sketch">not json</metadata></svg>')).toBeNull()
  })
  it('names sketches so they can be found', () => {
    expect(sketchFileName(new Date(2026, 9, 27, 14, 5, 9))).toBe('Sketch 2026-10-27 14-05-09.svg')
    expect(looksLikeSketch('attachments/Sketch 2026-10-27 14-05-09.svg')).toBe(true)
    expect(looksLikeSketch('attachments/logo.svg')).toBe(false)
    expect(looksLikeSketch('Sketches/logo.png')).toBe(false)
  })
})

describe('strokes', () => {
  it('draws a dot for a single tap', () => {
    expect(strokePath({ tool: 'pen', color: '#000', size: 4, points: [5, 5, 1] })).toMatch(/^M3 5a2 2 /)
    expect(strokePath({ tool: 'pen', color: '#000', size: 4, points: [] })).toBe('')
  })
  it('outlines a line as a closed shape', () => {
    const d = strokePath(drawing().strokes[0])
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(d).not.toContain('NaN')
  })
  it('lets the eraser find lines near the pointer', () => {
    const line = drawing().strokes[1]
    expect(strokeHits(line, 200, 105, 10)).toBe(true)
    expect(strokeHits(line, 200, 140, 10)).toBe(false)
  })
})

describe('paper', () => {
  it('prints squares or lines', () => {
    expect(paperLines({ width: 100, height: 100, paper: 'plain' })).toEqual([])
    expect(paperLines({ width: 100, height: 100, paper: 'grid' })).toHaveLength(4)
    expect(paperLines({ width: 100, height: 200, paper: 'lined' }).length).toBeGreaterThan(1)
  })
})
