import { describe, expect, it } from 'vitest'
import {
  clampToDisplays,
  deviceName,
  edgeHit,
  entryPoint,
  macKey,
  movePointer,
  oppositeSide,
  outerEdge,
  pairingCode,
  safeRelativePath,
  swapCtrlCmd,
  windowsKey
} from './mouseShare'

// A PC with two screens side by side (the right one smaller and lower), and a MacBook.
const pc = [
  { x: 0, y: 0, width: 1920, height: 1080 },
  { x: 1920, y: 200, width: 1280, height: 720 }
]
const mac = [{ x: 0, y: 0, width: 1512, height: 982 }]

describe('the shared edge', () => {
  it('is the far side of the far screen', () => {
    const e = outerEdge(pc, 'right')
    expect(e.line).toBe(3200)
    expect(e.touching).toHaveLength(1)
    expect([e.from, e.to]).toEqual([200, 920])
    expect(outerEdge(pc, 'left').line).toBe(0)
    expect(outerEdge(pc, 'below').line).toBe(1080)
  })

  it('notices the pointer pressed against it, and how far along', () => {
    expect(edgeHit({ x: 3199, y: 560 }, pc, 'right')).toBeCloseTo(0.5)
    expect(edgeHit({ x: 3199, y: 200 }, pc, 'right')).toBe(0)
    // Not quite at the edge, or on the edge of the screen that isn't the outer one.
    expect(edgeHit({ x: 3190, y: 560 }, pc, 'right')).toBeNull()
    expect(edgeHit({ x: 1919, y: 100 }, pc, 'right')).toBeNull()
    expect(edgeHit({ x: 0, y: 540 }, pc, 'left')).toBeCloseTo(0.5)
    expect(edgeHit({ x: 700, y: 0 }, mac, 'above')).toBeCloseTo(700 / 1512)
  })

  it('brings the pointer in at the same place along the other computer’s edge', () => {
    const p = entryPoint(mac, 'left', 0.5)
    expect(p.x).toBe(3)
    expect(p.y).toBeCloseTo(490.5, 0)
    const q = entryPoint(pc, 'right', 0)
    expect(q).toEqual({ x: 3196, y: 200 })
    // Coming in from it isn't "at the edge", so it doesn't bounce straight back.
    expect(edgeHit(q, pc, 'right')).toBeNull()
  })

  it('goes home when pushed back over the edge', () => {
    const start = { x: 10, y: 300 }
    expect(movePointer(start, -5, 0, mac, 'left')).toEqual({ point: { x: 5, y: 300 }, back: null })
    const r = movePointer(start, -20, 0, mac, 'left')
    expect(r.back).toBeCloseTo(300 / 982)
    // Other edges just stop the pointer.
    expect(movePointer({ x: 1500, y: 300 }, 50, 0, mac, 'left')).toEqual({ point: { x: 1511, y: 300 }, back: null })
    expect(movePointer({ x: 700, y: 970 }, 0, 40, mac, 'above')).toEqual({ point: { x: 700, y: 981 }, back: null })
  })

  it('keeps the pointer on a screen', () => {
    expect(clampToDisplays({ x: 2500, y: 50 }, pc)).toEqual({ x: 2500, y: 200 })
    expect(clampToDisplays({ x: 100, y: 100 }, pc)).toEqual({ x: 100, y: 100 })
  })

  it('pairs sides', () => {
    expect(oppositeSide('left')).toBe('right')
    expect(oppositeSide('above')).toBe('below')
  })
})

describe('keys', () => {
  it('knows each key on both systems', () => {
    expect(windowsKey('KeyA')).toEqual({ vk: 0x41, extended: false })
    expect(windowsKey('ArrowLeft')).toEqual({ vk: 0x25, extended: true })
    expect(windowsKey('F12')).toEqual({ vk: 0x7b, extended: false })
    expect(windowsKey('Numpad5')?.vk).toBe(0x65)
    expect(macKey('KeyA')).toBe(0)
    expect(macKey('KeyC')).toBe(8)
    expect(macKey('MetaLeft')).toBe(55)
    expect(macKey('Enter')).toBe(36)
    expect(windowsKey('Nope')).toBeNull()
    expect(macKey('Nope')).toBeNull()
  })

  it('swaps Ctrl and ⌘', () => {
    expect(swapCtrlCmd('ControlLeft')).toBe('MetaLeft')
    expect(swapCtrlCmd('MetaRight')).toBe('ControlRight')
    expect(swapCtrlCmd('KeyC')).toBe('KeyC')
  })
})

describe('odds and ends', () => {
  it('makes a 6-digit pairing code', () => {
    expect(pairingCode(new Uint8Array([0, 0, 0, 7]))).toBe('000007')
    expect(pairingCode(new Uint8Array([255, 255, 255, 255]))).toMatch(/^\d{6}$/)
  })

  it('tidies computer names', () => {
    expect(deviceName('Harrys-MacBook-Air.local')).toBe('Harrys MacBook Air')
    expect(deviceName('DESKTOP-ABC123')).toBe('DESKTOP ABC123')
    expect(deviceName('')).toBe('Computer')
  })

  it('keeps received files inside the folder they go to', () => {
    expect(safeRelativePath('photo.png')).toBe('photo.png')
    expect(safeRelativePath('Holiday/day 1/a.jpg')).toBe('Holiday/day 1/a.jpg')
    expect(safeRelativePath('../../etc/passwd')).toBe('etc/passwd')
    expect(safeRelativePath('C:\\Windows\\x.dll')).toBe('C_/Windows/x.dll')
    expect(safeRelativePath('..')).toBeNull()
  })
})
