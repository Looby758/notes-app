import { beforeAll, describe, expect, it } from 'vitest'
import { buildDictionary } from '../../scripts/dictionaryPlugin'
import { addEnding, baseForms, lookUp, matchCase, readDictionary, splitGloss, type DictionaryData } from './dictionary'

let data: DictionaryData
beforeAll(() => {
  data = readDictionary(buildDictionary())
}, 60_000)

const synonymsOf = (word: string): string[] => lookUp(data, word)?.synonyms.map((s) => s.replacement!) ?? []

describe('looking words up', () => {
  it('finds a word and its meaning', () => {
    const entry = lookUp(data, 'happy')!
    expect(entry.lemma).toBe('happy')
    expect(entry.senses[0]).toMatchObject({ pos: 'a', definition: 'enjoying or showing or marked by joy or pleasure' })
    expect(entry.senses[0].examples.length).toBeGreaterThan(0)
    expect(synonymsOf('happy')).toContain('glad')
  })

  it('finds the dictionary form of regular and irregular forms', () => {
    expect(lookUp(data, 'running')!.lemma).toBe('run')
    expect(lookUp(data, 'ideas')!.lemma).toBe('idea')
    expect(lookUp(data, 'went')!.lemma).toBe('go')
    expect(lookUp(data, 'mice')!.lemma).toBe('mouse')
    expect(lookUp(data, 'bigger')!.lemma).toBe('big')
  })

  it('puts the most used meaning first', () => {
    // "saw" is far more often the past of "see" than the tool.
    expect(lookUp(data, 'saw')!.lemma).toBe('see')
    expect(lookUp(data, 'saw')!.senses.some((s) => s.definition.includes('cutting'))).toBe(true)
  })

  it('looks up phrases, names and possessives', () => {
    expect(lookUp(data, 'ice cream')!.lemma).toBe('ice cream')
    expect(lookUp(data, 'Paris')!.senses[0].definition).toContain('France')
    expect(lookUp(data, "dog's")!.lemma).toBe('dog')
  })

  it('returns null for words it does not know', () => {
    expect(lookUp(data, 'the')).toBeNull()
    expect(lookUp(data, 'asdfgh')).toBeNull()
    expect(lookUp(data, '')).toBeNull()
    // Not mistaken for the built-in parts of every JavaScript object.
    expect(lookUp(data, 'toString')).toBeNull()
    expect(lookUp(data, '__proto__')).toBeNull()
  })
})

describe('fitting synonyms into the sentence', () => {
  it('gives synonyms the same ending as the word', () => {
    expect(synonymsOf('ideas')).toContain('thoughts')
    expect(synonymsOf('stopped')).toEqual(expect.arrayContaining(['halted', 'ceased', 'gave up']))
    expect(synonymsOf('went')).toEqual(expect.arrayContaining(['travelled', 'moved']))
    expect(synonymsOf('hopping')).toContain('skipping')
    expect(synonymsOf('children')).toContain('kids')
    expect(synonymsOf('dogs')).toContain('goes after')
  })

  it('compares long words with more and most', () => {
    expect(synonymsOf('bigger')).toEqual(expect.arrayContaining(['larger', 'more sizable']))
    expect(synonymsOf('tinier')).toEqual(expect.arrayContaining(['smaller', 'littler']))
  })

  it('keeps capitals', () => {
    expect(synonymsOf('Happy')).toContain('Glad')
    expect(synonymsOf('HAPPY')).toContain('GLAD')
  })

  it('leaves out synonyms it cannot fit in', () => {
    // A name can't become plural.
    expect(synonymsOf('dogs').some((s) => s.startsWith('Canis'))).toBe(false)
    // Gave or given? Not guessed.
    expect(synonymsOf('stopped')).not.toContain('gived up')
  })
})

describe('the pieces', () => {
  it('adds endings', () => {
    expect(['stop', 'run', 'make', 'try', 'play', 'lie', 'visit', 'go'].map((w) => addEnding(w, 'ing'))).toEqual([
      'stopping', 'running', 'making', 'trying', 'playing', 'lying', 'visiting', 'going'
    ])
    expect(['stop', 'try', 'play', 'like'].map((w) => addEnding(w, 'ed'))).toEqual(['stopped', 'tried', 'played', 'liked'])
    expect(['box', 'city', 'day', 'dog'].map((w) => addEnding(w, 's'))).toEqual(['boxes', 'cities', 'days', 'dogs'])
    expect(addEnding('go', 's', 'v')).toBe('goes')
    expect(addEnding('hop-skip', 'ing')).toBe('hop-skipping')
    expect(['big', 'nice', 'happy'].map((w) => addEnding(w, 'er'))).toEqual(['bigger', 'nicer', 'happier'])
  })

  it('lists the forms a word could come from', () => {
    expect(baseForms('Boxes', { x: {} })).toEqual(expect.arrayContaining(['boxes', 'box']))
    expect(baseForms('went', { x: { went: [['v', 'go']] } })[1]).toBe('go')
  })

  it('splits definitions from examples', () => {
    expect(splitGloss('move fast; "Don\'t run!"; "She ran to the store"')).toEqual({
      definition: 'move fast',
      examples: ["Don't run!", 'She ran to the store']
    })
  })

  it('matches capitals', () => {
    expect(matchCase('Quick', 'fast')).toBe('Fast')
    expect(matchCase('QUICK', 'fast')).toBe('FAST')
    expect(matchCase('quick', 'fast')).toBe('fast')
    expect(matchCase('A', 'one')).toBe('One')
  })
})
