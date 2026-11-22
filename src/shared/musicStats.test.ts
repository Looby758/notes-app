import { describe, expect, it } from 'vitest'
import { applyMusicEdit, emptyMusicData, type MusicData } from './musicLibrary'
import { listenedFor, listeningStats, periodRange } from './musicStats'
import type { LocalSong } from './localMusic'

const song = (path: string, artist: string, album: string, min: number): LocalSong => ({ path, title: path.replace('.mp3', ''), artist, album, track: 0, durationMs: min * 60000, art: false })
const songs = [song('a.mp3', 'Alpha', 'One', 3), song('b.mp3', 'Beta', 'Two', 4), song('c.mp3', 'Alpha', 'One', 5)]
const at = (y: number, m: number, d: number, h = 12): number => new Date(y, m - 1, d, h).getTime()

function played(list: [string, number][]): MusicData {
  return list.reduce((d, [path, t]) => applyMusicEdit(d, { kind: 'played', path, at: t }), emptyMusicData())
}

describe('periods', () => {
  // Wednesday 18 November 2026.
  const now = at(2026, 11, 18)
  it('starts weeks on the chosen day', () => {
    expect(new Date(periodRange('week', 0, now, 1).start).getDay()).toBe(1)
    expect(new Date(periodRange('week', 0, now, 0).start).getDay()).toBe(0)
    expect(periodRange('week', 1, now).label).toBe('Last week')
    expect(periodRange('week', 2, now).label).toBe('2 Nov – 8 Nov')
  })
  it('names months and years', () => {
    expect(periodRange('month', 0, now).label).toBe('This month')
    expect(periodRange('month', 11, now).label).toBe('December 2025')
    expect(periodRange('year', 1, now).label).toBe('2025')
  })
})

describe('listening stats', () => {
  const now = at(2026, 11, 18)
  const data = played([
    ['a.mp3', at(2026, 11, 16)],
    ['a.mp3', at(2026, 11, 17)],
    ['b.mp3', at(2026, 11, 17)],
    ['c.mp3', at(2026, 11, 3)],
    ['a.mp3', at(2026, 2, 3)],
    ['gone/Someone - Old.mp3', at(2025, 6, 1)]
  ])
  it('counts a week from the history', () => {
    const s = listeningStats(data, songs, 'week', 0, now)
    expect(s.plays).toBe(3)
    expect(s.ms).toBe((3 + 3 + 4) * 60000)
    expect(s.topSongs[0]).toMatchObject({ path: 'a.mp3', plays: 2 })
    expect(s.topArtists.map((a) => [a.name, a.plays])).toEqual([
      ['Alpha', 2],
      ['Beta', 1]
    ])
    expect(s.chart.map((b) => b.plays)).toEqual([1, 2, 0, 0, 0, 0, 0])
    expect(s.hasEarlier).toBe(true)
  })
  it('counts months and years from the plays kept by month', () => {
    const month = listeningStats(data, songs, 'month', 0, now)
    expect(month.plays).toBe(4)
    expect(month.topAlbums[0]).toMatchObject({ name: 'One', sub: 'Alpha', plays: 3 })
    expect(month.chart).toHaveLength(30)
    const year = listeningStats(data, songs, 'year', 0, now)
    expect(year.plays).toBe(5)
    expect(year.chart[1].plays).toBe(1)
    expect(year.chart[10].plays).toBe(4)
    const last = listeningStats(data, songs, 'year', 1, now)
    expect(last.plays).toBe(1)
    expect(last.topSongs[0]).toMatchObject({ title: 'Old', artist: 'Someone', song: undefined })
  })
  it('keeps months when the history has moved on', () => {
    const trimmed = { ...data, history: data.history.slice(-1) }
    expect(listeningStats(trimmed, songs, 'month', 0, now).plays).toBe(4)
  })
  it('counts everything for all time, charted by year', () => {
    const s = listeningStats(data, songs, 'all', 0, now)
    expect(s.plays).toBe(6)
    expect(s.chart).toEqual([
      { label: '2025', plays: 1 },
      { label: '2026', plays: 5 }
    ])
  })
  it('says how long', () => {
    expect(listenedFor(45 * 60000)).toBe('45 min')
    expect(listenedFor(125 * 60000)).toBe('2 hr 5 min')
    expect(listenedFor(50 * 3600000)).toBe('2 days 2 hr')
  })
})
