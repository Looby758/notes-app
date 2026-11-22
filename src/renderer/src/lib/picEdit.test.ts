import { describe, expect, it } from 'vitest'
import {
  addPoint,
  arrowHead,
  clampRect,
  clampWidth,
  editedName,
  folderOf,
  isChanged,
  MAX_SIDE,
  markSizes,
  newEdit,
  nextStep,
  outputSize,
  pathSpan,
  rectFrom,
  saveType,
  shaftEnd,
  shapeBox,
  widthForHeight,
  type Mark
} from './picEdit'

describe('picture editor', () => {
  it('makes a box from corners dragged any way', () => {
    expect(rectFrom(50, 40, 10, 10)).toEqual({ x: 10, y: 10, w: 40, h: 30 })
  })

  it('keeps a box inside the picture', () => {
    expect(clampRect({ x: -10, y: 20, w: 200, h: 500 }, 100, 100)).toEqual({ x: 0, y: 20, w: 100, h: 80 })
    expect(clampRect({ x: 150, y: 150, w: 10, h: 10 }, 100, 100)).toEqual({ x: 100, y: 100, w: 0, h: 0 })
  })

  it('saves at the cropped size, or a new width keeping the shape', () => {
    const edit = { ...newEdit(1000, 500), crop: { x: 0, y: 0, w: 400, h: 300 } }
    expect(outputSize(edit)).toEqual({ width: 400, height: 300 })
    expect(outputSize({ ...edit, outWidth: 200 })).toEqual({ width: 200, height: 150 })
    expect(widthForHeight(edit, 150)).toBe(200)
  })

  it('keeps a new width within limits', () => {
    const edit = newEdit(1000, 500)
    expect(clampWidth(edit, 1000)).toBeNull()
    expect(clampWidth(edit, 0)).toBe(1)
    expect(clampWidth(edit, 99999)).toBe(MAX_SIDE)
    // A tall picture is limited by its height.
    expect(clampWidth(newEdit(100, 1000), 5000)).toBe(800)
  })

  it('points the arrow head at the end of the line', () => {
    const [tip, a, b] = arrowHead(0, 0, 100, 0, 5)
    expect(tip).toEqual([100, 0])
    expect(a[0]).toBeLessThan(100)
    expect(b[0]).toBeLessThan(100)
    expect(a[1]).toBeCloseTo(-b[1])
    const [ex, ey] = shaftEnd(0, 0, 100, 0, 5)
    expect(ex).toBeLessThan(100)
    expect(ex).toBeGreaterThan(80)
    expect(ey).toBe(0)
  })

  it('saves over photos and screenshots, and copies other pictures as .png', () => {
    expect(saveType('a/Photo.JPG')).toBe('image/jpeg')
    expect(saveType('shot.png')).toBe('image/png')
    expect(saveType('anim.gif')).toBeNull()
    expect(editedName('Pictures/Holiday.jpg')).toBe('Holiday (edited).jpg')
    expect(editedName('logo.svg')).toBe('logo (edited).png')
    expect(folderOf('Pictures/Holiday.jpg')).toBe('Pictures')
    expect(folderOf('Holiday.jpg')).toBe('')
  })

  it('knows when nothing has changed', () => {
    const edit = newEdit(10, 10)
    expect(isChanged(edit)).toBe(false)
    expect(isChanged({ ...edit, marks: [{ kind: 'blur', x: 0, y: 0, w: 5, h: 5 }] })).toBe(true)
  })

  it('numbers steps one past the biggest, so undo takes the number back', () => {
    const step = (n: number): Mark => ({ kind: 'step', x: 0, y: 0, n, color: '#fff', size: 10 })
    expect(nextStep([])).toBe(1)
    expect(nextStep([step(1), { kind: 'blur', x: 0, y: 0, w: 5, h: 5 }, step(2)])).toBe(3)
    expect(nextStep([step(3), step(1)])).toBe(4)
  })

  it('makes a square (round circle) with Shift, growing the way you dragged', () => {
    expect(shapeBox(10, 10, 50, 30)).toEqual({ x: 10, y: 10, w: 40, h: 20 })
    expect(shapeBox(10, 10, 50, 30, true)).toEqual({ x: 10, y: 10, w: 40, h: 40 })
    expect(shapeBox(100, 100, 80, 40, true)).toEqual({ x: 40, y: 40, w: 60, h: 60 })
  })

  it('skips pen points that are too close together', () => {
    const one = addPoint([], [0, 0], 2)
    expect(one).toEqual([[0, 0]])
    expect(addPoint(one, [1, 1], 2)).toBe(one)
    expect(addPoint(one, [3, 0], 2)).toEqual([[0, 0], [3, 0]])
  })

  it('measures how far a drawn line reaches', () => {
    expect(pathSpan([])).toBe(0)
    expect(pathSpan([[5, 5]])).toBe(0)
    expect(pathSpan([[0, 0], [3, 1], [3, 4]])).toBe(5)
  })

  it('scales highlighter and step sizes with the picture', () => {
    const small = markSizes({ width: 800, height: 600 })
    const big = markSizes({ width: 4000, height: 3000 })
    expect(small.step[1]).toBeLessThan(big.step[1])
    expect(small.highlight[0]).toBeLessThan(small.highlight[2])
  })
})
