import { describe, expect, it } from 'vitest'
import { gifLength, gifMakerArgs, parseTime, videoArgs } from './videoArgs'

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

describe('GIF maker', () => {
  const gif = { start: 60, end: 65, crop: { x: 421, y: 0, w: 1081, h: 1080 }, speed: 1.5, fps: 15, width: 401, caption: null }

  it('takes just the chosen seconds, cropped and sped up', () => {
    const args = gifMakerArgs('in.mov', gif, null)
    expect(args.slice(0, 6)).toEqual(['-ss', '60', '-t', '5', '-i', 'in.mov'])
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter).toContain('crop=1080:1080:421:0')
    expect(filter).toContain('setpts=PTS/1.5')
    expect(filter).toContain('fps=15')
    expect(filter).toContain('scale=400:-2')
    expect(gifLength(gif)).toBeCloseTo(5 / 1.5)
  })

  it('puts the caption bar on top or underneath', () => {
    const top = gifMakerArgs('in.mov', { ...gif, caption: { position: 'top' } as never }, 'cap.png', 90)
    expect(top).toContain('cap.png')
    expect(top[top.indexOf('-filter_complex') + 1]).toMatch(/pad=iw:ih\+90:0:90.*overlay=0:0/)
    const bottom = gifMakerArgs('in.mov', { ...gif, caption: { position: 'bottom' } as never }, 'cap.png', 90)
    expect(bottom[bottom.indexOf('-filter_complex') + 1]).toMatch(/pad=iw:ih\+90:0:0.*overlay=0:main_h-90/)
  })

  it('keeps settings sensible', () => {
    const args = gifMakerArgs('in.mov', { ...gif, speed: 100, fps: 500, width: 99999, crop: null }, null)
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter).toContain('setpts=PTS/4')
    expect(filter).toContain('fps=30')
    expect(filter).toContain('scale=1280:-2')
    expect(filter).not.toContain('crop=')
  })
})
