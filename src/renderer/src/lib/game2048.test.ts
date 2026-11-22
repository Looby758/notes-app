import { describe, expect, it } from 'vitest'
import { addTile, boardOf, canMove, newBoard, slide, slideLine, slideTiles, tileId, tilesOf } from './game2048'

describe('2048', () => {
  it('slides and joins a line once per tile', () => {
    expect(slideLine([2, 2, 2, 2])).toEqual({ line: [4, 4, 0, 0], gained: 8 })
    expect(slideLine([0, 2, 0, 2])).toEqual({ line: [4, 0, 0, 0], gained: 4 })
    expect(slideLine([4, 4, 8, 0])).toEqual({ line: [8, 8, 0, 0], gained: 8 })
    expect(slideLine([2, 4, 8, 16])).toEqual({ line: [2, 4, 8, 16], gained: 0 })
  })

  it('slides the board each way and marks joined tiles', () => {
    // prettier-ignore
    const b = [
      2, 2, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 2,
      0, 0, 0, 2
    ]
    const right = slide(b, 'right')
    expect(right.board.slice(0, 4)).toEqual([0, 0, 0, 4])
    expect(right.joined).toEqual([3])
    const down = slide(b, 'down')
    expect(down.board[15]).toBe(4)
    expect(down.board[12]).toBe(2)
    expect(slide([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2], 'left').moved).toBe(false)
  })

  it('knows when no move is left', () => {
    expect(canMove([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2])).toBe(false)
    expect(canMove([2, 2, 4, 8, 4, 8, 16, 32, 2, 4, 8, 16, 4, 8, 16, 32])).toBe(true)
  })

  it('starts with two tiles and adds one to an empty square', () => {
    expect(newBoard().filter(Boolean)).toHaveLength(2)
    const { board, at } = addTile([2, 0, 4, 8], () => 0)
    expect(at).toBe(1)
    expect(board[1]).toBe(2)
  })
})

describe('2048 tiles', () => {
  it('track each tile and agree with the board slide', () => {
    let seed = 7
    const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
    let board = newBoard(random)
    let tiles = tilesOf(board)
    const dirs = ['left', 'up', 'right', 'down'] as const
    for (let i = 0; i < 300 && canMove(board); i++) {
      const dir = dirs[Math.floor(random() * 4)]
      const s = slide(board, dir)
      const t = slideTiles(tiles, dir)
      expect(t.moved).toBe(s.moved)
      expect(boardOf(t.tiles)).toEqual(s.board)
      if (!s.moved) continue
      const added = addTile(s.board, random)
      board = added.board
      tiles = [...t.tiles.filter((x) => !x.gone), { id: tileId(), value: added.board[added.at], at: added.at, isNew: true }]
    }
  })
})
