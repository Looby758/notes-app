import { describe, expect, it } from 'vitest'
import { buildVectors, relatedTo, words } from './related'

const notes = [
  { path: 'Dentist.md', tags: ['medical'], links: ['Insurance.md'], text: 'Dentist appointment: cleaning, fillings and the hygienist. Bring insurance card.' },
  { path: 'Doctor.md', tags: ['medical'], links: [], text: 'Doctor visit about allergies.' },
  { path: 'Claims.md', tags: [], links: ['Insurance.md'], text: 'How to file a claim.' },
  { path: 'Teeth.md', tags: [], links: [], text: 'Hygienist said fillings fine; cleaning every six months. Fillings again maybe.' },
  { path: 'Recipes.md', tags: ['food'], links: [], text: 'Pasta with tomatoes and basil.' },
  { path: 'Insurance.md', tags: [], links: [], text: 'Policy numbers.' },
  { path: 'Links back.md', tags: ['medical'], links: ['Dentist.md'], text: 'see dentist' }
]

describe('related notes', () => {
  const vectors = buildVectors(notes)
  const result = relatedTo('Dentist.md', notes, vectors)
  const paths = result.map((r) => r.path)
  it('finds notes with shared tags, shared links and similar words', () => {
    expect(paths).toContain('Doctor.md')
    expect(paths).toContain('Claims.md')
    expect(paths).toContain('Teeth.md')
    expect(result.find((r) => r.path === 'Doctor.md')!.sharedTags).toEqual(['medical'])
    expect(result.find((r) => r.path === 'Claims.md')!.sharedLinks).toEqual(['Insurance.md'])
    expect(result.find((r) => r.path === 'Teeth.md')!.similarity).toBeGreaterThan(0.12)
  })
  it('leaves out unrelated notes and ones already linked', () => {
    expect(paths).not.toContain('Recipes.md')
    expect(paths).not.toContain('Insurance.md')
    expect(paths).not.toContain('Links back.md')
  })
  it('ignores common words and markdown', () => {
    expect(words('The [[Link]] and https://x.com with fillings')).toEqual(['fillings'])
  })
})
