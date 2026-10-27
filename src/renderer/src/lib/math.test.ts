import { describe, expect, it } from 'vitest'
import { findMathBlocks, INLINE_MATH } from './math'

const inline = (s: string): string[] => [...s.matchAll(INLINE_MATH)].map((m) => m[1])

describe('inline maths', () => {
  it('finds formulas in a sentence', () => {
    expect(inline('Area is $\\pi r^2$ and $x$ too')).toEqual(['\\pi r^2', 'x'])
  })
  it('leaves prices alone', () => {
    expect(inline('It costs $5 and $10, or US$20')).toEqual([])
    expect(inline('Between $ 1 $ and $$')).toEqual([])
  })
  it('skips escaped dollars', () => {
    expect(inline('\\$x$ is not maths')).toEqual([])
    expect(inline('$a \\$ b$')).toEqual(['a \\$ b'])
  })
})

describe('maths blocks', () => {
  it('finds one-line and multi-line blocks', () => {
    const lines = ['Intro', '$$ E = mc^2 $$', '', '$$', 'a^2 +', 'b^2', '$$', 'end']
    expect(findMathBlocks(lines)).toEqual([
      { startLine: 1, endLine: 1, tex: 'E = mc^2' },
      { startLine: 3, endLine: 6, tex: 'a^2 +\nb^2' }
    ])
  })
  it('ignores code blocks and unclosed blocks', () => {
    expect(findMathBlocks(['```', '$$x$$', '```', '$$', 'never closed'])).toEqual([])
  })
})
