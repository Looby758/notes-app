import { describe, expect, it } from 'vitest'
import { findMentions, linkMentions } from './mentions'

const texts = (text: string, title: string): string[] => findMentions(text, title).map((m) => m.text)

describe('findMentions', () => {
  it('finds the exact name as a whole word, any capitalisation', () => {
    expect(texts('Called the Dentist. The dentist said hi.', 'Dentist')).toEqual(['Dentist', 'dentist'])
  })
  it('ignores other forms of the word', () => {
    expect(texts('Dentists, dentist’s chair, dentist\'s office, mydentist', 'Dentist')).toEqual([])
  })
  it('matches names with spaces and symbols', () => {
    expect(texts('Read Project Plan (v2) today', 'Project Plan (v2)')).toEqual(['Project Plan (v2)'])
  })
  it('skips mentions that are already links, embeds, tags, code, URLs or frontmatter', () => {
    const text = [
      '---',
      'title: Dentist',
      '---',
      '[[Dentist]] and [[Dentist appointment]] and ![[Dentist]]',
      '[the dentist](Dentist.md) #dentist `dentist`',
      'https://example.com/dentist <span>dentist</span>',
      '```',
      'dentist',
      '```',
      'Plain dentist here.'
    ].join('\n')
    const found = findMentions(text, 'Dentist')
    expect(found.map((m) => [m.text, m.line])).toEqual([
      ['dentist', 5],
      ['dentist', 9]
    ])
  })
  it('gives the line around each mention', () => {
    const [m] = findMentions('first\nsee the Plan now', 'Plan')
    expect(m.snippet).toBe('see the Plan now')
    expect(m.snippet.slice(m.snipFrom, m.snipTo)).toBe('Plan')
  })
  it('ignores one-letter names', () => {
    expect(findMentions('a b c', 'a')).toEqual([])
  })
})

describe('linkMentions', () => {
  it('links every mention, keeping how it was written', () => {
    expect(linkMentions('Dentist then dentist.', 'Dentist', 'Dentist')).toBe('[[Dentist]] then [[Dentist|dentist]].')
  })
  it('uses the full path when the name is not unique', () => {
    expect(linkMentions('see Plan', 'Plan', 'Work/Plan')).toBe('see [[Work/Plan|Plan]]')
  })
  it('links only the chosen mention', () => {
    expect(linkMentions('Plan, Plan, Plan', 'Plan', 'Plan', (_m, i) => i === 1)).toBe('Plan, [[Plan]], Plan')
  })
  it('returns null when there is nothing to link', () => {
    expect(linkMentions('[[Plan]]', 'Plan', 'Plan')).toBeNull()
  })
})
