import { describe, expect, it } from 'vitest'
import {
  addPlay,
  ANIMATED_COVER_QUERY,
  coverLookupFresh,
  describeLastPlayed,
  describePlayed,
  epicGameFromManifest,
  epicLaunchUrl,
  isInside,
  macGameFromPlist,
  matchSgdbGame,
  parseVdf,
  pickAnimatedCover,
  playedInWeek,
  sortGames,
  steamAppFromManifest,
  steamAppId,
  steamCachePaths,
  steamImageUrl,
  steamLibraryFolders,
  steamPlaytimes,
  type Game
} from './games'

describe('parseVdf', () => {
  it('reads nested sections, escapes and comments', () => {
    const v = parseVdf(`// comment
"Root"
{
  "Name"   "Portal \\"2\\""
  "Path"   "C:\\\\Games"
  "Inner" { "a" "1" }
  "cond" "x" [$WIN32]
}`)
    expect(v).toEqual({ root: { name: 'Portal "2"', path: 'C:\\Games', inner: { a: '1' }, cond: 'x' } })
  })
})

describe('Steam', () => {
  it('lists library folders in the new and old layouts', () => {
    const fresh = `"libraryfolders" { "0" { "path" "/Users/me/Library/Application Support/Steam" "apps" { "620" "123" } } "1" { "path" "/Volumes/Games/SteamLibrary" } }`
    expect(steamLibraryFolders(fresh)).toEqual(['/Users/me/Library/Application Support/Steam', '/Volumes/Games/SteamLibrary'])
    const old = `"LibraryFolders" { "TimeNextStatsReport" "1" "ContentStatsID" "-1" "1" "D:\\\\SteamLibrary" }`
    expect(steamLibraryFolders(old)).toEqual(['D:\\SteamLibrary'])
  })

  it('reads a game from its manifest and skips Steam’s own tools', () => {
    expect(steamAppFromManifest(`"AppState" { "appid" "620" "name" "Portal 2" "installdir" "Portal 2" "StateFlags" "4" }`)).toEqual({
      appId: '620',
      name: 'Portal 2',
      installDir: 'Portal 2'
    })
    expect(steamAppFromManifest(`"AppState" { "appid" "228980" "name" "Steamworks Common Redistributables" "installdir" "Steamworks Shared" }`)).toBeNull()
    expect(steamAppFromManifest('nonsense')).toBeNull()
  })

  it('reads time played from localconfig.vdf', () => {
    const text = `"UserLocalConfigStore" { "Software" { "Valve" { "Steam" { "apps" {
      "620" { "LastPlayed" "1700000000" "Playtime" "754" "Playtime2wks" "30" }
      "440" { "cloud" { "last_sync_state" "synchronized" } }
    } } } } }`
    const times = steamPlaytimes(text)
    expect(times.get('620')).toEqual({ minutes: 754, lastPlayed: 1700000000 })
    expect(times.has('440')).toBe(false)
  })
})

describe('Epic', () => {
  const manifest = {
    AppName: 'Fortnite',
    DisplayName: 'Fortnite',
    InstallLocation: '/Users/Shared/Epic Games/Fortnite',
    LaunchExecutable: 'FortniteClient.app/Contents/MacOS/FortniteClient',
    CatalogNamespace: 'fn',
    CatalogItemId: 'abc',
    AppCategories: ['public', 'games', 'applications']
  }
  it('reads a game and builds its launch link', () => {
    const g = epicGameFromManifest(JSON.stringify(manifest))!
    expect(g.name).toBe('Fortnite')
    expect(epicLaunchUrl(g)).toBe('com.epicgames.launcher://apps/fn%3Aabc%3AFortnite?action=launch&silent=true')
  })
  it('leaves out add-ons and broken files', () => {
    expect(epicGameFromManifest(JSON.stringify({ ...manifest, AppName: 'Skin', MainGameAppName: 'Fortnite' }))).toBeNull()
    expect(epicGameFromManifest('{')).toBeNull()
  })
})

