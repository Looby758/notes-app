import { describe, expect, it } from 'vitest'
import { episodeOf, showEpisodes } from './videoEpisodes'

describe('episodeOf', () => {
  it('reads the usual ways episodes are saved', () => {
    expect(episodeOf('TV/Breaking Bad/Season 1/Breaking.Bad.S01E03.720p.mkv')).toEqual({ show: 'Breaking Bad', season: 1, episode: 3 })
    expect(episodeOf('TV/Breaking Bad/S2/2x05 - Breakage.mp4')).toEqual({ show: 'Breaking Bad', season: 2, episode: 5 })
    expect(episodeOf('TV/The Office (2005)/Season 3/Episode 4.mp4')).toEqual({ show: 'The Office', season: 3, episode: 4 })
    expect(episodeOf('TV/Dark/Season 2/04 Lost and Found.mkv')).toEqual({ show: 'Dark', season: 2, episode: 4 })
    expect(episodeOf('Shows/Bluey/s01e12.mp4')).toEqual({ show: 'Bluey', season: 1, episode: 12 })
    expect(episodeOf('Videos\\The.Walking.Dead.S04E09.mkv')).toEqual({ show: 'The Walking Dead', season: 4, episode: 9 })
  })

  it('leaves videos that aren’t episodes alone', () => {
    expect(episodeOf('Videos/Holiday 2024.mp4')).toBeNull()
    expect(episodeOf('Videos/Clips/1080p test.mp4')).toBeNull()
  })

  it('puts a show’s episodes in order', () => {
    const v = (path: string) => ({ path })
    const list = showEpisodes([v('BB/Season 2/BB.S02E01.mkv'), v('BB/Season 1/BB.S01E02.mkv'), v('BB/Season 1/BB.S01E01.mkv'), v('Other/Other.S01E01.mkv')], 'bb')
    expect(list.map((e) => e.path)).toEqual(['BB/Season 1/BB.S01E01.mkv', 'BB/Season 1/BB.S01E02.mkv', 'BB/Season 2/BB.S02E01.mkv'])
  })
})
