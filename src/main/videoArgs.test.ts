import { describe, expect, it } from 'vitest'
import { parseTime, videoArgs } from './videoArgs'

describe('video converter', () => {
  it('makes MP4s that play everywhere', () => {
    const args = videoArgs('mp4', null)
    expect(args).toContain('libx264')
    expect(args).toContain('aac')
    expect(args).toContain('+faststart')
    expect(args).not.toContain('-vf')
  })

  it('only ever shrinks the picture', () => {
    const args = videoArgs('mp4', 720)
    expect(args[args.indexOf('-vf') + 1]).toBe("scale=-2:'min(ih,720)'")
  })

  it('takes just the sound', () => {
    expect(videoArgs('mp3', 720)).toEqual(['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'])
    expect(videoArgs('wav', null)[0]).toBe('-vn')
  })

  it('keeps GIFs small and silent', () => {
    const args = videoArgs('gif', null)
    expect(args[1]).toMatch(/fps=12/)
    expect(args[1]).toMatch(/min\(iw,480\)/)
    expect(args).toContain('-an')
  })

  it('refuses formats videos can’t become', () => {
    expect(() => videoArgs('docx', null)).toThrow()
  })

  it('reads ffmpeg times', () => {
    expect(parseTime('00:01:30.50')).toBe(90.5)
    expect(parseTime('Duration: 01:00:00.00, start')).toBe(3600)
    expect(parseTime('N/A')).toBeNull()
  })
})
