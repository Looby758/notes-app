import { describe, expect, it } from 'vitest'
import { displayWord, lineBetween, makeWordSearch, snapLine, walkingDeadSearchKind, wordAt, WORD_SEARCH_SIZES } from './wordSearch'
import { WORD_SEARCH_THEMES } from './wordSearchWords'

/** A repeatable random number source, so a failing puzzle can be made again. */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

describe('word search', () => {
  it('has plenty of clean words in every theme', () => {
    for (const t of WORD_SEARCH_THEMES) {
      expect(t.words.length, t.id).toBeGreaterThanOrEqual(50)
      expect(new Set(t.words).size).toBe(t.words.length)
      for (const w of t.words) expect(w, t.id).toMatch(/^[a-z]{3,14}$/)
    }
  })

  it('keeps everyday zombie words out of Walking Dead', () => {
    const twd = WORD_SEARCH_THEMES.find((t) => t.id === 'walkingDead')!.words
    for (const w of ['zombie', 'zombies', 'guts', 'dead', 'survival', 'survivor', 'bite', 'horde', 'apocalypse', 'undead', 'infected'])
      expect(twd, w).not.toContain(w)
    expect(twd).toEqual(expect.arrayContaining(['daryl', 'michonne', 'negan', 'lucille', 'alexandria', 'whisperers', 'terminus']))
    expect(walkingDeadSearchKind('daryl')).toBe('a character')
    expect(walkingDeadSearchKind('hilltop')).toBe('a place')
    expect(walkingDeadSearchKind('saviors')).toBe('a group or community')
    expect(walkingDeadSearchKind('banana')).toBeNull()
    expect(displayWord('tdog')).toBe('T-DOG')
  })

  it('hides every word in a straight line, spelled out on the board', () => {
    for (const t of WORD_SEARCH_THEMES) {
      for (const s of WORD_SEARCH_SIZES) {
        for (let seed = 1; seed <= 15; seed++) {
          const p = makeWordSearch(t.id, s.id, seeded(seed * 31 + s.grid))
          expect(p.letters).toMatch(new RegExp(`^[a-z]{${s.grid * s.grid}}$`))
          expect(p.words.length, `${t.id} ${s.id}`).toBe(s.words)
          for (const { word, cells } of p.words) {
            expect(cells.map((c) => p.letters[c]).join('')).toBe(word)
            expect(lineBetween(p.grid, cells[0], cells[cells.length - 1])).toEqual(cells)
            expect(wordAt(p, cells)?.word).toBe(word)
            expect(wordAt(p, [...cells].reverse())?.word).toBe(word)
          }
          // No word sits inside another, so finding one never finds two.
          for (const a of p.words) for (const b of p.words) if (a !== b) expect(a.word.includes(b.word)).toBe(false)
        }
      }
    }
  })

  it('only goes backwards and diagonally on the bigger sizes', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const p = makeWordSearch('animals', 'small', seeded(seed))
      for (const { cells } of p.words) {
        const step = cells[1] - cells[0]
        expect([1, p.grid]).toContain(step)
      }
    }
  })

  it('snaps a wobbly drag to the nearest straight line', () => {
    // 10 × 10: from the top-left square towards row 1, col 6 is still "across".
    expect(snapLine(10, 0, 1, 6)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(snapLine(10, 0, 5, 4)).toEqual([0, 11, 22, 33, 44, 55])
    expect(snapLine(10, 0, 0, 0)).toEqual([0])
    // Off the edge it stops at the edge.
    expect(snapLine(10, 8, 0, 20)).toEqual([8, 9])
    expect(lineBetween(10, 0, 12)).toEqual([0])
  })
})
