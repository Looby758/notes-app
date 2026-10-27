import { describe, expect, it } from 'vitest'
import { answerParts, pickContext, splitFrontmatter, withSummary, withTidiedBody } from './ai'

describe('splitFrontmatter', () => {
  it('keeps properties apart from the body', () => {
    expect(splitFrontmatter('---\ntags: [a]\n---\nHello')).toEqual({ head: '---\ntags: [a]\n---\n', body: 'Hello' })
    expect(splitFrontmatter('Just text')).toEqual({ head: '', body: 'Just text' })
  })
})

describe('withSummary', () => {
  it('adds a summary callout under the properties', () => {
    expect(withSummary('---\ntags: [a]\n---\n\nBody', 'One.\n\n- Two')).toBe('---\ntags: [a]\n---\n> [!summary] Summary\n> One.\n>\n> - Two\n\nBody')
  })
  it('works on a note without properties', () => {
    expect(withSummary('Body\n', 'Short.')).toBe('> [!summary] Summary\n> Short.\n\nBody\n')
  })
})

describe('withTidiedBody', () => {
  it('replaces the body and keeps the properties', () => {
    expect(withTidiedBody('---\na: 1\n---\nmessy txt\n', '  Messy text.  ')).toBe('---\na: 1\n---\nMessy text.\n')
  })
})

describe('pickContext', () => {
  it('stops at the budget and cuts the last note', () => {
    const notes = [{ text: 'a'.repeat(6) }, { text: '   ' }, { text: 'b'.repeat(10) }, { text: 'c' }]
    expect(pickContext(notes, 10).map((n) => n.text)).toEqual(['aaaaaa', 'bbbb\n…'])
  })
  it('caps the number of notes', () => {
    expect(pickContext([{ text: 'a' }, { text: 'b' }, { text: 'c' }], 100, 2)).toHaveLength(2)
  })
})

describe('answerParts', () => {
  it('finds [[links]], with headings and shown text', () => {
    expect(answerParts('See [[Trip plans]] and [[Budget#June|the budget]].')).toEqual([
      { text: 'See ' },
      { link: 'Trip plans', label: 'Trip plans' },
      { text: ' and ' },
      { link: 'Budget', label: 'the budget' },
      { text: '.' }
    ])
  })
  it('leaves plain answers alone', () => {
    expect(answerParts('No idea.')).toEqual([{ text: 'No idea.' }])
  })
})
