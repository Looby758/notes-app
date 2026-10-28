import { describe, expect, it } from 'vitest'
import {
  arrowCurve,
  boardToText,
  boundsOf,
  cardsInGroup,
  colourOf,
  duplicateCards,
  fitView,
  notePreview,
  parseBoard,
  removeCards,
  renameInBoard,
  sideFacing,
  zoomAt,
  type Board
} from './canvas'

const sample = (): Board => ({
  nodes: [
    { id: 'a', type: 'text', text: 'Idea', x: 0, y: 0, width: 200, height: 100 },
    { id: 'b', type: 'file', file: 'Projects/Plan.md', x: 400, y: 0, width: 300, height: 200, color: '4' },
    { id: 'c', type: 'file', file: 'attachments/Sketch 1.svg', x: 0, y: 300, width: 200, height: 120 }
  ],
  edges: [{ id: 'e1', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left', label: 'leads to' }]
})

describe('board files', () => {
  it('saves and reads back the same board', () => {
    const text = boardToText(sample())
    expect(text).toContain('\t"nodes"')
    expect(parseBoard(text)).toEqual(sample())
  })

  it('reads an empty file as an empty board', () => {
    expect(parseBoard('')).toEqual({ nodes: [], edges: [] })
  })

  it('says so when the file is damaged', () => {
    expect(() => parseBoard('{ nope')).toThrow(/damaged/)
  })

  it('skips cards and arrows it can’t read, and keeps fields other apps add', () => {
    const text = JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', text: 'Hi', x: 1, y: 2, width: 3, height: 4, styleAttributes: { shape: 'pill' } },
        { id: 'b', type: 'file' },
        { type: 'text', text: 'no id' }
      ],
      edges: [
        { id: 'e1', fromNode: 'a', toNode: 'gone' },
        { id: 'e2', fromNode: 'a', toNode: 'a', fromSide: 'middle', toEnd: 'none' }
      ]
    })
    const board = parseBoard(text)
    expect(board.nodes).toHaveLength(1)
    expect(board.nodes[0]).toMatchObject({ id: 'a', width: 40, height: 40, styleAttributes: { shape: 'pill' } })
    expect(board.edges).toEqual([{ id: 'e2', fromNode: 'a', toNode: 'a', toEnd: 'none' }])
  })
})

describe('editing boards', () => {
  it('keeps cards pointing at a renamed note or moved folder', () => {
    const renamed = renameInBoard(sample(), 'Projects/Plan.md', 'Projects/Big plan.md')
    expect(renamed.nodes[1]).toMatchObject({ file: 'Projects/Big plan.md' })
    const moved = renameInBoard(sample(), 'attachments', 'pictures')
    expect(moved.nodes[2]).toMatchObject({ file: 'pictures/Sketch 1.svg' })
    const board = sample()
    expect(renameInBoard(board, 'Other.md', 'Else.md')).toBe(board)
  })

  it('removes arrows along with their cards', () => {
    const board = removeCards(sample(), new Set(['a']))
    expect(board.nodes.map((n) => n.id)).toEqual(['b', 'c'])
    expect(board.edges).toEqual([])
  })

  it('duplicates cards with the arrows between them', () => {
    const { board, added } = duplicateCards(sample(), new Set(['a', 'b']))
    expect(added).toHaveLength(2)
    expect(board.nodes).toHaveLength(5)
    expect(board.edges).toHaveLength(2)
    const copy = board.edges[1]
    expect(added).toContain(copy.fromNode)
    expect(added).toContain(copy.toNode)
    expect(board.nodes.find((n) => n.id === added[0])).toMatchObject({ x: 30, y: 30 })
  })

  it('finds the cards inside a group', () => {
    const board: Board = {
      nodes: [
        { id: 'g', type: 'group', x: 0, y: 0, width: 500, height: 500 },
        { id: 'in', type: 'text', text: '', x: 10, y: 10, width: 100, height: 100 },
        { id: 'half', type: 'text', text: '', x: 450, y: 10, width: 100, height: 100 }
      ],
      edges: []
    }
    expect(cardsInGroup(board, board.nodes[0]).map((n) => n.id)).toEqual(['in'])
  })

  it('understands preset and hex colours', () => {
    expect(colourOf('1')).toBe('#e5484d')
    expect(colourOf('#abc')).toBe('#abc')
    expect(colourOf('red')).toBeNull()
    expect(colourOf(undefined)).toBeNull()
  })
})

describe('geometry', () => {
  const box = { x: 0, y: 0, width: 100, height: 100 }

  it('picks the side facing a point', () => {
    expect(sideFacing(box, { x: 300, y: 50 })).toBe('right')
    expect(sideFacing(box, { x: 50, y: -300 })).toBe('top')
    expect(sideFacing(box, { x: -10, y: 60 })).toBe('left')
  })

  it('joins cards from the sides that face each other', () => {
    const [start, , , end] = arrowCurve(box, { x: 300, y: 0, width: 100, height: 100 })
    expect(start).toEqual({ x: 100, y: 50 })
    expect(end).toEqual({ x: 300, y: 50 })
  })

  it('fits everything on screen without zooming in past 100%', () => {
    const bounds = boundsOf([box, { x: 900, y: 400, width: 100, height: 100 }])!
    expect(bounds).toEqual({ x: 0, y: 0, width: 1000, height: 500 })
    const view = fitView(bounds, 620, 620)
    expect(view.zoom).toBeCloseTo(0.5)
    expect(fitView({ x: 0, y: 0, width: 10, height: 10 }, 800, 600).zoom).toBe(1)
  })

  it('zooms around the pointer', () => {
    const view = zoomAt({ x: 0, y: 0, zoom: 1 }, 2, 100, 100)
    // The board point (100, 100) stays under the pointer.
    expect(view.x + 100 / view.zoom).toBe(100)
    expect(view.zoom).toBe(2)
  })
})

describe('note previews', () => {
  it('shows plain text without frontmatter or markdown', () => {
    const text = '---\ntags: [a]\n---\n# Title\n\nSome **bold** and [[Other note|a link]].\n- [ ] todo\n- item\n![[pic.png]]'
    expect(notePreview(text)).toBe('Title\n\nSome bold and a link.\n☐ todo\n• item')
  })

  it('leaves out a first heading that repeats the note’s name', () => {
    expect(notePreview('# Ideas\n\nLoose ideas', 400, 'Ideas')).toBe('Loose ideas')
    expect(notePreview('# Other\n\nLoose ideas', 400, 'Ideas')).toBe('Other\n\nLoose ideas')
  })

  it('cuts long notes short', () => {
    expect(notePreview('x'.repeat(500), 10)).toBe('xxxxxxxxxx…')
  })
})
