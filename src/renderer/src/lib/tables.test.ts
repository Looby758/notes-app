import { describe, expect, it } from 'vitest'
import { addColumn, addRow, formatTable, parseTable, removeColumn, removeRow, setAlign, setCell, sortBy } from './tables'

const md = '| Name | Score |\n| :-- | --: |\n| Sam | 10 |\n| Alex | 9 |\n| Bea \\| B | 100 |'

describe('parseTable', () => {
  it('reads header, alignment and rows (with escaped pipes)', () => {
    const t = parseTable(md)
    expect(t.header).toEqual(['Name', 'Score'])
    expect(t.align).toEqual(['left', 'right'])
    expect(t.rows).toEqual([
      ['Sam', '10'],
      ['Alex', '9'],
      ['Bea \\| B', '100']
    ])
  })
  it('fills short rows', () => {
    expect(parseTable('| a | b |\n| --- | --- |\n| 1 |').rows).toEqual([['1', '']])
  })
})

describe('formatTable', () => {
  it('lines columns up and keeps alignment', () => {
    expect(formatTable(parseTable(md))).toBe(
      ['| Name     | Score |', '| :------- | ----: |', '| Sam      |    10 |', '| Alex     |     9 |', '| Bea \\| B |   100 |'].join('\n')
    )
  })
  it('escapes pipes typed into a cell', () => {
    expect(formatTable(setCell(parseTable('| a |\n| --- |\n| x |'), 0, 0, 'x | y'))).toContain('x \\| y')
  })
})

describe('editing', () => {
  const t = parseTable(md)
  it('adds and removes rows and columns', () => {
    expect(addRow(t, 0).rows[1]).toEqual(['', ''])
    expect(removeRow(t, 0).rows.map((r) => r[0])).toEqual(['Alex', 'Bea \\| B'])
    const wide = addColumn(t, 0)
    expect(wide.header).toEqual(['Name', 'Column 3', 'Score'])
    expect(wide.rows[0]).toEqual(['Sam', '', '10'])
    expect(removeColumn(wide, 1).header).toEqual(['Name', 'Score'])
    expect(removeColumn(parseTable('| a |\n| --- |'), 0).header).toEqual(['a'])
  })
  it('sorts numbers as numbers', () => {
    expect(sortBy(t, 1).rows.map((r) => r[1])).toEqual(['9', '10', '100'])
    expect(sortBy(t, 0, true).rows.map((r) => r[0])).toEqual(['Sam', 'Bea \\| B', 'Alex'])
  })
  it('sets alignment and cells', () => {
    expect(setAlign(t, 0, 'center').align).toEqual(['center', 'right'])
    expect(setCell(t, -1, 1, 'Points').header).toEqual(['Name', 'Points'])
  })
})
