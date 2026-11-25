import { describe, expect, it } from 'vitest'
import { matchArtist, parseDeezerArtists, pickDiscoveries, rankRelated, type DiscoverGroup } from './musicDiscover'
import { songKey, type FoundTrack } from './songSearch'

const track = (artist: string, title: string): FoundTrack => ({ id: `${artist}-${title}`, title, artist, album: '', year: '', genre: '', durationMs: 200000 })

describe('finding artists', () => {
  it('reads Deezer’s artists and picks the one with the right name', () => {
    const found = parseDeezerArtists({ data: [{ id: 1, name: 'Daft Punk Tribute' }, { id: 27, name: 'Daft Punk' }, { name: 'no id' }] })
    expect(found).toHaveLength(2)
    expect(matchArtist(found, 'daft punk')?.id).toBe(27)
    expect(matchArtist(found, 'Justice')).toBeNull()
    expect(parseDeezerArtists({ error: { code: 4 } })).toEqual([])
  })

  it('ranks artists similar to several favourites first, and leaves out your favourites', () => {
    const ranked = rankRelated([
      { seed: { name: 'Daft Punk', weight: 1 }, related: [{ id: 2, name: 'Justice' }, { id: 3, name: 'Cassius' }, { id: 4, name: 'The Weeknd' }] },
      { seed: { name: 'The Weeknd', weight: 0.5 }, related: [{ id: 5, name: 'Dua Lipa' }, { id: 3, name: 'Cassius' }] }
    ])
    expect(ranked.map((r) => r.artist.name)).toEqual(['Cassius', 'Justice', 'Dua Lipa'])
    expect(ranked.find((r) => r.artist.name === 'Justice')?.because).toBe('Like Daft Punk')
  })
})

describe('picking new songs', () => {
  const groups: DiscoverGroup[] = [
    { because: 'Like Daft Punk', weight: 1, tracks: [track('Justice', 'Genesis'), track('Justice', 'D.A.N.C.E.'), track('Justice', 'Phantom'), track('Justice', 'Stress')] },
    { because: 'More from Daft Punk', weight: 0.6, tracks: [track('Daft Punk', 'One More Time'), track('Daft Punk', 'Aerodynamic'), track('Daft Punk', 'One More Time (Radio Edit)')] }
  ]

  it('leaves out songs you already have, and the same song twice', () => {
    const owned = new Set([songKey('Daft Punk', 'One More Time'), songKey('Justice', 'Genesis')])
    const picks = pickDiscoveries(groups, { owned, perArtist: 5 })
    const titles = picks.map((p) => p.title)
    expect(titles).not.toContain('Genesis')
    expect(titles).not.toContain('One More Time')
    // "(Radio Edit)" is the same song as one you have.
    expect(titles).not.toContain('One More Time (Radio Edit)')
    expect(titles).toContain('Aerodynamic')
    expect(picks.find((p) => p.title === 'Aerodynamic')?.because).toBe('More from Daft Punk')
  })

  it('keeps each artist to a few songs, and New picks changes the set', () => {
    const picks = pickDiscoveries(groups, { owned: new Set(), perArtist: 2 })
    expect(picks.filter((p) => p.artist === 'Justice')).toHaveLength(2)
    const sets = new Set([1, 2, 3, 4, 5, 6].map((seed) => pickDiscoveries(groups, { owned: new Set(), seed, perArtist: 2 }).map((p) => p.title).join()))
    expect(sets.size).toBeGreaterThan(1)
  })
})

describe('mixing favourites', () => {
  it('doesn’t fill the list with one favourite’s similar artists', () => {
    const groups: DiscoverGroup[] = [
      ...['A', 'B', 'C', 'D', 'E', 'F'].map((a) => ({ because: 'Like Daft Punk', weight: 1, tracks: [track(a, '1'), track(a, '2')] })),
      { because: 'Like Bon Iver', weight: 0.5, tracks: [track('Sufjan Stevens', '1'), track('Sufjan Stevens', '2')] }
    ]
    const picks = pickDiscoveries(groups, { owned: new Set(), limit: 6 })
    expect(picks.some((p) => p.because === 'Like Bon Iver')).toBe(true)
  })
})
