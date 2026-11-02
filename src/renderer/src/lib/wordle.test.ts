import { describe, expect, it } from 'vitest'
import { answersFor, keyboardMarks, markGuess, maxGuesses, pickAnswer, recordResult, walkingDeadKind, winCount, WORDLE_MODES } from './wordle'

describe('wordle', () => {
  it('marks right, close and out letters', () => {
    expect(markGuess('crane', 'react')).toEqual(['close', 'close', 'right', 'out', 'close'])
    expect(markGuess('react', 'react')).toEqual(['right', 'right', 'right', 'right', 'right'])
    expect(markGuess('aeiou', 'house')).toEqual(['out', 'close', 'out', 'close', 'close'])
  })

  it('only marks a repeated letter as many times as the answer has it', () => {
    // One E in the answer: the right-place E wins, the other is out.
    expect(markGuess('geese', 'those')).toEqual(['out', 'out', 'out', 'right', 'right'])
    expect(markGuess('eerie', 'there')).toEqual(['close', 'out', 'close', 'out', 'right'])
    expect(markGuess('llama', 'hello')).toEqual(['close', 'close', 'out', 'out', 'out'])
  })

  it('colours each key by its best mark so far', () => {
    const keys = keyboardMarks(['aeiou', 'house'], 'house')
    expect(keys.h).toBe('right')
    expect(keys.e).toBe('right')
    expect(keys.a).toBe('out')
    expect(keys.z).toBeUndefined()
  })

  it('gives one more guess than letters', () => {
    expect(maxGuesses(2)).toBe(3)
    expect(maxGuesses(5)).toBe(6)
    expect(maxGuesses(8)).toBe(9)
  })

  it('has plenty of lowercase answers of the right length for every mode and length', () => {
    for (const mode of WORDLE_MODES) {
      for (const len of mode.lengths) {
        const words = answersFor(mode.id, len)
        expect(words.length, `${mode.id} ${len}`).toBeGreaterThanOrEqual(mode.id === 'classic' && len === 2 ? 20 : 15)
        expect(new Set(words).size).toBe(words.length)
        for (const w of words) expect(w, `${mode.id} ${len}`).toMatch(new RegExp(`^[a-z]{${len}}$`))
      }
    }
  })

  it('says what kind of word a Walking Dead answer is', () => {
    expect(walkingDeadKind('daryl')).toBe('a character')
    expect(walkingDeadKind('KATANA')).toBe('something from the show')
    expect(walkingDeadKind('guts')).toBeNull()
    expect(walkingDeadKind('house')).toBeNull()
  })

  it('avoids recent answers', () => {
    const all = answersFor('classic', 5)
    const recent = all.slice(0, Math.floor(all.length / 2))
    for (let i = 0; i < 50; i++) expect(recent).not.toContain(pickAnswer('classic', 5, recent))
  })

  it('keeps wins, losses and streaks', () => {
    let s = recordResult(undefined, 5, 3)
    s = recordResult(s, 5, 1)
    expect(s).toEqual({ played: 2, streak: 2, bestStreak: 2, wins: [1, 0, 1, 0, 0, 0] })
    s = recordResult(s, 5, null)
    expect(s.streak).toBe(0)
    expect(s.bestStreak).toBe(2)
    expect(s.played).toBe(3)
    expect(winCount(s)).toBe(2)
  })
})
