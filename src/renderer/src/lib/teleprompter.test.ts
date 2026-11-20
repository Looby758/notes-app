import { describe, expect, it } from 'vitest'
import { crossed, cuesFile, cuesPath, holdFor, plainInline, prompterBlocks, prompterWords, scrollSpeed, sectionJump, type PlacedMarker } from './teleprompter'

const script = `---
type: script
---
# Intro

Rick wakes up **alone** [IMAGE: rick-s1-hospital.png] in the hospital. [NOTE: check the date]
[PAUSE: 2s] Nobody comes.

[SECTION: The prison]
- He finds [[Hershel Greene|Hershel]] and [EMPHASIS: never] looks back.

<!-- not read -->
`

describe('teleprompter script', () => {
  it('turns a script into headings, sections and lines with markers in them', () => {
    const blocks = prompterBlocks(script)
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'para', 'section', 'para'])
    const first = blocks[1]
    if (first.kind !== 'para') throw new Error()
    expect(first.parts.map((p) => (p.kind === 'text' ? p.text : p.text))).toEqual(['Rick wakes up alone ', '[IMAGE: rick-s1-hospital.png]', ' in the hospital. ', '[PAUSE: 2s]', ' Nobody comes.'])
    const section = blocks[2]
    expect(section.kind === 'section' && section.title).toBe('The prison')
    const last = blocks[3]
    if (last.kind !== 'para') throw new Error()
    expect(last.parts.map((p) => (p.kind === 'text' ? p.text : p.type))).toEqual(['He finds Hershel and ', 'EMPHASIS', ' looks back.'])
  })

  it('keeps each marker’s place in the note, so cue times line up with the script', () => {
    const blocks = prompterBlocks(script)
    for (const b of blocks) {
      if (b.kind === 'section') expect(script.slice(b.from, b.from + b.text.length)).toBe(b.text)
      if (b.kind === 'para') for (const p of b.parts) if (p.kind === 'marker') expect(script.slice(p.from, p.from + p.text.length)).toBe(p.text)
    }
  })

  it('leaves notes to self out', () => {
    expect(JSON.stringify(prompterBlocks(script))).not.toContain('check the date')
  })

  it('takes markdown out of the words', () => {
    expect(plainInline('A **bold** _move_ with `code`, a [link](http://x) and ==this==')).toBe('A bold move with code, a link and this')
    expect(plainInline('snake_case_name stays')).toBe('snake_case_name stays')
  })

  it('counts the words read out, emphasis included', () => {
    // Rick wakes up alone in the hospital. Nobody comes. / He finds Hershel and never looks back.
    expect(prompterWords(prompterBlocks(script))).toBe(16)
  })
})

describe('teleprompter scrolling', () => {
  it('scrolls so the reading line moves at your pace', () => {
    // 150 words in 3000px at 150 a minute: 20px a word, 2.5 words a second.
    expect(scrollSpeed(3000, 150, 150)).toBeCloseTo(50)
    expect(scrollSpeed(3000, 150, 150, 1.5)).toBeCloseTo(75)
    expect(scrollSpeed(0, 150, 150)).toBe(0)
    expect(scrollSpeed(3000, 0, 150)).toBe(0)
  })

  const m = (y: number, type: PlacedMarker['type'] = 'IMAGE', value = ''): PlacedMarker => ({ from: y, text: `[${type}]`, type, value, y })

  it('finds the markers that reached the line since the last frame', () => {
    const list = [m(10), m(50), m(90)]
    expect(crossed(list, 0, 50).map((x) => x.y)).toEqual([10, 50])
    expect(crossed(list, 50, 60)).toEqual([])
    // Scrolling back up isn't reaching anything.
    expect(crossed(list, 90, 0)).toEqual([])
  })

  it('holds still for a pause marker', () => {
    expect(holdFor(m(0, 'PAUSE', '2s'))).toBe(2)
    expect(holdFor(m(0, 'PAUSE'))).toBe(1)
    expect(holdFor(m(0, 'IMAGE'))).toBe(0)
  })

  it('jumps between sections', () => {
    const tops = [0, 500, 1200]
    expect(sectionJump(tops, 100, 1)).toBe(500)
    expect(sectionJump(tops, 1300, 1)).toBeNull()
    // Well into a section: back to its start; right at its start: the one before.
    expect(sectionJump(tops, 700, -1)).toBe(500)
    expect(sectionJump(tops, 510, -1)).toBe(0)
    expect(sectionJump(tops, 0, -1)).toBe(0)
  })
})

describe('cue times for the shot list', () => {
  it('saves each marker once, in order, beside the recording', () => {
    expect(cuesPath('C:\\Rec\\Voiceover 1.m4a')).toBe('C:\\Rec\\Voiceover 1.m4a.cues.json')
    const f = cuesFile('Videos/Maggie/Script.md', [
      { at: 120, marker: '[PAUSE]', t: 9.876 },
      { at: 40, marker: '[IMAGE: rick.png]', t: 3.2 },
      { at: 40, marker: '[IMAGE: rick.png]', t: 30 }
    ])
    expect(f).toEqual({
      version: 1,
      script: 'Videos/Maggie/Script.md',
      cues: [
        { at: 40, marker: '[IMAGE: rick.png]', t: 3.2 },
        { at: 120, marker: '[PAUSE]', t: 9.88 }
      ]
    })
  })
})
