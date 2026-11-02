import { describe, expect, it } from 'vitest'
import { clampFloat, defaultFloat, FLOAT_MIN, isGrokUrl } from './grok'

describe('isGrokUrl', () => {
  it('knows grok.com pages', () => {
    expect(isGrokUrl('https://grok.com/')).toBe(true)
    expect(isGrokUrl('https://grok.com/c/abc123')).toBe(true)
    expect(isGrokUrl('https://www.grok.com/')).toBe(true)
  })
  it('turns down other sites and insecure pages', () => {
    expect(isGrokUrl('http://grok.com/')).toBe(false)
    expect(isGrokUrl('https://accounts.x.ai/sign-in')).toBe(false)
    expect(isGrokUrl('https://notgrok.com/')).toBe(false)
    expect(isGrokUrl('https://grok.com.evil.example/')).toBe(false)
    expect(isGrokUrl('not a url')).toBe(false)
  })
})

describe('the floating panel', () => {
  const view = { width: 1400, height: 900 }

  it('starts in the bottom-right corner, inside the window', () => {
    const r = defaultFloat(view)
    expect(r.x + r.width).toBeLessThanOrEqual(view.width)
    expect(r.y + r.height).toBeLessThanOrEqual(view.height)
    expect(r.x).toBeGreaterThan(view.width / 2)
  })

  it('is never smaller than the minimum', () => {
    expect(clampFloat({ x: 10, y: 10, width: 50, height: 50 }, view)).toMatchObject(FLOAT_MIN)
  })

  it('keeps its top bar on screen after the window shrinks', () => {
    const r = clampFloat({ x: 1300, y: 850, width: 420, height: 600 }, { width: 800, height: 600 })
    expect(r.x).toBeLessThan(800)
    expect(r.y).toBeLessThan(600)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.x + r.width).toBeGreaterThan(0)
  })

  it('copes with a broken saved place', () => {
    const r = clampFloat({ x: NaN, y: undefined as unknown as number, width: Infinity, height: 400 }, view)
    expect(Object.values(r).every(Number.isFinite)).toBe(true)
  })
})
