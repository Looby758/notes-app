import { describe, expect, it } from 'vitest'
import { pickDisplay, pickInstaller, pictureFraction, pointOnDisplay } from './screenLink'

describe('pointOnDisplay', () => {
  it('maps the picture onto the screen, including one to the right of the main one', () => {
    const d = { x: 1920, y: 0, width: 1920, height: 1080 }
    expect(pointOnDisplay(d, 0, 0)).toEqual({ x: 1920, y: 0 })
    expect(pointOnDisplay(d, 1, 1)).toEqual({ x: 3839, y: 1079 })
    expect(pointOnDisplay(d, 0.5, 0.5)).toEqual({ x: 2880, y: 540 })
  })
  it('keeps odd values on the screen', () => {
    const d = { x: 0, y: 0, width: 100, height: 100 }
    expect(pointOnDisplay(d, -3, 7)).toEqual({ x: 0, y: 99 })
    expect(pointOnDisplay(d, Number.NaN, 0.5)).toEqual({ x: 0, y: 50 })
  })
})

describe('pictureFraction', () => {
  // A 16:9 picture in a square box: bars above and below.
  const box = { width: 1600, height: 1600 }
  const picture = { width: 1920, height: 1080 }
  it('works out where on the picture the pointer is', () => {
    expect(pictureFraction(box, picture, { x: 800, y: 800 })).toEqual({ x: 0.5, y: 0.5 })
    expect(pictureFraction(box, picture, { x: 0, y: 350 })).toEqual({ x: 0, y: 0 })
  })
  it('is null over the bars', () => {
    expect(pictureFraction(box, picture, { x: 800, y: 100 })).toBeNull()
    expect(pictureFraction(box, picture, { x: 800, y: 1500 })).toBeNull()
  })
  it('is null before the picture has a size', () => {
    expect(pictureFraction(box, { width: 0, height: 0 }, { x: 1, y: 1 })).toBeNull()
  })
})

describe('pickDisplay', () => {
  const displays = [
    { id: '1', primary: true },
    { id: '2', primary: false }
  ]
  it('uses the one picked', () => expect(pickDisplay(displays, '1')?.id).toBe('1'))
  it('otherwise prefers an extra screen to the main one', () => expect(pickDisplay(displays, '')?.id).toBe('2'))
  it('falls back when the picked one has gone', () => expect(pickDisplay(displays, '9')?.id).toBe('2'))
  it('uses the only screen there is', () => expect(pickDisplay([{ id: '1', primary: true }], '')?.id).toBe('1'))
})

describe('pickInstaller', () => {
  const assets = [
    { name: 'Source code.zip', url: 'a' },
    { name: 'VDD.Control.ARM64.exe', url: 'b' },
    { name: 'Virtual.Display.Driver-x64-Setup.exe', url: 'c' },
    { name: 'tool-x64.exe', url: 'd' }
  ]
  it('picks the setup for an ordinary PC', () => expect(pickInstaller(assets, 'x64')?.url).toBe('c'))
  it('picks the ARM one on an ARM PC', () => expect(pickInstaller(assets, 'arm64')?.url).toBe('b'))
  it('finds nothing without a Windows installer', () => expect(pickInstaller([{ name: 'a.zip', url: 'x' }], 'x64')).toBeUndefined())
})
