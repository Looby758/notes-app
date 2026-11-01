import { describe, expect, it } from 'vitest'
import { checksumFor, cookiesFile, downloadArgs, explainDownloadError, formatArgs, parseVideoLink, readLine, siteName, titleOf } from './videoDownload'

describe('parseVideoLink', () => {
  it('reads links, adding https:// when it’s missing', () => {
    expect(parseVideoLink(' https://www.youtube.com/watch?v=abc ')?.href).toBe('https://www.youtube.com/watch?v=abc')
    expect(parseVideoLink('youtu.be/abc')?.href).toBe('https://youtu.be/abc')
    expect(parseVideoLink('x.com/someone/status/123')?.hostname).toBe('x.com')
  })
  it('refuses things that aren’t web links', () => {
    expect(parseVideoLink('')).toBeNull()
    expect(parseVideoLink('hello there')).toBeNull()
    expect(parseVideoLink('file:///C:/a.mp4')).toBeNull()
    expect(parseVideoLink('javascript:alert(1)')).toBeNull()
    expect(parseVideoLink('localhost')).toBeNull()
    expect(parseVideoLink('https://me:pw@example.com/v')).toBeNull()
  })
})

describe('siteName', () => {
  it('names the big sites', () => {
    const name = (s: string): string => siteName(parseVideoLink(s)!)
    expect(name('https://m.youtube.com/shorts/x')).toBe('YouTube')
    expect(name('https://youtu.be/x')).toBe('YouTube')
    expect(name('https://twitter.com/a/status/1')).toBe('X')
    expect(name('https://www.instagram.com/reel/x/')).toBe('Instagram')
    expect(name('https://vm.tiktok.com/x')).toBe('TikTok')
    expect(name('https://www.example.org/v')).toBe('example.org')
  })
})

describe('formatArgs', () => {
  it('joins H.264 video and AAC sound into an MP4 when ffmpeg is there', () => {
    const args = formatArgs('1080', true)
    expect(args[1].startsWith('bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]')).toBe(true)
    expect(args).toContain('--merge-output-format')
  })
  it('only takes ready-joined files without ffmpeg', () => {
    expect(formatArgs('720', false)).toEqual(['-f', 'b[height<=720][ext=mp4]/b[height<=720]/b'])
  })
  it('makes MP3s for sound only', () => {
    expect(formatArgs('audio', true)).toContain('mp3')
    expect(formatArgs('audio', false)).not.toContain('-x')
  })
})

describe('downloadArgs', () => {
  it('puts the link last, after --', () => {
    const args = downloadArgs({ url: '--exec=bad', quality: '1080', outDir: '/tmp/x', ffmpeg: '/ff', cookies: '/c.txt', jsRuntime: 'node:/e' })
    expect(args.slice(-2)).toEqual(['--', '--exec=bad'])
    expect(args).toContain('--no-playlist')
    expect(args[args.indexOf('--ffmpeg-location') + 1]).toBe('/ff')
    expect(args[args.indexOf('--cookies') + 1]).toBe('/c.txt')
    expect(args[args.indexOf('--js-runtimes') + 1]).toBe('node:/e')
  })
  it('leaves out what isn’t there', () => {
    const args = downloadArgs({ url: 'https://a.com', quality: '720', outDir: '/tmp/x' })
    expect(args).not.toContain('--ffmpeg-location')
    expect(args).not.toContain('--cookies')
  })
})

describe('readLine', () => {
  it('reads progress', () => {
    expect(readLine('[orbit] 500 1000 NA')).toEqual({ kind: 'progress', done: 0.5 })
    expect(readLine('[orbit] 250 NA 1000')).toEqual({ kind: 'progress', done: 0.25 })
    expect(readLine('[orbit] 250 NA NA')).toEqual({ kind: 'progress', done: null })
  })
  it('sees each part start, and the joining', () => {
    expect(readLine('[download] Destination: C:\\T\\My clip.f137.mp4')).toEqual({ kind: 'part', title: 'My clip' })
    expect(readLine('[Merger] Merging formats into "x.mp4"')).toEqual({ kind: 'joining' })
    expect(readLine('[youtube] abc: Downloading webpage')).toBeNull()
  })
  it('titles', () => {
    expect(titleOf('/tmp/a/Song (Live).f251-drc.webm')).toBe('Song (Live)')
    expect(titleOf('/tmp/a/v1.2 final.mp4')).toBe('v1.2 final')
  })
})

describe('explainDownloadError', () => {
  it('puts common errors in plain words', () => {
    expect(explainDownloadError('ERROR: Unsupported URL: https://a.com', 'a.com')).toMatch(/couldn’t find a video/)
    expect(explainDownloadError('ERROR: [Instagram] x: Requested content is not available, rate-limit reached or login required', 'Instagram')).toMatch(/signed in/)
    expect(explainDownloadError('ERROR: [youtube] x: Private video. Sign in if you\'ve been granted access', 'YouTube')).toMatch(/private/)
    expect(explainDownloadError('ERROR: [youtube] x: Sign in to confirm you’re not a bot', 'YouTube')).toMatch(/robot/)
  })
  it('falls back to what yt-dlp said', () => {
    expect(explainDownloadError('WARNING: x\nERROR: [generic] abc: Something odd', 'a.com')).toBe('The video couldn’t be downloaded: Something odd')
  })
})

describe('checksumFor', () => {
  it('finds the file’s hash', () => {
    const sums = `${'a'.repeat(64)}  yt-dlp\n${'b'.repeat(64)}  yt-dlp.exe\n`
    expect(checksumFor(sums, 'yt-dlp.exe')).toBe('b'.repeat(64))
    expect(checksumFor(sums, 'yt-dlp_macos')).toBeNull()
  })
})

describe('cookiesFile', () => {
  it('keeps only the link’s own site', () => {
    const file = cookiesFile(
      [
        { name: 'sessionid', value: 's1', domain: '.instagram.com', path: '/', secure: true, expirationDate: 2000000000.5 },
        { name: 'other', value: 'x', domain: 'www.google.com', hostOnly: true },
        { name: 'evil', value: 'x', domain: 'notinstagram.com' }
      ],
      'www.instagram.com'
    )
    expect(file).toBe('# Netscape HTTP Cookie File\n.instagram.com\tTRUE\t/\tTRUE\t2000000000\tsessionid\ts1\n')
    expect(cookiesFile([{ name: 'a', value: 'b', domain: 'google.com' }], 'x.com')).toBeNull()
  })
})
