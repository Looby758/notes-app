import { describe, expect, it } from 'vitest'
import { isYouTubeUrl, toYouTubeUrl, youTubeStartTime, youTubeVideoId, youTubeWatchUrl } from './youtube'

describe('youTubeVideoId', () => {
  it('finds the video in every kind of link', () => {
    expect(youTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youTubeVideoId('https://youtube.com/watch?list=PL1&v=dQw4w9WgXcQ&index=2')).toBe('dQw4w9WgXcQ')
    expect(youTubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youTubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=abc')).toBe('dQw4w9WgXcQ')
    expect(youTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youTubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ?feature=share')).toBe('dQw4w9WgXcQ')
  })

  it('ignores pages that are not a video', () => {
    expect(youTubeVideoId('https://www.youtube.com/')).toBeNull()
    expect(youTubeVideoId('https://www.youtube.com/@channel')).toBeNull()
    expect(youTubeVideoId('https://www.youtube.com/watch?v=short')).toBeNull()
    expect(youTubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
  })
})

describe('youTubeStartTime', () => {
  it('reads the start time', () => {
    expect(youTubeStartTime('https://youtu.be/dQw4w9WgXcQ?t=90')).toBe(90)
    expect(youTubeStartTime('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toBe(42)
    expect(youTubeStartTime('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s')).toBe(3723)
    expect(youTubeStartTime('https://www.youtube.com/embed/dQw4w9WgXcQ?start=15')).toBe(15)
    expect(youTubeStartTime('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(0)
  })
})

describe('toYouTubeUrl', () => {
  it('opens video links as their watch page', () => {
    expect(toYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=90')).toBe(youTubeWatchUrl('dQw4w9WgXcQ', 90))
    expect(toYouTubeUrl('youtube.com/shorts/dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })

  it('opens other YouTube pages as they are', () => {
    expect(toYouTubeUrl('https://www.youtube.com/@lofigirl')).toBe('https://www.youtube.com/@lofigirl')
    expect(toYouTubeUrl('youtube.com')).toBe('https://youtube.com')
  })

  it('searches YouTube for anything else', () => {
    expect(toYouTubeUrl('lofi beats to study')).toBe('https://www.youtube.com/results?search_query=lofi%20beats%20to%20study')
    expect(toYouTubeUrl('https://example.com')).toMatch(/^https:\/\/www\.youtube\.com\/results\?/)
    expect(toYouTubeUrl('  ')).toBe('')
  })
})

describe('isYouTubeUrl', () => {
  it('only accepts YouTube', () => {
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=x')).toBe(true)
    expect(isYouTubeUrl('https://notyoutube.com/')).toBe(false)
    expect(isYouTubeUrl('file:///youtube.com')).toBe(false)
  })
})
