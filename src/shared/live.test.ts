import { describe, expect, it } from 'vitest'
import { ingestUrl, liveBitrate, parseFfmpegStats, streamHealth } from './live'
import { qualityById } from './studio'

describe('live', () => {
  it('builds the address to stream to', () => {
    expect(ingestUrl('twitch', 'live_123')).toBe('rtmp://live.twitch.tv/app/live_123')
    expect(ingestUrl('youtube', 'abcd-efgh')).toBe('rtmp://a.rtmp.youtube.com/live2/abcd-efgh')
    expect(ingestUrl('custom', 'k', 'rtmp://example.com/live/')).toBe('rtmp://example.com/live/k')
    expect(ingestUrl('custom', 'k', 'https://example.com')).toBeNull()
    expect(ingestUrl('custom', 'k', '')).toBeNull()
  })

  it('keeps Twitch within its bitrate limit', () => {
    expect(liveBitrate(qualityById('1080p60'), 'twitch')).toBeLessThanOrEqual(6000)
    expect(liveBitrate(qualityById('1080p60'), 'youtube')).toBeGreaterThan(6000)
    expect(liveBitrate(qualityById('720p30'), 'twitch')).toBe(3500)
  })

  it('reads ffmpeg progress lines', () => {
    const s = parseFfmpegStats('frame=  120 fps= 30 q=21.0 size=    1024kB time=00:00:04.00 bitrate=2097.2kbits/s drop=2 speed=1.01x')
    expect(s).toEqual({ fps: 30, kbps: 2097.2, speed: 1.01, dropped: 2 })
    expect(parseFfmpegStats('rtmp://••••: Input/output error')).toBeNull()
  })

  it('sums up stream health', () => {
    expect(streamHealth(null, 30).text).toMatch(/Connecting/)
    expect(streamHealth({ fps: 30, kbps: 6000, speed: 1, dropped: 0 }, 30).level).toBe('good')
    expect(streamHealth({ fps: 20, kbps: 6000, speed: 1, dropped: 0 }, 30).level).toBe('ok')
    expect(streamHealth({ fps: 20, kbps: 6000, speed: 0.7, dropped: 0 }, 30).level).toBe('bad')
  })
})
