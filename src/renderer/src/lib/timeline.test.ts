import { describe, expect, it } from 'vitest'
import { emptyTimeline, entryMatches, entryScriptText, orderAt, parseCapture, readTimeline, sourceLabel, storyOrder, tellingOrder, timelineCharacters, timelineJson, type TimelineEntry } from './timeline'
import { findMarkers } from './script'

const entry = (over: Partial<TimelineEntry>): TimelineEntry => ({
  id: Math.random().toString(36).slice(2),
  text: '',
  characters: [],
  era: 'prison',
  order: 0,
  when: '',
  medium: 'show',
  episode: '',
  at: '',
  telling: 'shown',
  inbox: false,
  created: 0,
  updated: 0,
  ...over
})

describe('timeline file', () => {
  it('starts with the usual eras', () => {
    expect(readTimeline(null).eras.map((e) => e.id)).toContain('alexandria')
  })

  it('reads and writes entries, mending anything broken', () => {
    const data = readTimeline(
      JSON.stringify({
        eras: [{ id: 'farm', name: 'The farm' }, { id: 'farm', name: 'again' }, { name: 'no id' }],
        entries: [
          { id: 'a', text: 'Glenn meets Maggie', characters: ['Glenn', 'Maggie', 'Glenn'], era: 'farm', episode: 's02e02', at: '12:30', telling: 'shown', extra: 1 },
          { id: 'b', text: 'Lost era', era: 'nowhere', episode: 'issue #12', at: 'soon', telling: 'nonsense' },
          { text: 'no id' }
        ]
      })
    )
    expect(data.eras).toEqual([{ id: 'farm', name: 'The farm' }])
    expect(data.entries[0]).toMatchObject({ characters: ['Glenn', 'Maggie'], episode: 'S2E2', at: '12:30', medium: 'show', extra: 1 })
    expect(data.entries[1]).toMatchObject({ era: 'farm', episode: 'Issue 12', medium: 'comic', at: '', telling: 'shown' })
    expect(data.entries).toHaveLength(2)
    expect(readTimeline(timelineJson(data))).toEqual(data)
    expect(readTimeline('{oops').eras).toEqual(emptyTimeline().eras)
  })
})

describe('ordering', () => {
  const data = { eras: [{ id: 'farm', name: 'Farm' }, { id: 'prison', name: 'Prison' }], entries: [] as TimelineEntry[] }

  it('puts entries in story order by era, then their place', () => {
    const a = entry({ text: 'a', era: 'prison', order: 2 })
    const b = entry({ text: 'b', era: 'farm', order: 5 })
    const c = entry({ text: 'c', era: 'prison', order: 1 })
    expect(storyOrder(data, [a, b, c]).map((e) => e.text)).toEqual(['b', 'c', 'a'])
  })

  it('puts entries in the order they were shown', () => {
    const list = [entry({ text: 'late', episode: 'S4E9', at: '30:00' }), entry({ text: 'none' }), entry({ text: 'early', episode: 'S4E9', at: '2:00' }), entry({ text: 'comic', episode: 'Issue 3' }), entry({ text: 'first', episode: 'S1E1' })]
    expect(tellingOrder(list).map((e) => e.text)).toEqual(['first', 'early', 'late', 'comic', 'none'])
  })

  it('works out a place between two entries', () => {
    const list = [entry({ order: 1 }), entry({ order: 2 })]
    expect(orderAt([], 0)).toBe(0)
    expect(orderAt(list, 0)).toBe(0)
    expect(orderAt(list, 1)).toBe(1.5)
    expect(orderAt(list, 2)).toBe(3)
  })
})

describe('quick capture', () => {
  it('picks out the episode, time and characters', () => {
    const c = parseCapture('S4E9 12:30 Maggie and Glenn find the cell block', ['Maggie', 'Glenn', 'Rick'])
    expect(c).toMatchObject({ text: 'Maggie and Glenn find the cell block', episode: 'S4E9', at: '12:30', medium: 'show', characters: ['Maggie', 'Glenn'], telling: 'shown' })
  })

  it('spots flashbacks, things only told, and comics', () => {
    expect(parseCapture('flashback to Hershel on the farm', []).telling).toBe('flashback')
    expect(parseCapture('Issue 115 Rick tells Carl about Lori', ['Rick', 'Carl']).telling).toBe('told')
    expect(parseCapture('Issue 115 Rick tells Carl about Lori', []).medium).toBe('comic')
  })

  it("doesn't take part of a longer name", () => {
    expect(parseCapture('Ricky shows up', ['Rick']).characters).toEqual([])
  })
})

describe('into a script', () => {
  it('writes the story with a Source marker', () => {
    const text = entryScriptText(entry({ text: 'Maggie gives birth to Hershel.\nGlenn is gone.', episode: 'S8E16', at: '41:10', telling: 'flashback' }))
    expect(text).toBe('Maggie gives birth to Hershel. Glenn is gone. [SOURCE: S8E16 at 41:10, flashback]')
    expect(findMarkers(text)[0]).toMatchObject({ type: 'SOURCE', value: 'S8E16 at 41:10, flashback' })
    expect(entryScriptText(entry({ text: 'No source' }))).toBe('No source')
    expect(sourceLabel(entry({ medium: 'comic', telling: 'told' }))).toBe('the comics, told')
  })
})

describe('filters', () => {
  it('lists characters, most entries first', () => {
    expect(timelineCharacters([entry({ characters: ['Maggie'] }), entry({ characters: ['maggie', 'Glenn'] })])).toEqual(['Maggie', 'Glenn'])
  })

  it('searches words, episodes and seasons', () => {
    const e = entry({ text: 'Glenn proposes', characters: ['Maggie'], episode: 'S4E9' })
    expect(entryMatches(e, 'maggie propose')).toBe(true)
    expect(entryMatches(e, 's04e09')).toBe(true)
    expect(entryMatches(e, 's4')).toBe(true)
    expect(entryMatches(e, 's5')).toBe(false)
  })
})
