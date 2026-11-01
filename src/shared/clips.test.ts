import { describe, expect, it } from 'vitest'
import {
  cleanTrim,
  cleanWebhookUrl,
  clipArgs,
  clipFileName,
  concatList,
  discordPayload,
  discordSettings,
  isClipFile,
  parseRange,
  segmentsLength,
  segmentsToKeep
} from './clips'

const seg = (start: number, end: number): { start: number; end: number } => ({ start: start * 1000, end: end * 1000 })

describe('segmentsToKeep', () => {
  it('keeps the newest pieces that cover the time asked for', () => {
    const pieces = [seg(0, 5), seg(5, 10), seg(10, 15), seg(15, 20), seg(20, 25), seg(25, 30), seg(30, 35), seg(35, 37)]
    const kept = segmentsToKeep(pieces, 30)
    expect(kept[0].start).toBe(5000)
    expect(kept[kept.length - 1].end).toBe(37000)
    expect(segmentsLength(kept)).toBeGreaterThanOrEqual(30)
    expect(segmentsLength(kept)).toBeLessThan(36)
  })

  it('keeps everything while there is less than asked for', () => {
    const pieces = [seg(0, 5), seg(5, 8)]
    expect(segmentsToKeep(pieces, 30)).toHaveLength(2)
  })

  it('sorts pieces that finished out of order', () => {
    const kept = segmentsToKeep([seg(10, 15), seg(0, 5), seg(5, 10)], 7)
    expect(kept.map((s) => s.start)).toEqual([5000, 10000])
  })

  it('copes with nothing', () => expect(segmentsToKeep([], 30)).toEqual([]))
})

describe('file names', () => {
  it('has no colons and the right kind', () => {
    expect(clipFileName('Replay', new Date(2026, 9, 31, 14, 5, 9), 'mp4')).toBe('Replay 2026-10-31 14-05-09.mp4')
    expect(clipFileName('Clip', new Date(2026, 0, 2, 3, 4, 5), 'webm')).toBe('Clip 2026-01-02 03-04-05.webm')
  })
  it('knows which files are clips', () => {
    expect(isClipFile('Replay 1.mp4')).toBe(true)
    expect(isClipFile('a.WEBM')).toBe(true)
    expect(isClipFile('notes.txt')).toBe(false)
    expect(isClipFile('.hidden.mp4')).toBe(false)
  })
})

describe('concatList', () => {
  it('quotes paths for ffmpeg', () => {
    expect(concatList(['C:\\Temp\\a.mp4', "/tmp/it's.mp4"])).toBe("file 'C:/Temp/a.mp4'\nfile '/tmp/it'\\''s.mp4'\n")
  })
})

describe('discordSettings', () => {
  it('fits a 30 second clip under the limit at full height', () => {
    const s = discordSettings(30)
    expect(((s.videoKbps + s.audioKbps) * 1000 * 30) / 8).toBeLessThan(10_000_000)
    expect(s.height).toBe(720)
  })
  it('makes short clips sharper and long ones smaller', () => {
    expect(discordSettings(8).height).toBe(1080)
    expect(discordSettings(120).height).toBeLessThanOrEqual(480)
    expect(discordSettings(30, 0.8).videoKbps).toBeLessThan(discordSettings(30).videoKbps)
  })
})

describe('clipArgs', () => {
  it('cuts the part asked for and keeps full quality', () => {
    const args = clipArgs('in.mp4', { start: 2.5, end: 12 }, null)
    expect(args.slice(0, 6)).toEqual(['-ss', '2.5', '-t', '9.5', '-i', 'in.mp4'])
    expect(args).toContain('-crf')
    expect(args).toContain('0:a?')
  })
  it('lays the caption on and shrinks for Discord', () => {
    const args = clipArgs('in.mp4', { start: 0, end: 30, captionPosition: 'top', forDiscord: true }, 'cap.png')
    expect(args).toContain('cap.png')
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter).toContain('overlay=(main_w-overlay_w)/2:0')
    expect(filter).toContain("scale=-2:'min(ih,720)'")
    expect(args).toContain('-b:v')
  })
  it('puts a bottom caption at the bottom', () => {
    const args = clipArgs('in.mp4', { start: 0, end: 5, captionPosition: 'bottom' }, 'cap.png')
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('main_h-overlay_h')
  })
})

describe('cleanTrim', () => {
  it('keeps the trim inside the video', () => {
    expect(cleanTrim(-3, 99, 30)).toEqual({ start: 0, end: 30 })
    expect(cleanTrim(10, 5, 30)).toEqual({ start: 10, end: 10.1 })
    expect(cleanTrim(NaN, NaN, 20)).toEqual({ start: 0, end: 20 })
  })
})

describe('Discord webhooks', () => {
  const real = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABCDEFG-123'
  it('accepts real webhook addresses', () => {
    expect(cleanWebhookUrl(real)).toBe(real)
    expect(cleanWebhookUrl(real.replace('discord.com', 'discordapp.com'))).toBe(real)
    expect(cleanWebhookUrl(real.replace('discord.com', 'ptb.discord.com'))).toBe(real)
    expect(cleanWebhookUrl(`  ${real}/  `)).toBe(real)
  })
  it('refuses anything else', () => {
    expect(cleanWebhookUrl(real.replace('https', 'http'))).toBeNull()
    expect(cleanWebhookUrl(real.replace('discord.com', 'discord.com.evil.io'))).toBeNull()
    expect(cleanWebhookUrl('https://example.com/api/webhooks/1/2')).toBeNull()
    expect(cleanWebhookUrl(`${real}?x=1`)).toBeNull()
  })
  it('never pings everyone', () => {
    expect(JSON.parse(discordPayload(' @everyone look '))).toEqual({ content: '@everyone look', allowed_mentions: { parse: [] } })
  })
})

describe('parseRange', () => {
  it('reads what a video player asks for', () => {
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-30', 100)).toEqual({ start: 70, end: 99 })
  })
  it('refuses ranges outside the file', () => {
    expect(parseRange('bytes=100-', 100)).toBe('bad')
    expect(parseRange('bytes=50-10', 100)).toBe('bad')
  })
})
