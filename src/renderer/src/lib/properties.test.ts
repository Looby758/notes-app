import { describe, expect, it } from 'vitest'
import { kindOf, parseProperties, readFrontmatter, renameProperty, setProperty, yamlValue } from './properties'

describe('parseProperties', () => {
  it('reads values, inline lists and dash lists', () => {
    const props = parseProperties('date: 2026-10-26\ntags: [work, "a, b"]\npeople:\n  - Sam\n  - Alex\ntitle: "Hi: there"\nempty:')
    expect(props.map((p) => [p.key, p.value, p.listStyle])).toEqual([
      ['date', '2026-10-26', undefined],
      ['tags', ['work', 'a, b'], 'inline'],
      ['people', ['Sam', 'Alex'], 'block'],
      ['title', 'Hi: there', undefined],
      ['empty', '', undefined]
    ])
  })
  it('leaves anything more complicated alone', () => {
    const [p] = parseProperties('meta:\n  a: 1\n  b: 2')
    expect(p.value).toBeNull()
    expect(p.raw).toBe('meta:\n  a: 1\n  b: 2')
  })
})

describe('readFrontmatter', () => {
  it('finds the block and where it ends', () => {
    const text = '---\nstatus: done\n---\n# Note\n'
    const fm = readFrontmatter(text)!
    expect(fm.yaml).toBe('status: done')
    expect(text.slice(fm.to)).toBe('# Note\n')
  })
  it('returns null without one', () => {
    expect(readFrontmatter('# Note\n---\n')).toBeNull()
  })
})

describe('setProperty', () => {
  const note = '---\ndate: 2026-10-26\n# a comment\npeople:\n  - Sam\n---\n# Note\n'
  it('changes one property and keeps everything else', () => {
    expect(setProperty(note, 'date', '2026-11-01')).toBe('---\ndate: 2026-11-01\n# a comment\npeople:\n  - Sam\n---\n# Note\n')
  })
  it('keeps the list style', () => {
    expect(setProperty(note, 'people', ['Sam', 'Alex'])).toBe('---\ndate: 2026-10-26\n# a comment\npeople:\n  - Sam\n  - Alex\n---\n# Note\n')
  })
  it('adds new properties at the end', () => {
    expect(setProperty(note, 'tags', ['medical'])).toBe('---\ndate: 2026-10-26\n# a comment\npeople:\n  - Sam\ntags: [medical]\n---\n# Note\n')
  })
  it('removes a property', () => {
    expect(setProperty(note, 'people', undefined)).toBe('---\ndate: 2026-10-26\n# a comment\n---\n# Note\n')
  })
  it('creates the block when there is none, and drops it when empty', () => {
    const added = setProperty('# Note\n', 'status', 'to do')
    expect(added).toBe('---\nstatus: to do\n---\n\n# Note\n')
    expect(setProperty(added, 'status', undefined)).toBe('# Note\n')
  })
  it('quotes values YAML would misread', () => {
    expect(yamlValue('a: b')).toBe('"a: b"')
    expect(yamlValue('yes')).toBe('"yes"')
    expect(yamlValue('#hash')).toBe('"#hash"')
    expect(yamlValue('plain words')).toBe('plain words')
  })
})

describe('renameProperty', () => {
  it('keeps the value and position', () => {
    expect(renameProperty('---\na: 1\nb: 2\n---\n', 'a', 'c')).toBe('---\nc: 1\nb: 2\n---\n')
  })
})

describe('kindOf', () => {
  it('picks a control from the name and value', () => {
    expect(kindOf({ key: 'tags', value: [] })).toBe('tags')
    expect(kindOf({ key: 'due', value: '' })).toBe('date')
    expect(kindOf({ key: 'whenever', value: '2026-01-02' })).toBe('date')
    expect(kindOf({ key: 'status', value: 'done' })).toBe('status')
    expect(kindOf({ key: 'priority', value: 'high' })).toBe('priority')
    expect(kindOf({ key: 'published', value: 'true' })).toBe('checkbox')
    expect(kindOf({ key: 'rating', value: '4' })).toBe('number')
    expect(kindOf({ key: 'source', value: 'https://x.com' })).toBe('link')
    expect(kindOf({ key: 'people', value: 'Sam' })).toBe('list')
    expect(kindOf({ key: 'notes', value: 'hi' })).toBe('text')
  })
})
