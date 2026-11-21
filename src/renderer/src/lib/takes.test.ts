import { describe, expect, it } from 'vitest'
import { chosenTake, joinPlan, listTitles, sectionsOf, takeNumber, type Take } from './takes'

const script = `Hello and welcome. [IMAGE: rick.png]

[SECTION: The prison]
Rick is in prison. [PAUSE: 1s] Again.

[SECTION: The escape]
He gets out.`

const take = (over: Partial<Take>): Take => ({ key: 'k', path: 'p', n: 1, at: 1, start: 2.6, length: 10, cues: [], early: false, scrapped: false, ...over })

describe('record by section', () => {
  it('splits the script into its sections, the bit before the first one too', () => {
    const s = sectionsOf(script, 150)
    expect(s.map((x) => x.title)).toEqual(['Opening', 'The prison', 'The escape'])
    expect(s.map((x) => x.key)).toEqual(['(opening)#1', 'the prison#1', 'the escape#1'])
    expect(s[1].from).toBe(script.indexOf('[SECTION: The prison]'))
    expect(s[1].to).toBe(script.indexOf('[SECTION: The escape]'))
    expect(s[2].to).toBe(script.length)
    expect(s[1].words).toBe(5)
  })

  it('is one section when there are no markers, and tells repeated titles apart', () => {
    expect(sectionsOf('Just words here.', 150).map((x) => x.title)).toEqual(['Whole script'])
    expect(sectionsOf('[SECTION: Bit]\na\n[SECTION: Bit]\nb', 150).map((x) => x.key)).toEqual(['bit#1', 'bit#2'])
  })

  it('reads the take number from the file name', () => {
    expect(takeNumber('C:\\x\\Script sections\\02 The prison - take 12.m4a')).toBe(12)
  })

  it('uses the take you picked, otherwise the newest one you didn’t throw away', () => {
    const takes = [take({ path: 'a', at: 1 }), take({ path: 'b', at: 2 }), take({ path: 'c', at: 3, scrapped: true })]
    expect(chosenTake('k', takes, {})?.path).toBe('b')
    expect(chosenTake('k', takes, { k: 'a' })?.path).toBe('a')
    expect(chosenTake('k', takes, { k: 'gone' })?.path).toBe('b')
    expect(chosenTake('other', takes, {})).toBeNull()
  })

  it('joins the chosen takes in script order and moves the cues to match', () => {
    const sections = sectionsOf(script, 150)
    const takes = [
      take({ key: 'the escape#1', path: 'esc', start: 2, length: 7, cues: [{ at: 99, marker: '[SECTION: The escape]', t: 2.4 }] }),
      take({ key: '(opening)#1', path: 'open', start: 2.5, length: 6.5, cues: [{ at: 20, marker: '[IMAGE: rick.png]', t: 4.5 }] })
    ]
    const plan = joinPlan(sections, takes, {})
    expect(plan.parts.map((p) => p.path)).toEqual(['open', 'esc'])
    expect(plan.parts[0].from).toBe(2.5)
    expect(plan.missing.map((s) => s.title)).toEqual(['The prison'])
    // The opening is 4 s long, so the escape's cue lands 0.4 s after that.
    expect(plan.cues).toEqual([
      { at: 20, marker: '[IMAGE: rick.png]', t: 2 },
      { at: 99, marker: '[SECTION: The escape]', t: 4.4 }
    ])
    expect(plan.length).toBe(9)
  })

  it('lists titles the short way', () => {
    const s = sectionsOf(script, 150)
    expect(listTitles(s.slice(0, 1))).toBe('“Opening”')
    expect(listTitles(s)).toBe('“Opening”, “The prison” and “The escape”')
    expect(listTitles([...s, ...s], 3)).toBe('“Opening”, “The prison” and 4 more')
  })
})
