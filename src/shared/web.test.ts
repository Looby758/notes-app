import { describe, expect, it } from 'vitest'
import { displayUrl, isWebUrl, plainUserAgent, toWebUrl } from './web'

describe('toWebUrl', () => {
  it('opens addresses', () => {
    expect(toWebUrl('bbc.co.uk')).toBe('https://bbc.co.uk')
    expect(toWebUrl('  en.wikipedia.org/wiki/Notes ')).toBe('https://en.wikipedia.org/wiki/Notes')
    expect(toWebUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(toWebUrl('http://example.com')).toBe('http://example.com')
    expect(toWebUrl('localhost:3000')).toBe('http://localhost:3000')
  })

  it('searches for anything else', () => {
    expect(toWebUrl('how to make pancakes')).toBe('https://www.google.com/search?q=how%20to%20make%20pancakes')
    expect(toWebUrl('pancakes')).toBe('https://www.google.com/search?q=pancakes')
    expect(toWebUrl('file:///etc/passwd')).toMatch(/^https:\/\/www\.google\.com\/search/)
    expect(toWebUrl('   ')).toBe('')
  })
})

describe('isWebUrl', () => {
  it('only allows web pages', () => {
    expect(isWebUrl('https://example.com')).toBe(true)
    expect(isWebUrl('http://example.com')).toBe(true)
    expect(isWebUrl('file:///C:/notes')).toBe(false)
    expect(isWebUrl('vault://x/a.png')).toBe(false)
    expect(isWebUrl('javascript:alert(1)')).toBe(false)
    expect(isWebUrl('not a url')).toBe(false)
  })
})

describe('displayUrl', () => {
  it('hides https:// and a bare trailing slash', () => {
    expect(displayUrl('https://example.com/')).toBe('example.com')
    expect(displayUrl('https://example.com/a/')).toBe('example.com/a/')
    expect(displayUrl('http://example.com/')).toBe('http://example.com/')
  })
})

describe('plainUserAgent', () => {
  it('leaves out the app and Electron', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) notesapp/1.5.0 Chrome/138.0.0.0 Electron/37.2.0 Safari/537.36'
    expect(plainUserAgent(ua)).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36')
  })
})
