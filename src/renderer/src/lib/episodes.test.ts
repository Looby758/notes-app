import { describe, expect, it } from 'vitest'
import { compareEpisodes, episodeMatches, findEpisodes, isEpisodeQuery, normalizeEpisode, noteEpisodes } from './episodes'
import { allCharacters, allEpisodes, changeTags, pictureMatches, readScreenshots, remapScreenshots, screenshotsJson } from './screenshots'

describe('episode references', () => {
  it('writes episodes the short way', () => {
    expect(normalizeEpisode('S04E09')).toBe('S4E9')
    expect(normalizeEpisode('s4e9')).toBe('S4E9')
    expect(normalizeEpisode('S4 E9')).toBe('S4E9')
    expect(normalizeEpisode('Issue #115')).toBe('Issue 115')
    expect(normalizeEpisode('TWD 115')).toBe('Issue 115')
    expect(normalizeEpisode('#115')).toBe('Issue 115')
    expect(normalizeEpisode('S0E1')).toBe(null)
    expect(normalizeEpisode('maggie')).toBe(null)
  })

  it('finds episodes in text', () => {
    expect(findEpisodes('Glenn dies in S07E01, in the comic it was Issue 100. S4E9 too, but not ASE9 or S4E9X.').map((e) => e.label)).toEqual(['S7E1', 'Issue 100', 'S4E9'])
    const [e] = findEpisodes('ab S4E9', 10)
    expect([e.from, e.to]).toEqual([13, 17])
  })

  it('sorts shows then comics', () => {
    expect(['Issue 2', 'S10E1', 'S2E3', 'S2E10'].sort(compareEpisodes)).toEqual(['S2E3', 'S2E10', 'S10E1', 'Issue 2'])
  })

  it('matches an episode or a whole season', () => {
    expect(episodeMatches('S4E9', 's04e09')).toBe(true)
    expect(episodeMatches('S4E9', 'S4')).toBe(true)
    expect(episodeMatches('S4E9', 'season 4')).toBe(true)
    expect(episodeMatches('S4E9', 'S5')).toBe(false)
    expect(episodeMatches('S14E1', 'S1')).toBe(false)
    expect(isEpisodeQuery('S4')).toBe(true)
    expect(isEpisodeQuery('Issue 115')).toBe(true)
    expect(isEpisodeQuery('Maggie')).toBe(false)
  })

  it('reads episodes from a note and its properties', () => {
    expect(noteEpisodes('About S4E9 and s3e1.', [{ key: 'episodes', value: ['S04E09', 'Issue 115', 'nope'] }])).toEqual(['S3E1', 'S4E9', 'Issue 115'])
  })
})

describe('screenshot organiser', () => {
  it('reads and writes the file, dropping anything broken', () => {
    const data = readScreenshots(
      JSON.stringify({ pictures: { 'a.png': { characters: ['Maggie', ' maggie ', 'Glenn'], episodes: ['s4e9', 'bad'] }, '../x.png': { characters: ['X'] }, 'b.png': { characters: [] } } })
    )
    expect(data).toEqual({ 'a.png': { characters: ['Maggie', 'Glenn'], episodes: ['S4E9'] } })
    expect(readScreenshots(screenshotsJson(data))).toEqual(data)
    expect(readScreenshots('not json')).toEqual({})
  })

  it('adds and takes away tags', () => {
    let d = changeTags({}, ['a.png', 'b.png'], { addCharacters: ['Maggie'], addEpisodes: ['S04E09', 'nonsense'] })
    expect(d['a.png']).toEqual({ characters: ['Maggie'], episodes: ['S4E9'] })
    d = changeTags(d, ['a.png'], { removeCharacters: ['maggie'], removeEpisodes: ['S4E9'] })
    expect(d['a.png']).toBeUndefined()
    expect(d['b.png'].characters).toEqual(['Maggie'])
  })

  it('follows renames', () => {
    const d = { 'shots/a.png': { characters: ['Rick'], episodes: [] } }
    expect(remapScreenshots(d, 'shots', 'pictures')).toEqual({ 'pictures/a.png': { characters: ['Rick'], episodes: [] } })
    expect(remapScreenshots(d, 'other', 'x')).toBe(null)
  })

  it('lists characters and episodes', () => {
    const d = { 'a.png': { characters: ['Maggie', 'Glenn'], episodes: ['S4E9'] }, 'b.png': { characters: ['Maggie'], episodes: ['S2E1'] } }
    expect(allCharacters(d)).toEqual([
      { name: 'Maggie', count: 2 },
      { name: 'Glenn', count: 1 }
    ])
    expect(allEpisodes(d)).toEqual(['S2E1', 'S4E9'])
  })

  it('searches by name, character and episode', () => {
    const tags = { characters: ['Maggie Rhee'], episodes: ['S4E9', 'Issue 115'] }
    expect(pictureMatches('shots/farm.png', tags, 'maggie s4')).toBe(true)
    expect(pictureMatches('shots/farm.png', tags, 'maggie s4e9')).toBe(true)
    expect(pictureMatches('shots/farm.png', tags, 'maggie s5')).toBe(false)
    expect(pictureMatches('shots/farm.png', tags, '"maggie rhee" farm')).toBe(true)
    expect(pictureMatches('shots/farm.png', tags, 'issue 115')).toBe(true)
    expect(pictureMatches('shots/farm.png', undefined, 'glenn')).toBe(false)
    expect(pictureMatches('shots/rick-s1e1.png', undefined, 's1e1')).toBe(true)
    expect(pictureMatches('shots/farm.png', undefined, '')).toBe(true)
  })
})
