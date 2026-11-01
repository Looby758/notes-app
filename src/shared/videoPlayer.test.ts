import { describe, expect, it } from 'vitest'
import {
  cuesAt,
  formatTime,
  isVideoFile,
  matchingSubtitles,
  parseKeyframe,
  parseProbe,
  parseSubtitles,
  playMode,
  resumePoint,
  stepSpeed,
  streamArgs,
  trackLabel,
  type VideoProbe
} from './videoPlayer'

const MKV = `Input #0, matroska,webm, from 'a.mkv':
  Metadata:
    ENCODER         : Lavf60.16.100
  Duration: 01:42:20.02, start: -0.023000, bitrate: 958 kb/s
  Stream #0:0: Video: h264 (High), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 23.98 fps, 23.98 tbr, 1k tbn (default)
    Metadata:
      ENCODER         : Lavc60.31.102 libx264
  Stream #0:1(eng): Audio: ac3, 48000 Hz, 5.1(side), fltp, 384 kb/s (default)
    Metadata:
      title           : Surround
  Stream #0:2(jpn): Audio: aac (LC), 44100 Hz, stereo, fltp
    Metadata:
      title           : Japanese 2.0
  Stream #0:3(eng): Subtitle: subrip (default)
    Metadata:
      title           : English
  Stream #0:4(eng): Subtitle: hdmv_pgs_subtitle, 1920x1080
  Stream #0:5: Attachment: ttf
At least one output file must be specified`

