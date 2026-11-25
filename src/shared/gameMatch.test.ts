import { describe, expect, it } from 'vitest'
import { findGame, gameWords, type MatchableGame } from './gameMatch'

const g = (id: string, name: string, hidden = false): MatchableGame => ({ id, name, hidden })
const LIBRARY = [
  g('steam:620', 'Portal 2'),
  g('steam:400', 'Portal'),
  g('steam:271590', 'Grand Theft Auto V'),
  g('steam:730', 'Counter-Strike 2'),
  g('epic:Fortnite', 'Fortnite'),
  g('app:/Applications/Minecraft.app', 'Minecraft'),
  g('steam:1672970', 'Minecraft Dungeons'),
  g('steam:431960', 'Wallpaper Engine', true),
  g('epic:Rocket', 'Rocket League®'),
  g('steam:1245620', 'ELDEN RING™')
]
const one = (want: string, games = LIBRARY): string | null => {
  const m = findGame(games, want)
  return m.kind === 'one' ? m.game.name : null
}

describe('gameWords', () => {
  it('ignores case, punctuation and trademarks, and reads roman numerals', () => {
    expect(gameWords('Counter-Strike: Global Offensive')).toEqual(['counter', 'strike', 'global', 'offensive'])
    expect(gameWords('ELDEN RING™')).toEqual(['elden', 'ring'])
    expect(gameWords('Grand Theft Auto V')).toEqual(['grand', 'theft', 'auto', '5'])
    expect(gameWords('Ratchet & Clank')).toEqual(['ratchet', 'and', 'clank'])
    expect(gameWords('Assassin’s Creed')).toEqual(['assassins', 'creed'])
  })
})

describe('findGame', () => {
  it('picks the whole name, whatever the case or punctuation', () => {
    expect(one('minecraft')).toBe('Minecraft')
    expect(one('Portal')).toBe('Portal')
    expect(one('portal 2')).toBe('Portal 2')
    expect(one('counter strike 2')).toBe('Counter-Strike 2')
    expect(one('rocket league')).toBe('Rocket League®')
    expect(one('Elden Ring')).toBe('ELDEN RING™')
    expect(one('rocketleague')).toBe('Rocket League®')
  })

  it('takes an id from a list as it is', () => {
    expect(findGame(LIBRARY, 'steam:620')).toEqual({ kind: 'one', game: LIBRARY[0], how: 'id' })
  })

  it('knows a game by its initials', () => {
    expect(one('GTA 5')).toBe('Grand Theft Auto V')
    expect(one('gta v')).toBe('Grand Theft Auto V')
    expect(one('cs2')).toBe('Counter-Strike 2')
    expect(findGame(LIBRARY, 'gta5')).toMatchObject({ kind: 'one', how: 'initials' })
  })

  it('takes whole words when only one game has them all', () => {
    expect(one('dungeons')).toBe('Minecraft Dungeons')
    expect(one('the grand theft auto')).toBe('Grand Theft Auto V')
    expect(one('Minecraft', [g('app:x', 'Minecraft Launcher')])).toBe('Minecraft Launcher')
  })

  it('asks rather than guessing between several', () => {
    const both = [g('steam:1', 'Minecraft Launcher'), g('steam:2', 'Minecraft Dungeons')]
    const m = findGame(both, 'minecraft')
    expect(m.kind).toBe('several')
    expect(m.kind === 'several' && m.games.map((x) => x.name)).toEqual(['Minecraft Launcher', 'Minecraft Dungeons'])
    // The same game from two shops is still two choices.
    expect(findGame([g('steam:1', 'Hades'), g('epic:Hades', 'Hades')], 'hades').kind).toBe('several')
  })

  it('never starts a game from part of a word, but suggests it', () => {
    const m = findGame(LIBRARY, 'craft')
    expect(m.kind).toBe('none')
    expect(m.kind === 'none' && m.close.map((x) => x.name)).toEqual(['Minecraft', 'Minecraft Dungeons'])
    expect(findGame(LIBRARY, 'fort').kind).toBe('none')
    expect(findGame(LIBRARY, 'port').kind).toBe('none')
  })

  it('suggests a name with a small typo instead of starting it', () => {
    const m = findGame(LIBRARY, 'minecarft')
    expect(m.kind).toBe('none')
    expect(m.kind === 'none' && m.close[0].name).toBe('Minecraft')
    expect(findGame(LIBRARY, 'fortnight')).toMatchObject({ kind: 'none', close: [{ name: 'Fortnite' }] })
  })

  it('says nothing is close when nothing is', () => {
    expect(findGame(LIBRARY, 'Stardew Valley')).toEqual({ kind: 'none', close: [] })
    expect(findGame(LIBRARY, 'the')).toEqual({ kind: 'none', close: [] })
    expect(findGame([], 'minecraft')).toEqual({ kind: 'none', close: [] })
  })

  it('only finds a hidden game by its whole name', () => {
    expect(one('wallpaper engine')).toBe('Wallpaper Engine')
    expect(findGame(LIBRARY, 'wallpaper').kind).toBe('none')
  })
})
