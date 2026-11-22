import { describe, expect, it } from 'vitest'
import { activeLine, looksTimed, lyricsPathFor, parseLyrics } from './lyrics'

describe('lyrics', () => {
  it('reads timed .lrc lines in order, skipping the file details', () => {
    const l = parseLyrics('[ar: Someone]\n[00:12.50]Second\n[00:05.00]First\n[01:02.3][01:10]Chorus\n', 'lrc')!
    expect(l.synced).toBe(true)
    expect(l.lines).toEqual([
      { at: 5000, text: 'First' },
      { at: 12500, text: 'Second' },
      { at: 62300, text: 'Chorus' },
      { at: 70000, text: 'Chorus' }
    ])
  })
  it('finds the line being sung', () => {
    const l = parseLyrics('[00:05.00]A\n[00:10.00]B\n[00:20.00]C', 'lrc')!
    expect(activeLine(l, 1000)).toBe(-1)
    expect(activeLine(l, 5000)).toBe(0)
    expect(activeLine(l, 15000)).toBe(1)
    expect(activeLine(l, 99000)).toBe(2)
  })
  it('keeps plain lyrics as they are, without runs of empty lines', () => {
    const l = parseLyrics('﻿One\r\n\r\n\r\nTwo\n\n', 'txt')!
    expect(l.synced).toBe(false)
    expect(l.lines.map((x) => x.text)).toEqual(['One', '', 'Two'])
    expect(activeLine(l, 5000)).toBe(-1)
    expect(parseLyrics('  \n ', 'txt')).toBeNull()
  })
  it('names the file next to the song', () => {
    expect(lyricsPathFor('Albums/My Song.mp3', 'lrc')).toBe('Albums/My Song.lrc')
    expect(looksTimed('hello\n[01:02.03] words')).toBe(true)
    expect(looksTimed('hello [world]')).toBe(false)
  })
})
