import { describe, expect, it } from 'vitest'
import { isAdRequest } from './adblock'

describe('isAdRequest', () => {
  it('refuses ad servers and YouTube ad addresses', () => {
    expect(isAdRequest('https://googleads.g.doubleclick.net/pagead/id')).toBe(true)
    expect(isAdRequest('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js')).toBe(true)
    expect(isAdRequest('https://www.googleadservices.com/pagead/conversion/')).toBe(true)
    expect(isAdRequest('https://www.youtube.com/pagead/adview?ai=x')).toBe(true)
    expect(isAdRequest('https://www.youtube.com/api/stats/ads?ver=2')).toBe(true)
    expect(isAdRequest('https://www.youtube.com/get_midroll_info?ei=x')).toBe(true)
  })

  it('lets YouTube itself and other sites load', () => {
    expect(isAdRequest('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false)
    expect(isAdRequest('https://www.youtube.com/youtubei/v1/player')).toBe(false)
    expect(isAdRequest('https://rr3---sn-abc.googlevideo.com/videoplayback?id=1')).toBe(false)
    expect(isAdRequest('https://accounts.google.com/signin')).toBe(false)
    expect(isAdRequest('https://example.com/pagead/thing')).toBe(false)
    expect(isAdRequest('not a url')).toBe(false)
  })
})
