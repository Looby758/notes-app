import { describe, expect, it } from 'vitest'
import { cleanScenes, dragRect, fitRect, formatDuration, itemAt, keepOnScreen, newItem, pickRecordingType, recordingFileName, snap } from './studio'

describe('studio', () => {
  it('fits a picture inside or over a box', () => {
    const box = { x: 0, y: 0, w: 100, h: 100 }
    expect(fitRect(200, 100, box, 'contain')).toEqual({ x: 0, y: 25, w: 100, h: 50 })
    expect(fitRect(200, 100, box, 'cover')).toEqual({ x: -50, y: 0, w: 200, h: 100 })
  })

  it('finds the topmost visible source under a point', () => {
    const back = newItem('screen')
    const cam = newItem('camera')
    expect(itemAt([back, cam], 0.8, 0.8)?.id).toBe(cam.id)
    expect(itemAt([back, cam], 0.1, 0.1)?.id).toBe(back.id)
    expect(itemAt([back, { ...cam, visible: false }], 0.8, 0.8)?.id).toBe(back.id)
    expect(itemAt([], 0.5, 0.5)).toBeNull()
  })

  it('moves and resizes, keeping the shape when asked', () => {
    const start = { x: 0.5, y: 0.5, w: 0.2, h: 0.1 }
    expect(dragRect(start, 'move', 0.1, 0.1, true)).toEqual({ x: 0.6, y: 0.6, w: 0.2, h: 0.1 })
    const bigger = dragRect(start, 'se', 0.2, 0, true)
    expect(bigger.w).toBeCloseTo(0.4)
    expect(bigger.h).toBeCloseTo(0.2)
    const fromTopLeft = dragRect(start, 'nw', -0.1, -0.1, false)
    expect(fromTopLeft.x).toBeCloseTo(0.4)
    expect(fromTopLeft.y).toBeCloseTo(0.4)
    expect(fromTopLeft.w).toBeCloseTo(0.3)
    expect(fromTopLeft.h).toBeCloseTo(0.2)
    expect(dragRect(start, 'se', -1, -1, false).w).toBeGreaterThan(0)
  })

  it('keeps sources grabbable and snaps to edges', () => {
    const kept = keepOnScreen({ x: 5, y: -5, w: 0.2, h: 0.2 })
    expect(kept.x).toBeCloseTo(0.98)
    expect(kept.y).toBeCloseTo(-0.18)
    expect(snap({ x: 0.005, y: 0.395, w: 0.2, h: 0.2 })).toEqual({ x: 0, y: 0.4, w: 0.2, h: 0.2 })
    expect(snap({ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }).x).toBe(0.3)
  })

  it('records MP4 when it can, WebM otherwise', () => {
    expect(pickRecordingType(() => true)?.ext).toBe('mp4')
    expect(pickRecordingType((m) => m.startsWith('video/webm'))?.ext).toBe('webm')
    expect(pickRecordingType(() => false)).toBeNull()
  })

  it('names recordings and formats times', () => {
    expect(recordingFileName(new Date(2026, 9, 31, 14, 5, 9), 'mp4')).toBe('Recording 2026-10-31 14-05-09.mp4')
    expect(formatDuration(7_400)).toBe('0:07')
    expect(formatDuration(765_000)).toBe('12:45')
    expect(formatDuration(3_723_000)).toBe('1:02:03')
  })

  it('cleans saved scenes', () => {
    expect(cleanScenes('nope')).toBeNull()
    expect(cleanScenes([])).toBeNull()
    const scenes = cleanScenes([{ name: 'A', items: [{ kind: 'camera', x: 'bad' }, { kind: 'virus' }] }, null])
    expect(scenes).toHaveLength(1)
    expect(scenes![0].items).toHaveLength(1)
    expect(scenes![0].items[0].kind).toBe('camera')
    expect(typeof scenes![0].items[0].x).toBe('number')
  })
})
