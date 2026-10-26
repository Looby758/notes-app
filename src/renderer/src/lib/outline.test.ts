import { describe, expect, it } from 'vitest'
import { currentHeadingIndex, extractHeadings, extractSection, withoutFrontmatter } from './outline'

describe('extractSection', () => {
  const text = '# Plan\nintro\n## Goals\nship it\n### Detail\nmore\n## Risks\nnone\n'
  it('takes a heading down to the next one at the same or higher level', () => {
    expect(extractSection(text, 'goals')).toBe('## Goals\nship it\n### Detail\nmore')
    expect(extractSection(text, 'Risks')).toBe('## Risks\nnone')
    expect(extractSection(text, 'Plan')).toBe(text.trimEnd())
  })
  it('returns null for a missing heading', () => {
    expect(extractSection(text, 'Nope')).toBeNull()
  })
  it('strips frontmatter', () => {
    expect(withoutFrontmatter('---\ntags: [a]\n---\nBody')).toBe('Body')
    expect(withoutFrontmatter('No frontmatter')).toBe('No frontmatter')
  })
})

describe('extractHeadings', () => {
  it('finds headings with levels and offsets', () => {
    const text = '# One\ntext\n## Two ##\n### **Three** [[Plan|idea]]'
    const h = extractHeadings(text)
    expect(h.map((x) => [x.level, x.text])).toEqual([
      [1, 'One'],
      [2, 'Two'],
      [3, 'Three idea']
    ])
    expect(text.slice(h[1].from).startsWith('## Two')).toBe(true)
  })

  it('skips code blocks, frontmatter and #tags', () => {
    const text = '---\ntitle: x\n---\n# Real\n```\n# not a heading\n```\n#tag line\n~~~\n## nope\n~~~\n## Also real'
    expect(extractHeadings(text).map((h) => h.text)).toEqual(['Real', 'Also real'])
  })
})

describe('currentHeadingIndex', () => {
  const h = extractHeadings('intro\n# A\naaa\n# B\nbbb')
  it('picks the heading at or before the cursor', () => {
    expect(currentHeadingIndex(h, 0)).toBe(-1)
    expect(currentHeadingIndex(h, h[0].from)).toBe(0)
    expect(currentHeadingIndex(h, h[1].from + 3)).toBe(1)
  })
})
