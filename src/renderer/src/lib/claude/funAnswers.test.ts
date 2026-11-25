import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Game } from '@shared/games'

vi.mock('../gameStats', () => ({ loadRecords: () => [], winPercent: () => 0 }))
vi.mock('../../store/miniGames', () => ({ MINI_GAME_IDS: [], openMiniGames: () => undefined }))
vi.mock('../../store/comics', () => ({ readComic: () => undefined }))
vi.mock('../editorController', () => ({ COMICS_TAB: 'comics:', openSpecialTab: () => undefined }))
vi.mock('../../store/noteIndex', () => ({ useNoteIndex: { getState: () => ({ notes: new Map() }) } }))
vi.mock('../../store/vault', () => ({ useVault: { getState: () => ({ vault: null }) } }))
vi.mock('../lock/folders', () => ({ lockedFolderOf: () => null }))

const { FUN_ANSWERS } = await import('./funAnswers')

const game = (id: string, name: string, more: Partial<Game> = {}): Game => ({
  id,
  name,
  source: id.startsWith('steam:') ? 'steam' : id.startsWith('epic:') ? 'epic' : 'app',
  path: `/games/${name}`,
  played: 0,
  playedWeek: 0,
  lastPlayed: null,
  running: false,
  art: null,
  icon: null,
  hidden: false,
  ...more
})

let games: Game[] = []
let fresh: Game[] | null = null
const played: string[] = []
const hidden: [string, boolean][] = []
let playProblem: string | null = null

beforeEach(() => {
  games = [
    game('steam:1672970', 'Minecraft Dungeons', { played: 7200, lastPlayed: Date.parse('2026-11-20T18:00:00') }),
    game('app:/Applications/Minecraft.app', 'Minecraft', { played: 36000, playedWeek: 5400, lastPlayed: Date.parse('2026-11-24T20:00:00') }),
    game('epic:Fortnite', 'Fortnite', { played: 600 }),
    game('steam:271590', 'Grand Theft Auto V', { running: true }),
    game('steam:431960', 'Wallpaper Engine', { hidden: true })
  ]
  fresh = null
  played.length = 0
  hidden.length = 0
  playProblem = null
  vi.stubGlobal('window', {
    api: {
      gamesList: async (rescan: boolean) => ({ games: rescan && fresh ? fresh : games, steam: true, epic: false }),
      gamesPlay: async (id: string) => (played.push(id), playProblem),
      gamesSetHidden: async (id: string, hide: boolean) => void hidden.push([id, hide]),
      gamesReveal: async () => undefined
    }
  })
})

const call = (name: string, args: Record<string, unknown>): Promise<string> => Promise.resolve(FUN_ANSWERS[name](args))

describe('games for Claude Desktop', () => {
  it('lists games with launcher, id and playing now first, then last played', async () => {
    const text = await call('list_games', {})
    const lines = text.split('\n').filter((l) => l.includes('(id '))
    expect(lines.map((l) => l.split(' [')[0])).toEqual(['Grand Theft Auto V', 'Minecraft', 'Minecraft Dungeons', 'Fortnite'])
    expect(lines[0]).toContain('[Steam] (id steam:271590): playing now')
    expect(lines[1]).toContain('10.0 h in all, 1.5 h this week, last played')
    expect(text).toContain('1 hidden on the Games page')
    expect(text).toContain('The Epic Games Launcher isn’t installed')
    expect(text).not.toContain('Wallpaper Engine')
  })

  it('filters by launcher and can include hidden games', async () => {
    const steamOnly = await call('list_games', { launcher: 'steam', hidden: true, sort: 'name' })
    expect(steamOnly).toContain('Wallpaper Engine')
    expect(steamOnly).not.toContain('Fortnite')
    expect(await call('list_games', { launcher: 'epic', limit: 1 })).toContain('Fortnite [Epic Games]')
  })

  it('starts the game the name means', async () => {
    expect(await call('play_game', { game: 'minecraft' })).toBe('Starting Minecraft. It can take a moment to open.')
    expect(await call('play_game', { game: 'fortnite' })).toContain('through the Epic Games Launcher')
    expect(played).toEqual(['app:/Applications/Minecraft.app', 'epic:Fortnite'])
  })

  it('starts exactly the game an id names', async () => {
    await call('play_game', { id: 'steam:1672970' })
    expect(played).toEqual(['steam:1672970'])
  })

  it('doesn’t start a game from part of a name, and asks between several', async () => {
    await expect(call('play_game', { game: 'craft' })).rejects.toThrow(/nothing was started. Did they mean Minecraft \[app\]/)
    games = games.filter((g) => g.name !== 'Minecraft')
    games.push(game('steam:2', 'Minecraft Legends'))
    await expect(call('play_game', { game: 'minecraft' })).rejects.toThrow(/More than one game fits “minecraft”: Minecraft Dungeons .*Minecraft Legends .*Nothing was started/)
    expect(played).toEqual([])
  })

  it('looks for newly installed games before saying there’s none', async () => {
    fresh = [...games, game('steam:413150', 'Stardew Valley')]
    expect(await call('play_game', { game: 'Stardew Valley' })).toContain('Starting Stardew Valley')
    fresh = null
    await expect(call('play_game', { game: 'Halo' })).rejects.toThrow(/no game called “Halo” on the Games page.*Add a game/)
  })

  it('says when a game is already running, and passes on launch problems', async () => {
    expect(await call('play_game', { game: 'GTA 5' })).toBe('Grand Theft Auto V is already running.')
    playProblem = 'Couldn’t open Steam to start it. Is Steam installed?'
    await expect(call('play_game', { game: 'Minecraft Dungeons' })).rejects.toThrow('Is Steam installed?')
  })

  it('searches without starting anything', async () => {
    expect(await call('search_games', { query: 'minecraft' })).toMatch(/^One game fits “minecraft”:\nMinecraft \[app\]/)
    expect(await call('search_games', { query: 'gta v' })).toContain('(by its initials)')
    expect(await call('search_games', { query: 'mine' })).toContain('The closest (not a sure match)')
    expect(played).toEqual([])
  })

  it('hides and shows games', async () => {
    expect(await call('hide_game', { game: 'Fortnite' })).toContain('Hid Fortnite')
    expect(await call('hide_game', { game: 'Wallpaper Engine', hidden: false })).toContain('back on the Games page')
    expect(await call('hide_game', { game: 'Minecraft', hidden: false })).toContain('already shown')
    expect(hidden).toEqual([
      ['epic:Fortnite', true],
      ['steam:431960', false]
    ])
  })
})
