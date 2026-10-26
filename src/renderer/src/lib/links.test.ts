import { describe, expect, it } from 'vitest'
import { maskCode, NoteLookup, parseLinks, parseWikiInner, relativePath, rewriteFileLinks, rewriteLinks } from './links'
import { replacePrefix } from './paths'

describe('parseLinks', () => {
  it('finds wikilinks with headings and aliases', () => {
    const links = parseLinks('See [[Plan]] and [[Projects/Road map#Q3|the roadmap]].')
    expect(links.map((l) => [l.kind, l.target])).toEqual([
      ['wiki', 'Plan'],
      ['wiki', 'Projects/Road map']
    ])
  })

  it('finds relative markdown links but not web links or images', () => {
    const links = parseLinks('[a](notes/a.md) [b](../b) [web](https://x.com) ![img](pic.png) [pdf](f.pdf) [sp](<my note.md>)')
    expect(links.map((l) => l.target)).toEqual(['notes/a.md', '../b', 'my note.md'])
  })

  it('decodes %20 in markdown links', () => {
    expect(parseLinks('[x](My%20Note.md)')[0].target).toBe('My Note.md')
  })

  it('ignores links inside code', () => {
    const text = 'real [[A]]\n```\n[[NotALink]]\n```\nand `[[AlsoNot]]` but [[B]]'
    expect(parseLinks(text).map((l) => l.target)).toEqual(['A', 'B'])
  })

  it('reports line numbers and offsets', () => {
    const text = 'one\ntwo [[X]]'
    const [link] = parseLinks(text)
    expect(link.line).toBe(1)
    expect(text.slice(link.from, link.to)).toBe('[[X]]')
  })

  it('masks code without moving offsets', () => {
    const text = 'a `b` c\n```\nd\n```\ne'
    expect(maskCode(text).length).toBe(text.length)
  })
})

describe('parseWikiInner', () => {
  it('splits target, heading and alias', () => {
    expect(parseWikiInner('Note#Part|shown')).toEqual({ target: 'Note', heading: 'Part', alias: 'shown' })
    expect(parseWikiInner(' Note ')).toEqual({ target: 'Note', heading: '', alias: '' })
  })
})

describe('NoteLookup.resolve', () => {
  const lookup = new NoteLookup(['Plan.md', 'Projects/Plan.md', 'Projects/Ideas.md', 'Daily/2024-01-01.md'])

  it('resolves bare names, preferring the linking note’s folder', () => {
    expect(lookup.resolve({ kind: 'wiki', target: 'Ideas' }, 'Plan.md')).toBe('Projects/Ideas.md')
    expect(lookup.resolve({ kind: 'wiki', target: 'plan' }, 'Projects/Ideas.md')).toBe('Projects/Plan.md')
    expect(lookup.resolve({ kind: 'wiki', target: 'Plan' }, 'Daily/2024-01-01.md')).toBe('Plan.md')
  })

  it('resolves paths from the vault root', () => {
    expect(lookup.resolve({ kind: 'wiki', target: 'Projects/Plan' }, 'Plan.md')).toBe('Projects/Plan.md')
  })

  it('resolves markdown links relative to the note', () => {
    expect(lookup.resolve({ kind: 'md', target: '../Plan.md' }, 'Projects/Ideas.md')).toBe('Plan.md')
    expect(lookup.resolve({ kind: 'md', target: 'Ideas' }, 'Projects/Plan.md')).toBe('Projects/Ideas.md')
  })

  it('returns null for missing notes', () => {
    expect(lookup.resolve({ kind: 'wiki', target: 'Nope' }, 'Plan.md')).toBeNull()
  })
})

describe('relativePath', () => {
  it('walks up and down folders', () => {
    expect(relativePath('a/b', 'a/c/d.md')).toBe('../c/d.md')
    expect(relativePath('', 'x/y.md')).toBe('x/y.md')
    expect(relativePath('x', 'y.md')).toBe('../y.md')
    expect(relativePath('x', 'x/y.md')).toBe('y.md')
  })
})

