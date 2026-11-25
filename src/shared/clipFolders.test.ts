import { describe, expect, it } from 'vitest'
import {
  cleanClipsMeta,
  cleanFolderName,
  clipRelPath,
  clipTitle,
  editedClipName,
  folderForGame,
  gameClipName,
  withFavourite,
  withGameFolder,
  withMovedClip,
  withRenamedFolder
} from './clips'

describe('clips sorted by game', () => {
  it('names a replay after the game and the time, with no colon in the file', () => {
    expect(gameClipName('SkyBlock', new Date(2026, 10, 21, 23, 10, 45), 'mp4')).toBe('SkyBlock 21 Nov 23.10.mp4')
    expect(gameClipName('Fortnite', new Date(2026, 0, 2, 3, 4), 'webm')).toBe('Fortnite 2 Jan 03.04.webm')
  })

  it('shows the time with a colon in the list', () => {
    expect(clipTitle('SkyBlock 21 Nov 23.10.mp4')).toBe('SkyBlock 21 Nov 23:10')
    expect(clipTitle('SkyBlock 21 Nov 23.10 (2).mp4')).toBe('SkyBlock 21 Nov 23:10 (2)')
    expect(clipTitle('SkyBlock 21 Nov 23.10 (edit).mp4')).toBe('SkyBlock 21 Nov 23:10 (edit)')
    expect(clipTitle('Replay 2026-10-31 14-05-09.mp4')).toBe('Replay 2026-10-31 14-05-09')
    expect(clipTitle('Version 1.2 21 Nov 09.30.mp4')).toBe('Version 1.2 21 Nov 09:30')
  })

  it('makes game names safe as folder names', () => {
    expect(cleanFolderName('Half-Life: Alyx')).toBe('Half-Life Alyx')
    expect(cleanFolderName('  ..what?  ')).toBe('what')
    expect(cleanFolderName('a/b\\c')).toBe('a b c')
    expect(cleanFolderName('CON')).toBe('CON clips')
    expect(cleanFolderName('???')).toBe('')
    expect(cleanFolderName('x'.repeat(100))).toHaveLength(60)
  })

  it('names edited copies after the clip', () => {
    expect(editedClipName('SkyBlock 21 Nov 23.10.webm')).toBe('SkyBlock 21 Nov 23.10 (edit).mp4')
    expect(editedClipName('SkyBlock 21 Nov 23.10 (edit) (2).mp4')).toBe('SkyBlock 21 Nov 23.10 (edit).mp4')
  })

  it('only accepts clips at the top or one folder down', () => {
    expect(clipRelPath('a.mp4')).toBe('a.mp4')
    expect(clipRelPath('SkyBlock/a.mp4')).toBe('SkyBlock/a.mp4')
    expect(clipRelPath('../a.mp4')).toBeNull()
    expect(clipRelPath('a/b/c.mp4')).toBeNull()
    expect(clipRelPath('a\\b.mp4')).toBeNull()
    expect(clipRelPath('SkyBlock/notes.txt')).toBeNull()
    expect(clipRelPath('/a.mp4')).toBeNull()
  })

  it('remembers which folder a game goes in, and follows a rename', () => {
    let meta = cleanClipsMeta(null)
    expect(folderForGame(meta, 'Minecraft')).toBe('Minecraft')
    meta = withGameFolder(meta, 'Minecraft', 'Minecraft')
    meta = withFavourite(meta, 'Minecraft/Minecraft 21 Nov 23.10.mp4', true)
    meta = withRenamedFolder(meta, 'Minecraft', 'SkyBlock')
    expect(folderForGame(meta, 'Minecraft')).toBe('SkyBlock')
    expect(meta.folders).toEqual(['SkyBlock'])
    expect(meta.favourites).toEqual(['SkyBlock/Minecraft 21 Nov 23.10.mp4'])
  })

  it('moves a star with its clip, and unstars', () => {
    let meta = withFavourite(cleanClipsMeta(null), 'a.mp4', true)
    meta = withMovedClip(meta, 'a.mp4', 'SkyBlock/a.mp4')
    expect(meta.favourites).toEqual(['SkyBlock/a.mp4'])
    expect(withFavourite(meta, 'SkyBlock/a.mp4', false).favourites).toEqual([])
  })

  it('repairs a damaged file', () => {
    const meta = cleanClipsMeta({ folders: ['SkyBlock', 'SkyBlock', 5, '../x'], games: { Minecraft: 'SkyBlock', Other: 'Nowhere', Bad: 3 }, favourites: ['../a.mp4', 'b.mp4', 'b.mp4'] })
    expect(meta).toEqual({ folders: ['SkyBlock', 'x'], games: { Minecraft: 'SkyBlock' }, favourites: ['b.mp4'] })
  })
})
