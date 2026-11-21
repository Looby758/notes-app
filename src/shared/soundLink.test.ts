import { describe, expect, it } from 'vitest'
import { cleanPart, firstPart, MAX_PART_SECONDS, nameFromTitle, partArgs, partTime } from './soundLink'

describe('picking the part', () => {
  it('starts with the first few seconds, or all of a short sound', () => {
    expect(firstPart(60)).toEqual({ start: 0, end: 8 })
    expect(firstPart(3)).toEqual({ start: 0, end: 3 })
  })
  it('keeps the part inside the sound', () => {
    expect(cleanPart(-5, 4, 10)).toEqual({ start: 0, end: 4 })
    expect(cleanPart(2, 50, 10)).toEqual({ start: 2, end: 10 })
    expect(cleanPart(9.99, 9.99, 10)).toEqual({ start: 9.9, end: 10 })
  })
  it('is never longer than the most a button can be', () => {
    const movedEnd = cleanPart(0, 500, 600)
    expect(movedEnd.end - movedEnd.start).toBe(MAX_PART_SECONDS)
    expect(movedEnd.start).toBe(0)
    const movedStart = cleanPart(10, 400, 600, 'end')
    expect(movedStart).toEqual({ start: 400 - MAX_PART_SECONDS, end: 400 })
  })
})

describe('making the button', () => {
  it('cuts the part to an MP3 with tiny fades', () => {
    const args = partArgs('/tmp/in.mp3', 1.5, 4, '/tmp/out.mp3')
    expect(args.slice(0, 6)).toEqual(['-ss', '1.5', '-t', '2.5', '-i', '/tmp/in.mp3'])
    expect(args).toContain('libmp3lame')
    expect(args[args.length - 1]).toBe('/tmp/out.mp3')
    expect(args.join(' ')).toContain('afade=t=out:st=2.47')
  })
  it('names it from the video', () => {
    expect(nameFromTitle('Bruh sound effect #2 (Official Video) #meme #funny')).toBe('Bruh sound effect #2')
    expect(nameFromTitle('')).toBe('Sound')
    expect(nameFromTitle('x'.repeat(60))).toHaveLength(40)
  })
  it('shows times', () => {
    expect(partTime(7.5)).toBe('0:07.5')
    expect(partTime(62)).toBe('1:02.0')
  })
})
