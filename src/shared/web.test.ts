import { afterEach, describe, expect, it, vi } from 'vitest'
import { displayUrl, firefoxOnGoogleSignIn, firefoxUserAgent, isGoogleSignIn, isWebUrl, plainUserAgent, toWebUrl } from './web'

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
  it('leaves out the app whatever it is called, and sends Chrome’s short version', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Orbit/1.8.0 Chrome/136.0.7103.149 Electron/36.3.0 Safari/537.36'
    expect(plainUserAgent(ua)).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36')
  })
})

describe('Google sign-in', () => {
  it('spots Google sign-in pages', () => {
    expect(isGoogleSignIn('https://accounts.google.com/v3/signin/identifier?continue=x')).toBe(true)
    expect(isGoogleSignIn('https://www.google.com/search?q=accounts.google.com')).toBe(false)
    expect(isGoogleSignIn('https://accounts.google.com.evil.example/')).toBe(false)
    expect(isGoogleSignIn('not a url')).toBe(false)
  })

  it('spots the other pages a Google sign-in passes through', () => {
    expect(isGoogleSignIn('https://accounts.youtube.com/accounts/SetSID?ssdc=1')).toBe(true)
    expect(isGoogleSignIn('https://www.google.com/accounts/SetSID')).toBe(true)
    expect(isGoogleSignIn('https://accounts.google.co.uk/accounts/SetSID')).toBe(true)
    expect(isGoogleSignIn('https://accounts.google.de/')).toBe(true)
    expect(isGoogleSignIn('https://www.google.com/maps')).toBe(false)
    expect(isGoogleSignIn('https://www.youtube.com/watch?v=x')).toBe(false)
    expect(isGoogleSignIn('http://accounts.google.com/')).toBe(false)
    expect(isGoogleSignIn('https://accounts.google.evil.example/')).toBe(false)
  })

  it('names Firefox for each system', () => {
    expect(firefoxUserAgent('win32')).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0')
    expect(firefoxUserAgent('darwin')).toContain('Macintosh')
    expect(firefoxUserAgent('linux')).toContain('Linux')
  })
})

describe('firefoxOnGoogleSignIn', () => {
  const agent = firefoxUserAgent('win32')
  class FakeNavigator {
    get userAgent(): string {
      return 'Chrome'
    }
    get userAgentData(): unknown {
      return { brands: [] }
    }
  }
  const run = (href: string): FakeNavigator => {
    const { protocol, hostname, pathname } = new URL(href)
    vi.stubGlobal('location', { protocol, hostname, pathname })
    vi.stubGlobal('Navigator', class extends FakeNavigator {})
    const Nav = (globalThis as unknown as { Navigator: new () => FakeNavigator }).Navigator
    firefoxOnGoogleSignIn(agent)
    return new Nav()
  }
  afterEach(() => vi.unstubAllGlobals())

  it('shows Google sign-in pages the same Firefox the request said', () => {
    const nav = run('https://accounts.google.com/v3/signin/accountchooser')
    expect(nav.userAgent).toBe(agent)
    expect(nav.userAgentData).toBeUndefined()
    expect(run('https://accounts.youtube.com/accounts/SetSID').userAgent).toBe(agent)
  })

  it('leaves every other page alone', () => {
    expect(run('https://grok.com/').userAgent).toBe('Chrome')
    expect(run('https://www.google.com/search?q=x').userAgent).toBe('Chrome')
  })
})
