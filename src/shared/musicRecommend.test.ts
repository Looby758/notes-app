import { describe, expect, it } from 'vitest'
import { applyMusicEdit, emptyMusicData, type MusicData } from './musicLibrary'
import { recommendSongs, songsLike } from './musicRecommend'
import type { LocalSong } from './localMusic'

const DAY = 86_400_000
const now = new Date(2026, 10, 25, 12).getTime()
const song = (path: string, artist: string, extra: Partial<LocalSong> = {}): LocalSong => ({ path, title: path.replace('.mp3', ''), artist, album: '', track: 0, durationMs: 180000, art: false, ...extra })

const library = [
  song('daft1.mp3', 'Daft Punk', { genre: 'Electronic', album: 'Discovery' }),
  song('daft2.mp3', 'Daft Punk', { genre: 'Electronic', album: 'Discovery' }),
  song('daft3.mp3', 'Daft Punk', { genre: 'Electronic', album: 'Homework' }),
  song('justice.mp3', 'Justice', { genre: 'Electronic' }),
  song('folk1.mp3', 'Folk Band', { genre: 'Folk' }),
  song('folk2.mp3', 'Folk Band', { genre: 'Folk' }),
  song('rock.mp3', 'Rockers', { genre: 'Rock' }),
  song('hated.mp3', 'Daft Punk', { genre: 'Electronic' })
]

function played(data: MusicData, path: string, at: number): MusicData {
  return applyMusicEdit(data, { kind: 'played', path, at })
}

/** Daft Punk's first song a lot this month, each time followed by Justice. */
function listener(): MusicData {
  let d = emptyMusicData()
  for (let i = 0; i < 10; i++) {
    const t = now - (20 - i) * DAY
    d = played(d, 'daft1.mp3', t)
    d = played(d, 'justice.mp3', t + 4 * 60_000)
  }
  d = applyMusicEdit(d, { kind: 'rate', path: 'hated.mp3', stars: 1 })
  return d
}

describe('recommended songs', () => {
  it('picks songs by artists and genres you play, not ones you rated low', () => {
    const recs = recommendSongs(listener(), library, { now })
    const paths = recs.map((r) => r.song.path)
    expect(paths).not.toContain('hated.mp3')
    expect(paths.indexOf('daft2.mp3')).toBeLessThan(paths.indexOf('folk1.mp3'))
    expect(paths.indexOf('daft3.mp3')).toBeLessThan(paths.indexOf('rock.mp3'))
    expect(recs.find((r) => r.song.path === 'daft2.mp3')?.reason).toMatch(/Daft Punk|Discovery|Electronic/)
  })

  it('leaves out songs you played in the last couple of days', () => {
    const d = played(listener(), 'daft2.mp3', now - 3600_000)
    expect(recommendSongs(d, library, { now }).map((r) => r.song.path)).not.toContain('daft2.mp3')
  })

  it('brings back songs you loved and haven’t played lately', () => {
    let d = emptyMusicData()
    for (let i = 0; i < 10; i++) d = played(d, 'folk1.mp3', now - (200 + i) * DAY)
    d = applyMusicEdit(d, { kind: 'like', paths: ['folk1.mp3'], liked: true, at: now - 200 * DAY })
    const recs = recommendSongs(d, library, { now })
    expect(recs[0].song.path).toBe('folk1.mp3')
    expect(recs[0].reason).toMatch(/haven’t played it lately/)
  })

  it('still suggests something with no plays yet, and Refresh changes the order', () => {
    const many = Array.from({ length: 40 }, (_, i) => song(`s${i}.mp3`, `Artist ${i}`))
    const a = recommendSongs(emptyMusicData(), many, { now, seed: 1, limit: 20 })
    const b = recommendSongs(emptyMusicData(), many, { now, seed: 2, limit: 20 })
    expect(a).toHaveLength(20)
    expect(a.map((r) => r.song.path)).not.toEqual(b.map((r) => r.song.path))
  })

  it('keeps any one artist to a few songs', () => {
    const big = [...Array.from({ length: 10 }, (_, i) => song(`d${i}.mp3`, 'Daft Punk', { genre: 'Electronic' })), ...library]
    const recs = recommendSongs(listener(), big, { now, limit: 6 })
    expect(recs.filter((r) => r.song.artist === 'Daft Punk').length).toBeLessThanOrEqual(3)
  })
})

describe('songs like this', () => {
  it('finds songs that go with a song', () => {
    const list = songsLike(library[0], listener(), library, { now }).map((s) => s.path)
    expect(list).not.toContain('daft1.mp3')
    expect(list).not.toContain('hated.mp3')
    expect(list.slice(0, 3)).toEqual(expect.arrayContaining(['justice.mp3']))
    expect(list).not.toContain('rock.mp3')
  })

  it('skips songs already queued', () => {
    const list = songsLike(library[0], listener(), library, { now, skip: new Set(['justice.mp3']) })
    expect(list.map((s) => s.path)).not.toContain('justice.mp3')
  })
})
