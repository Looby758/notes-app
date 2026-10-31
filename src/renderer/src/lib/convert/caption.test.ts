import { describe, expect, it } from 'vitest'
import { captionFont, DEFAULT_CAPTION, wrapLines } from './caption'

const measure = (s: string): number => s.length * 10

describe('GIF captions', () => {
  it('wraps words to fit the bar', () => {
    expect(wrapLines('when the code works first time', 120, measure)).toEqual(['when the', 'code works', 'first time'])
  })

  it('keeps the lines you typed, and long words whole', () => {
    expect(wrapLines('top\nbottom', 500, measure)).toEqual(['top', 'bottom'])
    expect(wrapLines('supercalifragilistic', 50, measure)).toEqual(['supercalifragilistic'])
  })

  it('falls back when a font isn’t installed', () => {
    expect(captionFont(DEFAULT_CAPTION, 30)).toMatch(/^800 30px "Futura", .*Arial, sans-serif$/)
    expect(captionFont({ ...DEFAULT_CAPTION, font: 'Comic Sans MS', bold: false }, 20)).toBe('400 20px "Comic Sans MS", Arial, sans-serif')
  })
})
