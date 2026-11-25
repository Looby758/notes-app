import { describe, expect, it } from 'vitest'
import { HANGMAN_THEMES, hangmanClue, hangmanState, MAX_WRONG, pickHangmanWord, shownLetters, wrongGuesses } from './hangman'

describe('hangman', () => {
  it('has plenty of clean words for every theme, Walking Dead included', () => {
    expect(HANGMAN_THEMES[0].id).toBe('everyday')
    expect(HANGMAN_THEMES.some((t) => t.id === 'walkingDead')).toBe(true)
    for (const t of HANGMAN_THEMES) {
      expect(t.words.length, t.id).toBeGreaterThanOrEqual(40)
      for (const w of t.words) expect(w, t.id).toMatch(/^[a-z]{4,14}$/)
    }
  })

  it('wins when every letter is found and loses on the sixth wrong letter', () => {
    expect(hangmanState('daryl', ['d', 'a', 'r', 'y', 'l'])).toBe('won')
    expect(hangmanState('daryl', ['d', 'z'])).toBe('playing')
    const wrong = ['b', 'c', 'e', 'f', 'g', 'h']
    expect(wrong).toHaveLength(MAX_WRONG)
    expect(hangmanState('daryl', wrong.slice(0, 5))).toBe('playing')
    expect(hangmanState('daryl', wrong)).toBe('lost')
    expect(wrongGuesses('daryl', ['d', 'q', 'a', 'x'])).toEqual(['q', 'x'])
    expect(shownLetters('negan', ['n', 'a'])).toEqual(['n', null, null, 'a', 'n'])
  })

  it('avoids recent words and gives clues', () => {
    const twd = HANGMAN_THEMES.find((t) => t.id === 'walkingDead')!.words
    const recent = twd.slice(0, Math.floor(twd.length / 2))
    for (let i = 0; i < 30; i++) expect(recent).not.toContain(pickHangmanWord('walkingDead', recent))
    expect(hangmanClue('walkingDead', 'michonne')).toBe("It's a character")
    expect(hangmanClue('walkingDead', 'whisperers')).toBe("It's a group or community")
    expect(hangmanClue('animals', 'zebra')).toBe('Animals, 5 letters')
  })
})
