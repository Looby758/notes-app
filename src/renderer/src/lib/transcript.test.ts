import { describe, expect, it } from 'vitest'
import { alignWords, lineUp, likeness, readTranscript, scriptWords, sentences, spokenMask, transcriptFile, transcriptJson, wordKey } from './transcript'
import type { SpokenWord } from '@shared/transcribe'

/** Heard words, one every half second. */
const said = (text: string, start = 0): SpokenWord[] =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => ({ w, s: start + i * 0.5, e: start + i * 0.5 + 0.4 }))

describe('script words', () => {
  it('keeps only what is read out, in place', () => {
    const text = '---\ntype: script\n---\n# Heading\n[SECTION: Prison] Rick [IMAGE: rick.png] wakes up. [EMPHASIS: never] [NOTE: check] see [[Maggie Rhee|Maggie]] and [the wiki](https://x.com).'
    const mask = spokenMask(text)
    expect(mask.length).toBe(text.length)
    const words = scriptWords(text)
    expect(words.map((w) => w.key)).toEqual(['rick', 'wakes', 'up', 'never', 'see', 'maggie', 'and', 'the', 'wiki'])
    for (const w of words) expect(wordKey(text.slice(w.from, w.to))).toBe(w.key)
  })

  it('makes words comparable', () => {
    expect(wordKey("Don't")).toBe('dont')
    expect(wordKey('Négan,')).toBe('negan')
    expect(likeness('negan', 'neegan')).toBe(1)
    expect(likeness('rick', 'ricks')).toBe(1)
    expect(likeness('two', '2')).toBe(2)
    expect(likeness('cat', 'dog')).toBe(0)
  })
})

describe('alignWords', () => {
  const words = (t: string): string[] => t.split(' ')

  it('lines up a recording of the whole script, with a word skipped and one added', () => {
    const script = words('and so my fellow americans ask not what your country can do for you')
    const heard = words('and so um my fellow americans asked not what country can do for you')
    const m = alignWords(script, heard)
    expect(m[0]).toBe(0)
    expect(m[2]).toBe(3) // "my" after the added "um"
    expect(m[5]).toBe(6) // "ask" heard as "asked"
    expect(m[8]).toBe(-1) // "your" skipped
    expect(m[13]).toBe(13)
  })

  it('finds where a recording of one section is in a long script', () => {
    const filler = Array.from({ length: 3000 }, (_, i) => `word${i}`)
    const section = words('the governor attacks the prison with a tank and hershel is killed')
    const script = [...filler.slice(0, 1500), ...section, ...filler.slice(1500)]
    const m = alignWords(script, section)
    expect(m[1500]).toBe(0)
    expect(m[1500 + section.length - 1]).toBe(section.length - 1)
    expect(m[0]).toBe(-1)
    expect(m[script.length - 1]).toBe(-1)
  })

  it('copes with nothing heard, or nothing alike', () => {
    expect([...alignWords(['a', 'b'], [])]).toEqual([-1, -1])
    expect([...alignWords(['alpha', 'beta'], ['gamma'])]).toEqual([-1, -1])
  })
})

describe('lineUp', () => {
  const script = '# JFK\n[SECTION: The ask]\nAnd so my fellow Americans [IMAGE: flag.png] ask not what your country can do for you.\n[PAUSE]\nAsk what you can do for your country.\n[NOTE: end]'

  it('times every word and marker', () => {
    const heard = said('And so my fellow Americans asked not what your country can do for you, ask what you can do for your country.')
    const l = lineUp(script, heard)
    expect(l.found).toBeGreaterThan(0.9)
    const time = (type: string): number | null => l.markers.find((m) => m.marker.type === type)!.time
    expect(time('SECTION')).toBe(0)
    expect(time('IMAGE')).toBe(2.5) // "ask", the 6th word
    expect(time('PAUSE')).toBe(7) // "Ask", the 15th word
    expect(time('NOTE')).toBe(10.9) // after the last word ends
  })

  it('shows extra words and spreads times over skipped ones', () => {
    const heard = said('And so my fellow Americans um ask not what can do for you')
    const l = lineUp(script, heard)
    expect(l.extras.get(4)?.map((w) => w.w)).toEqual(['um'])
    const your = l.words.findIndex((w) => w.key === 'your')
    expect(l.match[your]).toBe(-1)
    expect(l.times[your]).toBeGreaterThan(l.times[your - 1]!)
    expect(l.times[your]).toBeLessThan(l.times[your + 1]!)
    // Not said at all: no time.
    expect(l.markers.find((m) => m.marker.type === 'PAUSE')!.time).toBe(heard[heard.length - 1].e)
  })

  it('gives markers before what was recorded no time', () => {
    const heard = said('ask what you can do for your country', 3)
    const l = lineUp(script, heard)
    expect(l.markers.find((m) => m.marker.type === 'IMAGE')!.time).toBeNull()
    expect(l.markers.find((m) => m.marker.type === 'PAUSE')!.time).toBe(3)
  })
})

describe('transcript files', () => {
  it('round-trips, and leaves broken words out', () => {
    const t = {
      recording: 'a/take.m4a',
      made: 5,
      model: 'small',
      length: 10,
      fileTime: 1,
      fileSize: 2,
      words: said('hello there')
    }
    expect(readTranscript(transcriptJson(t))).toEqual(t)
    expect(readTranscript('{"words":[["", 1, 2], [5], ["ok", 1, 0.5]]}')!.words).toEqual([{ w: 'ok', s: 1, e: 1 }])
    expect(readTranscript('nope')).toBeNull()
    expect(transcriptFile('abc123')).toBe('transcript-abc123.json')
    expect(transcriptFile('../x')).toBeNull()
  })

  it('splits what was said into sentences', () => {
    const heard = [...said('Hello there. How are you?'), ...said('Fine', 10)]
    expect(sentences(heard).map((s) => s.text)).toEqual(['Hello there.', 'How are you?', 'Fine'])
  })
})
