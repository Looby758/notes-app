import { describe, expect, it } from 'vitest'
import { FRAME_HEADER_SIZE, HELPER_MSG, helperMessage, isJpeg, queueLayout } from './phoneCam'

describe('queueLayout', () => {
  it('matches OBS: a 96-byte header, then three 32-byte-aligned frames with their timestamps', () => {
    const l = queueLayout(1280, 720, 30)
    expect(l.frameSize).toBe(1280 * 720 * 1.5)
    expect(l.offsets[0]).toBe(96)
    expect(l.offsets[1]).toBe(96 + l.frameSize + FRAME_HEADER_SIZE)
    expect(l.offsets[2]).toBe(l.offsets[1] * 2 - 96)
    expect(l.size).toBe(l.offsets[2] + l.frameSize + FRAME_HEADER_SIZE)
    expect(l.offsets.every((o) => o % 32 === 0)).toBe(true)
    expect(l.interval).toBe(333333)
  })

  it('pads sizes that are not a multiple of 32', () => {
    const l = queueLayout(10, 10, 60)
    expect(l.frameSize).toBe(150)
    expect(l.offsets).toEqual([96, 288, 480])
    expect(l.size).toBe(672)
    expect(l.interval).toBe(166667)
  })
})

describe('helperMessage', () => {
  it('is a type byte, a little-endian length and the data', () => {
    const m = helperMessage(HELPER_MSG.frame, Uint8Array.of(9, 8, 7))
    expect([...m]).toEqual([1, 3, 0, 0, 0, 9, 8, 7])
  })
})

describe('isJpeg', () => {
  it('knows a JPEG by its first bytes', () => {
    expect(isJpeg(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))).toBe(true)
    expect(isJpeg(Uint8Array.of(0x89, 0x50, 0x4e, 0x47))).toBe(false)
    expect(isJpeg(new Uint8Array())).toBe(false)
  })
})