describe('macGameFromPlist', () => {
  const plist = (category: string, id = 'com.example.game', name = 'Cool Game'): string =>
    `<plist><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleName</key><string>${name}</string><key>LSApplicationCategoryType</key><string>${category}</string></dict></plist>`
  it('spots games of every kind', () => {
    expect(macGameFromPlist(plist('public.app-category.games'), 'x')).toBe('Cool Game')
    expect(macGameFromPlist(plist('public.app-category.puzzle-games', 'com.a', 'Tom &amp; Jerry'), 'x')).toBe('Tom & Jerry')
  })
  it('leaves out other apps and game shops', () => {
    expect(macGameFromPlist(plist('public.app-category.productivity'), 'x')).toBeNull()
    expect(macGameFromPlist(plist('public.app-category.games', 'com.valvesoftware.steam'), 'x')).toBeNull()
  })
})

describe('time played', () => {
  it('adds up per day and over the last week', () => {
    let r = addPlay(undefined, 600, new Date(2026, 9, 20, 12))
    r = addPlay(r, 300, new Date(2026, 9, 28, 12))
    r = addPlay(r, 60, new Date(2026, 9, 28, 13))
    expect(r.total).toBe(960)
    expect(r.days['2026-10-28']).toBe(360)
    expect(playedInWeek(r, new Date(2026, 9, 28, 14))).toBe(360)
    expect(playedInWeek(r, new Date(2026, 9, 26, 14))).toBe(600)
  })
  it('forgets days older than two months but keeps the total', () => {
    let r = addPlay(undefined, 100, new Date(2026, 0, 1))
    r = addPlay(r, 100, new Date(2026, 5, 1))
    expect(Object.keys(r.days)).toEqual(['2026-06-01'])
    expect(r.total).toBe(200)
  })
  it('describes it', () => {
    expect(describePlayed(0)).toBe('Not played yet')
    expect(describePlayed(30)).toBe('Under a minute')
    expect(describePlayed(45 * 60)).toBe('45m')
    expect(describePlayed(2 * 3600 + 15 * 60)).toBe('2h 15m')
    expect(describePlayed(3 * 3600)).toBe('3h')
    const now = new Date(2026, 9, 28, 9)
    expect(describeLastPlayed(null, now)).toBe('Never played')
    expect(describeLastPlayed(new Date(2026, 9, 28, 1).getTime(), now)).toBe('Played today')
    expect(describeLastPlayed(new Date(2026, 9, 27, 23).getTime(), now)).toBe('Played yesterday')
    expect(describeLastPlayed(new Date(2026, 9, 25).getTime(), now)).toBe('Played 3 days ago')
  })
})

describe('sortGames and isInside', () => {
  const game = (name: string, played: number, lastPlayed: number | null, running = false): Game => ({
    id: name,
    name,
    source: 'app',
    path: '',
    played,
    playedWeek: 0,
    lastPlayed,
    running,
    art: null,
    icon: null,
    hidden: false
  })
  it('puts what’s running first', () => {
    const list = [game('B', 10, 5), game('A', 99, 1), game('C', 0, null, true)]
    expect(sortGames(list, 'recent').map((g) => g.name)).toEqual(['C', 'B', 'A'])
    expect(sortGames(list, 'most').map((g) => g.name)).toEqual(['C', 'A', 'B'])
    expect(sortGames(list, 'name').map((g) => g.name)).toEqual(['C', 'A', 'B'])
  })
  it('matches programs inside a game’s folder only', () => {
    expect(isInside('/Applications/Chess.app/Contents/MacOS/Chess', '/Applications/Chess.app', true)).toBe(true)
    expect(isInside('/applications/chess.app/Contents/MacOS/Chess', '/Applications/Chess.app/', true)).toBe(true)
    expect(isInside('/Applications/Chess.app2/x', '/Applications/Chess.app', true)).toBe(false)
    expect(isInside('C:\\Games\\Portal 2\\portal2.exe', 'C:\\Games\\Portal 2', true)).toBe(true)
    expect(isInside('/a/b', '', true)).toBe(false)
  })
})

