import { describe, expect, it } from 'vitest'
import { isTakePath, joinArgs, joinedFileName, safeName, scriptName, takeFileName, takesFolderName } from './takes'

describe('section take files', () => {
  it('names takes after the section, in script order', () => {
    expect(takeFileName(1, 'The prison', 3, 'm4a')).toBe('02 The prison - take 3.m4a')
    expect(takeFileName(0, '', 1, 'm4a')).toBe('01 Opening - take 1.m4a')
    expect(takeFileName(4, 'What? A "twist": yes/no', 1, 'webm')).toBe('05 What A twist yes no - take 1.webm')
  })

  it('keeps folder and file names safe', () => {
    expect(scriptName('Videos/Rick/Script - Rick and Morty.md')).toBe('Script - Rick and Morty')
    expect(takesFolderName('a\\Script.md')).toBe('Script sections')
    expect(safeName('  ..  ', 'Section')).toBe('Section')
    expect(safeName('x'.repeat(100), 'S').length).toBe(60)
    expect(joinedFileName('Script.md')).toBe('Script voiceover (joined).wav')
    expect(joinedFileName('Script.md', 2)).toBe('Script voiceover (joined 2).wav')
  })

  it('only treats the Studio’s own take files as takes', () => {
    expect(isTakePath('C:\\Videos\\Orbit Recordings\\Script sections\\02 The prison - take 3.m4a')).toBe(true)
    expect(isTakePath('/home/me/Script sections/02 The prison - take 3.m4a')).toBe(true)
    expect(isTakePath('/home/me/Documents/02 The prison - take 3.m4a')).toBe(false)
    expect(isTakePath('/home/me/Script sections/passwords.txt')).toBe(false)
    expect(isTakePath('/home/me/Script sections/02 x - take 3.exe')).toBe(false)
  })

  it('joins takes from where the words start, with tiny fades', () => {
    const args = joinArgs(
      [
        { path: 'a.m4a', from: 2.65, length: 0 },
        { path: 'b.m4a', from: 2.6, length: 10 }
      ],
      'out.wav'
    )
    expect(args.slice(0, 3)).toEqual(['-ss', '2.65', '-i'])
    expect(args).toContain('-t')
    const graph = args[args.indexOf('-filter_complex') + 1]
    expect(graph).toContain('[a0][a1]concat=n=2:v=0:a=1[out]')
    expect(graph).toContain('afade=t=out:st=9.97:d=0.03')
    expect(args.slice(-3)).toEqual(['-c:a', 'pcm_s16le', 'out.wav'])
  })
})
