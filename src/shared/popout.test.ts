import { describe, expect, it } from 'vitest'
import { FULL, composeCrop, cropFromDrag, cropStyle, fitWindow, isFull, nextOpacity, shownAspect, MIN_SIDE } from './popout'

describe('cropFromDrag', () => {
  it('works whichever way you drag', () => {
    expect(cropFromDrag({ x: 0.6, y: 0.8 }, { x: 0.2, y: 0.3 })).toEqual({ x: 0.2, y: 0.3, w: 0.39999999999999997, h: 0.5 })
  })
  it('keeps the box inside the picture', () => {
    expect(cropFromDrag({ x: -0.5, y: -1 }, { x: 2, y: 0.5 })).toEqual({ x: 0, y: 0, w: 1, h: 0.5 })
  })
  it('ignores a click or a tiny drag', () => {
    expect(cropFromDrag({ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.9 })).toBeNull()
  })
})

describe('composeCrop', () => {
  it('crops inside a crop', () => {
    expect(composeCrop({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 })).toEqual({ x: 0.75, y: 0.5, w: 0.25, h: 0.25 })
  })
  it('cropping the whole picture changes nothing', () => {
    expect(composeCrop(FULL, { x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 })
  })
})

describe('cropStyle', () => {
  it('shows the whole picture as it is', () => {
    expect(cropStyle(FULL)).toEqual({ left: '0%', top: '0%', width: '100%', height: '100%' })
  })
  it('blows up and shifts the picture so only the crop shows', () => {
    expect(cropStyle({ x: 0.5, y: 0.25, w: 0.5, h: 0.25 })).toEqual({ left: '-100%', top: '-100%', width: '200%', height: '400%' })
  })
})

describe('isFull / shownAspect', () => {
  it('knows the whole picture', () => {
    expect(isFull(FULL)).toBe(true)
    expect(isFull({ x: 0, y: 0, w: 1, h: 0.5 })).toBe(false)
  })
  it('uses the crop’s shape', () => {
    expect(shownAspect(1920, 1080, FULL)).toBeCloseTo(16 / 9)
    expect(shownAspect(1920, 1080, { x: 0, y: 0, w: 0.25, h: 1 })).toBeCloseTo(4 / 9)
    expect(shownAspect(0, 0, FULL)).toBeCloseTo(16 / 9)
  })
})

describe('fitWindow', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  it('keeps about the same size and middle, in the new shape', () => {
    const r = fitWindow({ x: 100, y: 100, width: 480, height: 270 }, 1, area)
    expect(Math.abs(r.width - r.height)).toBeLessThanOrEqual(1)
    expect(r.width * r.height).toBeGreaterThan(480 * 270 * 0.98)
    expect(r.x + r.width / 2).toBeCloseTo(340, -1)
  })
  it('never goes off the screen', () => {
    const r = fitWindow({ x: 1800, y: 1000, width: 480, height: 270 }, 16 / 9, area)
    expect(r.x + r.width).toBeLessThanOrEqual(1920)
    expect(r.y + r.height).toBeLessThanOrEqual(1040)
  })
  it('never gets bigger than most of the screen', () => {
    const r = fitWindow({ x: 0, y: 0, width: 1900, height: 1000 }, 4, area)
    expect(r.width).toBeLessThanOrEqual(1920 * 0.9 + 1)
  })
  it('keeps a thin strip big enough to use', () => {
    const r = fitWindow({ x: 0, y: 0, width: 300, height: 200 }, 8, area)
    expect(r.height).toBeGreaterThanOrEqual(MIN_SIDE)
  })
})

describe('nextOpacity', () => {
  it('steps through and wraps round', () => {
    expect(nextOpacity(1)).toBe(0.85)
    expect(nextOpacity(0.5)).toBe(1)
    expect(nextOpacity(0.33)).toBe(1)
  })
})
