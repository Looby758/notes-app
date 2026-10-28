import { describe, expect, it } from 'vitest'
import { Calculator, formatValue, numberFrom, type Value } from './formulas'

/** A workbook of typed entries, worked out the way the editor does it. */
function book(sheets: Record<string, string[][]>): (ref: string, sheet?: string) => string {
  const names = Object.keys(sheets)
  const grid = (s: number): string[][] => sheets[names[s]]
  const plain = (s: number, r: number, c: number): Value => {
    const t = grid(s)[r]?.[c] ?? ''
    return t === '' ? '' : (numberFrom(t) ?? t)
  }
  const calc = new Calculator(
    () => names,
    (s, r, c) => grid(s)[r]?.[c] ?? '',
    plain,
    (s) => ({ rows: grid(s).length, cols: Math.max(...grid(s).map((r) => r.length)) })
  )
  return (ref, sheet = names[0]) => {
    const col = ref.charCodeAt(0) - 65
    const row = Number(ref.slice(1)) - 1
    return formatValue(calc.value(names.indexOf(sheet), row, col))
  }
}

describe('formulas', () => {
  it('does arithmetic in the right order', () => {
    const at = book({ S: [['=1+2*3', '=(1+2)*3', '=2^3^2', '=-2^2', '=50%*10', '=10/4', '="a"&1&TRUE']] })
    expect(['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1'].map((r) => at(r))).toEqual(['7', '9', '512', '4', '5', '2.5', 'a1TRUE'])
  })

  it('follows cell references and ranges', () => {
    const at = book({
      S: [
        ['10', '£1,200', '=A1+B1'],
        ['20', 'apples', '=SUM(A1:A3)'],
        ['30', '', '=AVERAGE(A:A)'],
        ['=C1*2', '', '=COUNT(A1:B3)&"/"&COUNTA(A1:B3)']
      ]
    })
    expect(at('C1')).toBe('1210')
    expect(at('C2')).toBe('60')
    expect(at('C3')).toBe('620')
    expect(at('A4')).toBe('2420')
    expect(at('C4')).toBe('4/5')
  })

  it('has the everyday functions', () => {
    const at = book({
      S: [
        ['5', 'done', '=IF(A1>3,"big","small")', '=ROUND(2.345,2)', '=MAX(A1:A3)-MIN(A1:A3)'],
        ['8', 'todo', '=COUNTIF(B1:B3,"done")', '=SUMIF(B1:B3,"done",A1:A3)', '=IFERROR(1/0,"none")'],
        ['2', 'done', '=VLOOKUP("todo",A1:B3,1,FALSE)', '=UPPER(LEFT(B2,2))', '=SUMIF(A1:A3,">4")'],
        ['=AND(A1>1,A2>1)', '=OR(FALSE,0)', '=MEDIAN(A1:A3)', '=LEN("hello")', '=MOD(-7,3)']
      ]
    })
    expect(at('C1')).toBe('big')
    expect(at('D1')).toBe('2.35')
    expect(at('E1')).toBe('6')
    expect(at('C2')).toBe('2')
    expect(at('D2')).toBe('7')
    expect(at('E2')).toBe('none')
    expect(at('C3')).toBe('#N/A')
    expect(at('D3')).toBe('TO')
    expect(at('E3')).toBe('13')
    expect(at('A4')).toBe('TRUE')
    expect(at('B4')).toBe('FALSE')
    expect(at('C4')).toBe('5')
    expect(at('D4')).toBe('5')
    expect(at('E4')).toBe('2')
  })

  it('reads other sheets', () => {
    const at = book({ Main: [['=Costs!A1+\'My data\'!A1', '=SUM(Costs!A1:A2)', '=Nope!A1']], Costs: [['4'], ['6']], 'My data': [['1']] })
    expect(at('A1')).toBe('5')
    expect(at('B1')).toBe('10')
    expect(at('C1')).toBe('#REF!')
  })

  it('shows errors instead of breaking', () => {
    const at = book({ S: [['=1/0', '=A1+1', '=B1', '=C1', '=FOO(1)', '=1+', '="a"*2', '=D1']] })
    expect(at('A1')).toBe('#DIV/0!')
    expect(at('B1')).toBe('#DIV/0!')
    const loop = book({ S: [['=B1', '=A1', '=A1+1']] })
    expect(loop('A1')).toBe('#CYCLE!')
    expect(loop('C1')).toBe('#CYCLE!')
    expect(at('E1')).toBe('#NAME?')
    expect(at('F1')).toBe('#ERROR!')
    expect(at('G1')).toBe('#VALUE!')
  })

  it('reads typed numbers', () => {
    expect(numberFrom('1,200.50')).toBe(1200.5)
    expect(numberFrom('£4.50')).toBe(4.5)
    expect(numberFrom('15%')).toBe(0.15)
    expect(numberFrom('(12)')).toBe(-12)
    expect(numberFrom('12 apples')).toBeNull()
  })
})
