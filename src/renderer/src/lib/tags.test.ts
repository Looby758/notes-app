import { describe, expect, it } from 'vitest'
import { parseFrontmatter, parseTags, tagMatches } from './tags'
import { fuzzyFilter, fuzzyMatch } from './fuzzy'

describe('parseTags', () => {
  it('finds inline tags', () => {
    expect(parseTags('Ideas #work and #project/alpha, (#urgent)')).toEqual(['work', 'project/alpha', 'urgent'])
  })

  it('ignores headings, numbers, URL anchors and code', () => {
    const text = '# Heading\n## Sub\nIssue #42 see page#anchor\n`#notatag`\n```\n#alsonot\n```\n#real'
    expect(parseTags(text)).toEqual(['real'])
  })

  it('dedupes case-insensitively, keeping the first spelling', () => {
    expect(parseTags('#Work #work #WORK')).toEqual(['Work'])
  })

  it('reads frontmatter tags in all common forms', () => {
    expect(parseTags('---\ntags: [a, "b"]\n---\nbody #c')).toEqual(['a', 'b', 'c'])
    expect(parseTags('---\ntags: x, y\n---\n')).toEqual(['x', 'y'])
    expect(parseTags('---\ntitle: T\ntags:\n  - one\n  - "#two"\n---\n')).toEqual(['one', 'two'])
  })

  it('does not treat frontmatter keys as tags or #s inside it as inline tags', () => {
    expect(parseTags('---\ncolor: "#fff000"\n---\ntext')).toEqual([])
  })
})

describe('parseFrontmatter', () => {
  it('returns where the body starts', () => {
    const text = '---\na: 1\n---\nBody'
    expect(text.slice(parseFrontmatter(text).end)).toBe('Body')
  })

  it('needs frontmatter to be at the very top and closed', () => {
    expect(parseFrontmatter('text\n---\na: 1\n---').end).toBe(0)
    expect(parseFrontmatter('---\nnever closed').end).toBe(0)
  })
})

describe('tagMatches', () => {
  it('matches nested tags under a parent', () => {
    expect(tagMatches('project/alpha', 'project')).toBe(true)
    expect(tagMatches('Project', 'project')).toBe(true)
    expect(tagMatches('projects', 'project')).toBe(false)
  })
})

describe('fuzzy', () => {
  it('requires characters in order', () => {
    expect(fuzzyMatch('pln', 'Plan')).not.toBeNull()
    expect(fuzzyMatch('npl', 'Plan')).toBeNull()
  })

  it('ranks word-start and consecutive matches higher', () => {
    const ranked = fuzzyFilter(['Reading list', 'Meeting notes', 'Monthly notes'], 'mn', (s) => s).map((r) => r.item)
    expect(ranked[0]).toBe('Meeting notes')
    const exact = fuzzyFilter(['Topography', 'Top ideas', 'Stop'], 'top', (s) => s).map((r) => r.item)
    expect(exact.slice(0, 2)).toEqual(['Top ideas', 'Topography'])
  })
})
