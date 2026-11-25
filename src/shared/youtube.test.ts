import { describe, expect, it } from 'vitest'
import { isYouTubeUrl, youTubeVideoId } from './youtube'

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

describe('isYouTubeUrl', () => {
  it('only accepts YouTube', () => {
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=x')).toBe(true)
    expect(isYouTubeUrl('https://notyoutube.com/')).toBe(false)
    expect(isYouTubeUrl('file:///youtube.com')).toBe(false)
  })
})
