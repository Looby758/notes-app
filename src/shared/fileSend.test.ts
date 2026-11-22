import { describe, expect, it } from 'vitest'
import {
  CODE_WORDS,
  bytesDone,
  codeText,
  driveReceived,
  freeName,
  makeCode,
  parseCode,
  readManifest,
  routeOf,
  runnableFiles,
  safeRelPath,
  sendTitle,
  settle,
  validPosition
} from './fileSend'

describe('codes', () => {
  it('has 256 different words', () => {
    expect(CODE_WORDS.length).toBe(256)
    expect(new Set(CODE_WORDS).size).toBe(256)
    expect(CODE_WORDS.every((w) => /^[a-z]+$/.test(w))).toBe(true)
  })

  it('makes a code and reads it back', () => {
    let n = 0
    const code = makeCode((min, max) => Math.min(max - 1, min + n++ * 7))
    const text = codeText(code)
    expect(text).toMatch(/^\d{4}-[a-z]+-[a-z]+-[a-z]+$/)
    expect(parseCode(text)).toEqual(code)
  })

  it('reads codes typed loosely', () => {
    expect(parseCode('  4821 Tiger PIANO river ')).toEqual({ room: 4821, words: ['tiger', 'piano', 'river'] })
    expect(parseCode('4821-tiger_piano.river')).toEqual({ room: 4821, words: ['tiger', 'piano', 'river'] })
  })

  it('turns down things that are not codes', () => {
    expect(parseCode('')).toBeNull()
    expect(parseCode('4821-tiger-piano')).toBeNull()
    expect(parseCode('482-tiger-piano-river')).toBeNull()
    expect(parseCode('0999-tiger-piano-river')).toBeNull()
    expect(parseCode('4821-tiger-piano-notaword')).toBeNull()
  })
})

describe('safeRelPath', () => {
  it('keeps ordinary paths', () => {
    expect(safeRelPath('My game/data/level 1.pak')).toBe('My game/data/level 1.pak')
    expect(safeRelPath('folder\\file.txt')).toBe('folder/file.txt')
  })

  it('never leaves the folder', () => {
    expect(safeRelPath('../../Windows/system32/evil.dll')).toBe('Windows/system32/evil.dll')
    expect(safeRelPath('/etc/passwd')).toBe('etc/passwd')
    expect(safeRelPath('C:\\Users\\me\\x.txt')).toBe('C_/Users/me/x.txt')
    expect(safeRelPath('..')).toBeNull()
    expect(safeRelPath('')).toBeNull()
    expect(safeRelPath(42)).toBeNull()
  })

  it('makes names Windows can save', () => {
    expect(safeRelPath('what?.txt')).toBe('what_.txt')
    expect(safeRelPath('con.txt')).toBe('_con.txt')
    expect(safeRelPath('trailing. ')).toBe('trailing')
  })
})

describe('readManifest', () => {
  it('reads a good one', () => {
    const m = readManifest({ from: 'Looby-PC', files: [{ path: 'a.txt', size: 3 }, { path: 'b/c.bin', size: 10 }] })
    expect(m).toEqual({ from: 'Looby-PC', files: [{ path: 'a.txt', size: 3 }, { path: 'b/c.bin', size: 10 }], total: 13 })
  })

  it('turns down bad ones', () => {
    expect(readManifest(null)).toBeNull()
    expect(readManifest({ files: [] })).toBeNull()
    expect(readManifest({ files: [{ path: 'a', size: -1 }] })).toBeNull()
    expect(readManifest({ files: [{ path: 'a', size: 1.5 }] })).toBeNull()
    expect(readManifest({ files: [{ path: '..', size: 1 }] })).toBeNull()
    // Would land on the same file on Windows.
    expect(readManifest({ files: [{ path: 'A.txt', size: 1 }, { path: 'a.txt', size: 1 }] })).toBeNull()
  })

  it('names an unnamed sender', () => {
    expect(readManifest({ files: [{ path: 'a', size: 1 }] })?.from).toBe('Someone')
  })
})

describe('positions', () => {
  const files = [
    { path: 'a', size: 10 },
    { path: 'empty', size: 0 },
    { path: 'b', size: 5 }
  ]

  it('counts bytes done', () => {
    expect(bytesDone(files, { index: 0, offset: 4 })).toBe(4)
    expect(bytesDone(files, { index: 2, offset: 1 })).toBe(11)
    expect(bytesDone(files, { index: 3, offset: 0 })).toBe(15)
  })

  it('moves past finished and empty files', () => {
    const pos = { index: 0, offset: 10 }
    expect(settle(files, pos)).toEqual([0, 1])
    expect(pos).toEqual({ index: 2, offset: 0 })
    const end = { index: 2, offset: 5 }
    expect(settle(files, end)).toEqual([2])
    expect(end).toEqual({ index: 3, offset: 0 })
  })

  it('checks positions from the other computer', () => {
    expect(validPosition(files, { index: 2, offset: 5 })).toEqual({ index: 2, offset: 5 })
    expect(validPosition(files, { index: 3, offset: 0 })).toEqual({ index: 3, offset: 0 })
    expect(validPosition(files, { index: 2, offset: 6 })).toBeNull()
    expect(validPosition(files, { index: 4, offset: 0 })).toBeNull()
    expect(validPosition(files, { index: -1, offset: 0 })).toBeNull()
    expect(validPosition(files, 'nope')).toBeNull()
  })
})

describe('little helpers', () => {
  it('names a send', () => {
    expect(sendTitle([{ path: 'Game/a', size: 1 }, { path: 'Game/b', size: 1 }])).toBe('Game')
    expect(sendTitle([{ path: 'a.mp4', size: 1 }, { path: 'b.mp4', size: 1 }, { path: 'c/d', size: 1 }])).toBe('a.mp4 and 2 more')
  })

  it('spots programs', () => {
    expect(runnableFiles([{ path: 'Game/setup.EXE', size: 1 }, { path: 'video.mp4', size: 1 }])).toEqual(['Game/setup.EXE'])
  })

  it('finds a free name', () => {
    const taken = new Set(['photo.jpg', 'photo (2).jpg', 'Game'])
    expect(freeName('photo.jpg', (n) => taken.has(n))).toBe('photo (3).jpg')
    expect(freeName('Game', (n) => taken.has(n))).toBe('Game (2)')
    expect(freeName('new.txt', (n) => taken.has(n))).toBe('new.txt')
  })

  it('tells the route', () => {
    expect(routeOf({ candidateType: 'relay' }, { candidateType: 'srflx', address: '8.8.8.8' })).toBe('relay')
    expect(routeOf({ candidateType: 'host' }, { candidateType: 'host', address: '192.168.1.20' })).toBe('local')
    expect(routeOf({ candidateType: 'srflx' }, { candidateType: 'srflx', address: '81.2.3.4' })).toBe('direct')
    expect(routeOf(undefined, undefined)).toBeUndefined()
  })

  it('reads how much Drive has', () => {
    expect(driveReceived('bytes=0-262143')).toBe(262144)
    expect(driveReceived(null)).toBe(0)
  })
})
