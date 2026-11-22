import { describe, expect, it } from 'vitest'
import { countWords, findMarkers, formatLength, imageMarkerValue, isScriptNote, markerText, pauseSeconds, resolveImage, scriptStats, spokenText } from './script'

describe('script markers', () => {
  it('finds markers with and without values', () => {
    const text = 'Rick wakes up [IMAGE: rick-s1-hospital.png] alone. [PAUSE] Then [PAUSE: 2s] [SECTION: The prison]'
    expect(findMarkers(text).map((m) => [m.type, m.value])).toEqual([
      ['IMAGE', 'rick-s1-hospital.png'],
      ['PAUSE', ''],
      ['PAUSE', '2s'],
      ['SECTION', 'The prison']
    ])
  })

  it('gives positions in the note', () => {
    const [m] = findMarkers('ab [NOTE: x]', 10)
    expect(m.from).toBe(13)
    expect(m.to).toBe(22)
  })

  it('takes wiki links inside a source marker', () => {
    expect(findMarkers('[SOURCE: [[Research/Maggie]]] and on')[0]).toMatchObject({ type: 'SOURCE', value: '[[Research/Maggie]]' })
  })

  it('leaves alone lower case, unknown words and link text', () => {
    expect(findMarkers('[note: hi] [THING: x] [IMAGE: a](http://x) [Image]')).toEqual([])
  })

  it('writes markers', () => {
    expect(markerText('IMAGE', 'a.png')).toBe('[IMAGE: a.png]')
    expect(markerText('PAUSE')).toBe('[PAUSE]')
    expect(markerText('NOTE', 'a [b]\nc')).toBe('[NOTE: a b c]')
  })

  it('reads pause lengths', () => {
    expect(pauseSeconds('')).toBe(1)
    expect(pauseSeconds('2s')).toBe(2)
    expect(pauseSeconds('1.5 sec')).toBe(1.5)
    expect(pauseSeconds('500ms')).toBe(0.5)
    expect(pauseSeconds('3')).toBe(3)
    expect(pauseSeconds('a while')).toBe(1)
  })
})

describe('script notes', () => {
  it('knows a script by its name or its properties', () => {
    expect(isScriptNote('Videos/Maggie/Script.md')).toBe(true)
    expect(isScriptNote('Videos/Maggie/Script 2.md')).toBe(true)
    expect(isScriptNote('Videos/Maggie/Scripts I like.md')).toBe(false)
    expect(isScriptNote('Videos/Maggie/Research.md')).toBe(false)
    expect(isScriptNote('Maggie.md', '---\ntype: script\n---\nHello')).toBe(true)
    expect(isScriptNote('Maggie.md', 'type: script')).toBe(false)
    expect(isScriptNote(null)).toBe(false)
  })
})

describe('word count and length', () => {
  it('counts only what gets read out', () => {
    const text = [
      '---',
      'type: script',
      '---',
      '# Maggie Rhee',
      'She was [EMPHASIS: never] the same. [IMAGE: maggie.png] [NOTE: check the episode]',
      '![[Research]]',
      '```',
      'code is not read',
      '```',
      'See [the wiki](https://example.com) and [[Glenn|her husband]].'
    ].join('\n')
    expect(countWords(spokenText(text.split('---\n').pop()!))).toBe(11)
    expect(scriptStats(text).words).toBe(11)
  })

  it('counts words like a person would', () => {
    expect(countWords("Don't stop — S4E9 aired in 2014.")).toBe(6)
  })

  it('works out the length at a pace, with pauses', () => {
    const words = Array.from({ length: 150 }, () => 'word').join(' ')
    const s = scriptStats(`${words} [PAUSE: 2s] [PAUSE]`, 150)
    expect(s.words).toBe(150)
    expect(s.pauses).toBe(2)
    expect(s.seconds).toBeCloseTo(63)
  })

  it('splits into sections', () => {
    const text = 'Hello there.\n[SECTION: Intro]\nOne two three. [IMAGE: a.png]\n[SECTION: Prison]\nFour five.\n[SECTION]\nSix.'
    const s = scriptStats(text, 120)
    expect(s.sections.map((x) => [x.title, x.words, x.images])).toEqual([
      ['', 2, 0],
      ['Intro', 3, 1],
      ['Prison', 2, 0],
      ['Section 3', 1, 0]
    ])
    expect(s.sections[1].from).toBe(text.indexOf('[SECTION: Intro]'))
    expect(s.words).toBe(8)
    expect(s.seconds).toBeCloseTo(4)
  })

  it('leaves out an empty start before the first section', () => {
    expect(scriptStats('# Title\n[SECTION: Intro]\nHi.').sections.map((s) => s.title)).toEqual(['Intro'])
  })

  it('keeps the pace sensible', () => {
    expect(scriptStats('one two', 0).seconds).toBeCloseTo(0.8)
    expect(scriptStats('one two', 10000).seconds).toBeCloseTo(0.48)
  })

  it('formats lengths', () => {
    expect(formatLength(0)).toBe('0:00')
    expect(formatLength(496.4)).toBe('8:16')
    expect(formatLength(3725)).toBe('1:02:05')
  })
})

describe('image cues', () => {
  const images = ['attachments/rick.png', 'Videos/Maggie/maggie.jpg', 'old/rick.png', 'attachments/Daryl.PNG']

  it('finds a picture by its name', () => {
    expect(resolveImage('maggie.jpg', images, 'attachments')).toBe('Videos/Maggie/maggie.jpg')
    expect(resolveImage('daryl.png', images, 'attachments')).toBe('attachments/Daryl.PNG')
    expect(resolveImage('nobody.png', images, 'attachments')).toBe(null)
  })

  it('prefers the attachments folder when two pictures share a name', () => {
    expect(resolveImage('rick.png', images, 'attachments')).toBe('attachments/rick.png')
    expect(resolveImage('old/rick.png', images, 'attachments')).toBe('old/rick.png')
  })

  it('writes just the name when that finds the picture again', () => {
    expect(imageMarkerValue('Videos/Maggie/maggie.jpg', images)).toBe('maggie.jpg')
    expect(imageMarkerValue('old/rick.png', images)).toBe('old/rick.png')
  })
})