describe('launch animation art', () => {
  it('finds the Steam app id only in Steam game ids', () => {
    expect(steamAppId('steam:620')).toBe('620')
    expect(steamAppId('epic:Fortnite')).toBeNull()
    expect(steamAppId('app:/Applications/steam:1.app')).toBeNull()
  })

  it("points at Steam's website pictures", () => {
    expect(steamImageUrl('620', 'library_hero.jpg')).toBe('https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/620/library_hero.jpg')
    expect(steamImageUrl('620', 'logo.png')).toBe('https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/620/logo.png')
  })

  it("looks in both of Steam's cache layouts, then its subfolders", () => {
    expect(steamCachePaths('/c', '620', 'logo.png', ['abc'])).toEqual(['/c/620/logo.png', '/c/620_logo.png', '/c/620/abc/logo.png'])
  })
})

describe('animated covers', () => {
  const grid = (url: string, width = 460, height = 215, extra = {}) => ({ url, width, height, mime: 'image/webp', ...extra })

  it('asks only for safe, card-shaped animated covers', () => {
    expect(ANIMATED_COVER_QUERY).toContain('types=animated')
    expect(ANIMATED_COVER_QUERY).toContain('dimensions=460x215,920x430')
    expect(ANIMATED_COVER_QUERY).toContain('epilepsy=false')
    expect(ANIMATED_COVER_QUERY).toContain('nsfw=false')
  })

  it('picks the best-voted small cover, else a big one, never an unsafe or odd-shaped one', () => {
    expect(pickAnimatedCover([grid('https://cdn/a.webp', 920, 430), grid('https://cdn/b.webp')])).toBe('https://cdn/b.webp')
    expect(pickAnimatedCover([grid('https://cdn/a.webp', 920, 430)])).toBe('https://cdn/a.webp')
    expect(pickAnimatedCover([grid('https://cdn/a.webp', 600, 900), grid('https://cdn/b.webp', 460, 215, { epilepsy: true }), grid('https://cdn/c.webp', 460, 215, { nsfw: true })])).toBeNull()
    expect(pickAnimatedCover([grid('http://cdn/a.webp'), grid('https://cdn/b.webm', 460, 215, { mime: 'video/webm' })])).toBeNull()
    expect(pickAnimatedCover([{ url: 'https://cdn/a.png', width: 460, height: 215 }])).toBe('https://cdn/a.png')
    expect(pickAnimatedCover([])).toBeNull()
  })

  it('only uses a search result with the same name', () => {
    const results = [
      { id: 1, name: 'Portal 2' },
      { id: 2, name: 'Portal' }
    ]
    expect(matchSgdbGame('Portal', results)).toBe(2)
    expect(matchSgdbGame('PORTAL™', results)).toBe(2)
    expect(matchSgdbGame('Pokémon & Friends', [{ id: 3, name: 'Pokemon and Friends' }])).toBe(3)
    expect(matchSgdbGame('Portal 3', results)).toBeNull()
    expect(matchSgdbGame('!!!', results)).toBeNull()
  })

  it('remembers a cover for a month and "none" for a week', () => {
    const day = 24 * 3600 * 1000
    expect(coverLookupFresh(undefined, 0)).toBe(false)
    expect(coverLookupFresh({ url: 'https://x', checked: 0 }, 29 * day)).toBe(true)
    expect(coverLookupFresh({ url: 'https://x', checked: 0 }, 31 * day)).toBe(false)
    expect(coverLookupFresh({ url: null, checked: 0 }, 6 * day)).toBe(true)
    expect(coverLookupFresh({ url: null, checked: 0 }, 8 * day)).toBe(false)
  })
})