const MP4 = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'c.mp4':
  Duration: 00:00:20.02, start: 0.000000, bitrate: 433 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 640x360, 25 fps (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 69 kb/s (default)
  Stream #0:2[0x3](und): Video: mjpeg (Baseline), yuvj420p, 300x300 (attached pic)`

const AVI = `Input #0, avi, from 'b.avi':
  Duration: 00:00:20.04, start: 0.000000, bitrate: 433 kb/s
  Stream #0:0: Video: mpeg4 (Simple Profile) (FMP4 / 0x34504D46), yuv420p, 640x360 [SAR 1:1 DAR 16:9], 354 kb/s, 25 fps, 25 tbr, 25 tbn
  Stream #0:1: Audio: mp3 (U[0][0][0] / 0x0055), 44100 Hz, mono, fltp, 64 kb/s`

describe('video player', () => {
  it('knows video files', () => {
    expect(isVideoFile('Film.MKV')).toBe(true)
    expect(isVideoFile('old.avi')).toBe(true)
    expect(isVideoFile('song.mp3')).toBe(false)
  })

  it('reads what ffmpeg says about a file', () => {
    const p = parseProbe(MKV)!
    expect(p.container).toBe('matroska,webm')
    expect(p.duration).toBeCloseTo(6140.02)
    expect(p.start).toBeCloseTo(-0.023)
    expect(p.video).toEqual({ codec: 'h264', width: 1920, height: 1080 })
    expect(p.audio.map((a) => [a.stream, a.codec, a.language, a.title, a.channels, a.isDefault])).toEqual([
      [1, 'ac3', 'eng', 'Surround', '5.1', true],
      [2, 'aac', 'jpn', 'Japanese 2.0', 'stereo', false]
    ])
    expect(p.subtitles.map((s) => [s.stream, s.codec, s.title, s.text])).toEqual([
      [3, 'subrip', 'English', true],
      [4, 'hdmv_pgs_subtitle', null, false]
    ])
    expect(parseProbe('not a video')).toBeNull()
  })

  it('skips album art and reads MP4 stream ids', () => {
    const p = parseProbe(MP4)!
    expect(p.video?.codec).toBe('h264')
    expect(p.audio[0].stream).toBe(1)
  })

  it('plays what it can directly and converts the rest', () => {
    const mp4 = parseProbe(MP4)!
    const mkv = parseProbe(MKV)!
    const avi = parseProbe(AVI)!
    expect(playMode(mp4)).toBe('direct')
    // H.264 with Dolby sound: only the sound is converted.
    expect(playMode(mkv)).toBe('remux')
    // The Japanese track is AAC, but the window only plays the first track.
    expect(playMode(mkv, 1)).toBe('remux')
    expect(playMode(avi)).toBe('transcode')
    // If the window turns out not to manage it, the next way is tried.
    expect(playMode(mp4, 0, ['direct'])).toBe('remux')
    expect(playMode(mp4, 0, ['direct', 'remux'])).toBe('transcode')
    const hevc: VideoProbe = { ...mp4, video: { codec: 'hevc', width: 3840, height: 2160 } }
    expect(playMode(hevc)).toBe('direct')
    expect(playMode(hevc, 0, ['direct'])).toBe('transcode')
  })

  it('builds the live stream', () => {
    const remux = streamArgs('C:\\Films\\a.mkv', { mode: 'remux', start: 90, audio: 1 })
    expect(remux.slice(remux.indexOf('-ss'), remux.indexOf('-ss') + 4)).toEqual(['-ss', '90.000', '-i', 'C:\\Films\\a.mkv'])
    expect(remux).toContain('0:a:1?')
    expect(remux[remux.indexOf('-c:v') + 1]).toBe('copy')
    expect(remux.slice(-3)).toEqual(['-f', 'mp4', 'pipe:1'])
    const trans = streamArgs('b.avi', { mode: 'transcode', start: 0, audio: 0 })
    expect(trans).not.toContain('-ss')
    expect(trans).toContain('libx264')
    expect(trans[trans.indexOf('-vf') + 1]).toBe("scale=-2:'min(ih,1080)'")
  })

  it('finds the keyframe a copied stream starts on', () => {
    const out = `#tb 0: 1/1000\n#media_type 0: video\n#stream#, dts,        pts, duration,     size, hash\n0,       5920,       6000,       40,    12066, 1a63`
    expect(parseKeyframe(out)).toBe(6)
    expect(parseKeyframe('')).toBeNull()
  })

  it('names tracks', () => {
    const p = parseProbe(MKV)!
    expect(trackLabel(p.audio[0], 0)).toBe('English · Surround · 5.1 · Dolby')
    expect(trackLabel(p.audio[1], 1)).toBe('Japanese 2.0 · AAC')
    expect(trackLabel(p.subtitles[1], 1)).toBe('English')
  })

  it('formats times', () => {
    expect(formatTime(75)).toBe('1:15')
    expect(formatTime(3725)).toBe('1:02:05')
    expect(formatTime(NaN)).toBe('0:00')
  })

  it('reads SRT subtitles', () => {
    const srt = '\uFEFF1\r\n00:00:01,000 --> 00:00:03,500\r\nHello <i>there</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nSecond line\r\nwith two rows\r\n'
    expect(parseSubtitles(srt, 'a.srt')).toEqual([
      { start: 1, end: 3.5, text: 'Hello there' },
      { start: 4, end: 6, text: 'Second line\nwith two rows' }
    ])
  })

  it('reads WebVTT subtitles', () => {
    const vtt = 'WEBVTT\n\nNOTE made by hand\n\n00:01.000 --> 00:02.500 align:start\nShort &amp; sweet\n\nid-2\n01:00:00.000 --> 01:00:01.000\nAn hour in'
    expect(parseSubtitles(vtt, 'a.vtt')).toEqual([
      { start: 1, end: 2.5, text: 'Short & sweet' },
      { start: 3600, end: 3601, text: 'An hour in' }
    ])
  })

  it('reads ASS subtitles', () => {
    const ass = `[Script Info]\nTitle: x\n\n[V4+ Styles]\nFormat: Name, Fontname\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:05.00,0:00:07.50,Default,,0,0,0,,{\\i1}Wait,{\\i0} what?\\NNo way\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,First`
    expect(parseSubtitles(ass, 'a.ass')).toEqual([
      { start: 1, end: 2, text: 'First' },
      { start: 5, end: 7.5, text: 'Wait, what?\nNo way' }
    ])
  })

  it('finds the subtitles on screen', () => {
    const cues = [
      { start: 1, end: 3, text: 'a' },
      { start: 2, end: 5, text: 'b' },
      { start: 6, end: 7, text: 'c' }
    ]
    expect(cuesAt(cues, 0.5)).toEqual([])
    expect(cuesAt(cues, 2.5).map((c) => c.text)).toEqual(['a', 'b'])
    expect(cuesAt(cues, 5.5)).toEqual([])
    expect(cuesAt(cues, 6.5).map((c) => c.text)).toEqual(['c'])
  })

  it('finds subtitle files that belong to a video', () => {
    expect(matchingSubtitles('Film (2020).mkv', ['Film (2020).en.srt', 'Film (2020).srt', 'Other.srt', 'Film (2020).nfo', 'film (2020).forced.ass'])).toEqual([
      'Film (2020).srt',
      'Film (2020).en.srt',
      'film (2020).forced.ass'
    ])
  })

  it('carries on where you stopped', () => {
    expect(resumePoint(undefined, 100)).toBeNull()
    expect(resumePoint(5, 6000)).toBeNull()
    expect(resumePoint(1234, 6000)).toBe(1234)
    // In the credits: start again next time.
    expect(resumePoint(5900, 6000)).toBeNull()
    expect(resumePoint(1234, null)).toBe(1234)
  })

  it('steps through speeds', () => {
    expect(stepSpeed(1, 1)).toBe(1.25)
    expect(stepSpeed(1, -1)).toBe(0.75)
    expect(stepSpeed(3, 1)).toBe(3)
    expect(stepSpeed(0.25, -1)).toBe(0.25)
    expect(stepSpeed(1.1, -1)).toBe(1)
  })
})