describe('rewriteLinks', () => {
  const run = (paths: string[], text: string, source: string, from: string, to: string): string | null => {
    const before = new NoteLookup(paths)
    const after = new NoteLookup(paths.map((p) => replacePrefix(p, from, to)))
    return rewriteLinks(text, source, from, to, before, after)
  }

  it('renames bare wikilinks and keeps heading and alias', () => {
    expect(run(['A.md', 'Plan.md'], 'go [[Plan#Goals|plan]] now', 'A.md', 'Plan.md', 'Roadmap.md')).toBe(
      'go [[Roadmap#Goals|plan]] now'
    )
  })

  it('leaves bare wikilinks alone when a note only moves folder', () => {
    expect(run(['A.md', 'Plan.md'], '[[Plan]]', 'A.md', 'Plan.md', 'Archive/Plan.md')).toBeNull()
  })

  it('uses a path when the new name is ambiguous', () => {
    // "Road" at the root wins over X/Road for a note at the root, so the short form still works.
    expect(run(['A.md', 'Plan.md', 'X/Road.md'], '[[Plan]]', 'A.md', 'Plan.md', 'Road.md')).toBe('[[Road]]')
    expect(run(['A.md', 'Old.md', 'X/Road.md', 'Y/Road.md'], '[[Old]]', 'A.md', 'Old.md', 'Z/Road.md')).toBe('[[Z/Road]]')
  })

  it('updates path wikilinks when a folder is renamed', () => {
    expect(run(['A.md', 'Projects/Plan.md'], '[[Projects/Plan]]', 'A.md', 'Projects', 'Work')).toBe('[[Work/Plan]]')
  })

  it('updates markdown links when the target moves', () => {
    expect(run(['A.md', 'Plan.md'], '[p](Plan.md#x)', 'A.md', 'Plan.md', 'Sub/My Plan.md')).toBe('[p](Sub/My%20Plan.md#x)')
  })

  it('updates markdown links when the linking note itself moves', () => {
    expect(run(['A.md', 'Plan.md'], '[p](Plan.md)', 'A.md', 'A.md', 'Deep/A.md')).toBe('[p](../Plan.md)')
  })

  it('keeps angle brackets and extension-less style', () => {
    expect(run(['A.md', 'Plan.md'], '[p](<Plan>)', 'A.md', 'Plan.md', 'New Plan.md')).toBe('[p](<New Plan>)')
  })

  it('does not touch unrelated or broken links', () => {
    expect(run(['A.md', 'B.md', 'C.md'], '[[B]] [[Missing]] [c](C.md)', 'A.md', 'B.md', 'B2.md')).toBe(
      '[[B2]] [[Missing]] [c](C.md)'
    )
  })
})

describe('rewriteFileLinks', () => {
  const text = 'Pic ![Cat](attachments/Cat%20photo.png) and [doc](attachments/a.pdf)\n`![x](attachments/Cat%20photo.png)` [[Note]] [web](https://x.com/a.png)\n'
  it('follows a renamed file', () => {
    expect(rewriteFileLinks(text, 'Diary.md', 'attachments/Cat photo.png', 'attachments/Kitty.png')).toBe(
      'Pic ![Cat](attachments/Kitty.png) and [doc](attachments/a.pdf)\n`![x](attachments/Cat%20photo.png)` [[Note]] [web](https://x.com/a.png)\n'
    )
  })
  it('follows a renamed folder', () => {
    expect(rewriteFileLinks(text, 'Diary.md', 'attachments', 'media')).toContain('![Cat](media/Cat%20photo.png) and [doc](media/a.pdf)')
  })
  it('keeps links working when the note itself moves', () => {
    expect(rewriteFileLinks(text, 'Diary.md', 'Diary.md', 'Journal/Diary.md')).toContain('![Cat](../attachments/Cat%20photo.png)')
  })
  it('leaves notes that are not affected alone', () => {
    expect(rewriteFileLinks(text, 'Diary.md', 'other.png', 'x.png')).toBeNull()
  })
})