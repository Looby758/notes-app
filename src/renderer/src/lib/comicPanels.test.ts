import { describe, expect, it } from 'vitest'
import { findPanels, joinBubbleLines, sentenceCase, zoomTo } from './comicPanels'

/** A white page with framed panels drawn on it (black borders, a little ink inside). */
function page(w: number, h: number, boxes: [number, number, number, number][], filled = false): Uint8Array {
  const g = new Uint8Array(w * h).fill(250)
  for (const [x0, y0, x1, y1] of boxes) {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const edge = x < x0 + 2 || x >= x1 - 2 || y < y0 + 2 || y >= y1 - 2
        // A white gap across the middle of each panel, like a sky: it mustn't split the panel.
        const inside = filled && !edge && (y - y0) % 7 === 0 && Math.abs(y - (y0 + y1) / 2) > 6
        if (edge || inside) g[y * w + x] = 10
      }
  }
  return g
}

describe('panel finding', () => {
  it('finds a classic grid in reading order', () => {
    // Two rows: one wide panel, then two side by side.
    const g = page(200, 300, [
      [10, 10, 190, 140],
      [10, 150, 95, 290],
      [105, 150, 190, 290]
    ], true)
    const panels = findPanels(g, 200, 300)
    expect(panels).toHaveLength(3)
    expect(panels[0].y).toBeLessThan(panels[1].y)
    expect(panels[1].x).toBeLessThan(panels[2].x)
    expect(panels[0].w).toBeCloseTo(0.9, 1)
  })

  it('reads right to left for manga', () => {
    const g = page(200, 300, [
      [10, 10, 95, 290],
      [105, 10, 190, 290]
    ])
    const panels = findPanels(g, 200, 300, true)
    expect(panels).toHaveLength(2)
    expect(panels[0].x).toBeGreaterThan(panels[1].x)
  })

  it('gives up on a splash page', () => {
    expect(findPanels(page(200, 300, [[10, 10, 190, 290]], true), 200, 300)).toEqual([])
    expect(findPanels(new Uint8Array(200 * 300).fill(250), 200, 300)).toEqual([])
  })

  it('works on black paper too', () => {
    const g = page(200, 300, [
      [10, 10, 190, 140],
      [10, 150, 190, 290]
    ]).map((v) => 255 - v)
    expect(findPanels(g, 200, 300)).toHaveLength(2)
  })
})

describe('panel zoom and scanned text', () => {
  it('centres a panel and scales it to fill the screen', () => {
    // A page shown 400 × 600 at (100, 0) in an 600 × 600 stage; zoom to its top half.
    const z = zoomTo({ x: 0, y: 0, w: 1, h: 0.5 }, 400, 600, 100, 0, 600, 600)
    expect(z.k).toBeCloseTo(1.5 * 0.94)
    // The panel's middle (200, 150 on the page) lands in the middle of the stage.
    expect(100 + z.tx + z.k * 200).toBeCloseTo(300)
    expect(0 + z.ty + z.k * 150).toBeCloseTo(300)
  })

  it('tidies comic lettering', () => {
    expect(sentenceCase('I DON’T KNOW. WHERE IS RICK? HE SAID I SHOULD WAIT')).toBe('I don’t know. Where is rick? He said I should wait')
    expect(joinBubbleLines('WE HAVE TO\nGET OUT OF HERE BE-\nFORE DARK.\n\nNOW!')).toBe('WE HAVE TO GET OUT OF HERE BEFORE DARK.\n\nNOW!')
  })
})
