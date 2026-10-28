/**
 * Spreadsheet formulas, close enough to Excel for everyday sums: "=A1*2", "=SUM(B2:B20)",
 * "=IF(C3>100, "Big", "Small")", "=Sheet2!A1+1". A formula is parsed once into a tree, then worked
 * out against whatever cells it points at; a cell that (through others) points at itself shows #CYCLE!.
 */

export type Value = number | string | boolean | FormulaError
/** A range like A1:B3, as rows of values. */
type Grid = Value[][]
type Arg = Value | Grid

export class FormulaError {
  constructor(readonly code: '#DIV/0!' | '#VALUE!' | '#REF!' | '#NAME?' | '#N/A' | '#NUM!' | '#CYCLE!' | '#ERROR!') {}
  toString(): string {
    return this.code
  }
}

const err = (code: FormulaError['code']): FormulaError => new FormulaError(code)
export const isError = (v: unknown): v is FormulaError => v instanceof FormulaError

/** Where a formula reads its cells from. `sheet` is undefined for the formula's own sheet. */
export interface CellSource {
  value(sheet: string | undefined, row: number, col: number): Value
  /** How many rows and columns a sheet has, so whole-column ranges (A:A) stop somewhere. */
  size(sheet: string | undefined): { rows: number; cols: number } | null
}

// ---------- parsing ----------

type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'ref'; sheet?: string; row: number; col: number }
  | { t: 'range'; sheet?: string; r1: number; c1: number; r2: number; c2: number }
  | { t: 'un'; op: string; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'pct'; a: Node }
  | { t: 'call'; name: string; args: Node[] }

type Token = { k: 'num' | 'str' | 'ref' | 'name' | 'op' | 'sheet'; v: string }

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    const rest = src.slice(i)
    let m: RegExpExecArray | null
    if ((m = /^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?/i.exec(rest))) out.push({ k: 'num', v: m[0] })
    else if (c === '"') {
      let s = ''
      let j = i + 1
      for (; j < src.length; j++) {
        if (src[j] === '"' && src[j + 1] === '"') {
          s += '"'
          j++
        } else if (src[j] === '"') break
        else s += src[j]
      }
      if (j >= src.length) throw new Error('unclosed text')
      out.push({ k: 'str', v: s })
      i = j + 1
      continue
    } else if ((m = /^'((?:[^']|'')+)'!/.exec(rest))) {
      out.push({ k: 'sheet', v: m[1].replace(/''/g, "'") })
    } else if ((m = /^([A-Za-z_][\w.]*)!/.exec(rest))) out.push({ k: 'sheet', v: m[1] })
    else if ((m = /^\$?[A-Za-z]{1,3}\$?\d+(?![\w(])/.exec(rest))) out.push({ k: 'ref', v: m[0] })
    // A whole column, as either half of a range like A:A or B:D.
    else if ((m = /^\$?[A-Za-z]{1,3}(?![\w(])/.exec(rest)) && (rest[m[0].length] === ':' || out.at(-1)?.v === ':')) out.push({ k: 'ref', v: m[0] })
    else if ((m = /^[A-Za-z_][\w.]*/.exec(rest))) out.push({ k: 'name', v: m[0] })
    else if ((m = /^(<=|>=|<>|[-+*/^&=<>(),:%;])/.exec(rest))) out.push({ k: 'op', v: m[0] === ';' ? ',' : m[0] })
    else throw new Error(`unexpected ${c}`)
    i += m[0].length
  }
  return out
}

/** "B3" → row 2, col 1; "C" → col 2 (whole column); "4" → row 3 (whole row). */
function parseRef(ref: string): { row?: number; col?: number } {
  const m = /^\$?([A-Za-z]*)\$?(\d*)$/.exec(ref)!
  let col: number | undefined
  if (m[1]) {
    col = 0
    for (const ch of m[1].toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64
    col -= 1
  }
  return { col, row: m[2] ? Number(m[2]) - 1 : undefined }
}

const PRECEDENCE: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 }

export function parseFormula(src: string): Node {
  const tokens = tokenize(src)
  let pos = 0
  const peek = (): Token | undefined => tokens[pos]
  const isOp = (v: string): boolean => peek()?.k === 'op' && peek()!.v === v
  const expect = (v: string): void => {
    if (!isOp(v)) throw new Error(`expected ${v}`)
    pos++
  }

  const expr = (min = 0): Node => {
    let left = unary()
    for (;;) {
      const t = peek()
      const p = t?.k === 'op' ? PRECEDENCE[t.v] : undefined
      if (p === undefined || p < min) return left
      pos++
      // ^ groups to the right; the rest to the left.
      left = { t: 'bin', op: t!.v, a: left, b: expr(t!.v === '^' ? p : p + 1) }
    }
  }

  const unary = (): Node => {
    if (isOp('-') || isOp('+')) {
      const op = tokens[pos++].v
      // Excel puts unary minus above ^ (so -2^2 is 4); keep that.
      return { t: 'un', op, a: unary() }
    }
    let node = primary()
    while (isOp('%')) {
      pos++
      node = { t: 'pct', a: node }
    }
    return node
  }

  const reference = (sheet?: string): Node => {
    const t = tokens[pos++]
    if (t?.k !== 'ref') throw new Error('expected a cell')
    const a = parseRef(t.v)
    if (!isOp(':')) {
      if (a.row === undefined || a.col === undefined) throw new Error('bad cell')
      return { t: 'ref', sheet, row: a.row, col: a.col }
    }
    pos++
    const t2 = tokens[pos++]
    if (t2?.k !== 'ref') throw new Error('expected a cell')
    const b = parseRef(t2.v)
    // Whole columns and rows run to the end of the sheet (-1 is filled in when worked out).
    const r1 = a.row ?? 0
    const c1 = a.col ?? 0
    const r2 = b.row ?? (a.row === undefined ? -1 : r1)
    const c2 = b.col ?? (a.col === undefined ? -1 : c1)
    return { t: 'range', sheet, r1: Math.min(r1, r2 < 0 ? r1 : r2), c1: Math.min(c1, c2 < 0 ? c1 : c2), r2: r2 < 0 ? -1 : Math.max(r1, r2), c2: c2 < 0 ? -1 : Math.max(c1, c2) }
  }

  const primary = (): Node => {
    const t = peek()
    if (!t) throw new Error('unfinished formula')
    if (t.k === 'num') {
      pos++
      return { t: 'num', v: Number(t.v) }
    }
    if (t.k === 'str') {
      pos++
      return { t: 'str', v: t.v }
    }
    if (t.k === 'sheet') {
      pos++
      return reference(t.v)
    }
    if (t.k === 'ref') return reference()
    if (t.k === 'name') {
      pos++
      const name = t.v.toUpperCase()
      if (isOp('(')) {
        pos++
        const args: Node[] = []
        if (!isOp(')')) {
          do {
            // An empty argument, as in IF(A1,,1), counts as blank.
            args.push(isOp(',') || isOp(')') ? { t: 'str', v: '' } : expr())
          } while (isOp(',') && ++pos)
        }
        expect(')')
        return { t: 'call', name, args }
      }
      if (name === 'TRUE' || name === 'FALSE') return { t: 'bool', v: name === 'TRUE' }
      return { t: 'call', name: '#NAME', args: [] }
    }
    if (isOp('(')) {
      pos++
      const inner = expr()
      expect(')')
      return inner
    }
    throw new Error(`unexpected ${t.v}`)
  }

  const node = expr()
  if (pos < tokens.length) throw new Error(`unexpected ${tokens[pos].v}`)
  return node
}

// ---------- values ----------

/** Text that reads as a number ("1,200", "£4.50", "15%") counts as one, as Excel does with typed values. */
export function numberFrom(text: string): number | null {
  const s = text.trim()
  if (!s) return null
  const m = /^([-+]?)\(?[$£€¥]?\s?(\d[\d,]*(\.\d+)?|\.\d+)(e[+-]?\d+)?\)?(%?)$/i.exec(s)
  if (!m || (s.includes('(') !== s.includes(')'))) return null
  let n = Number((m[2] + (m[4] ?? '')).replace(/,/g, ''))
  if (m[1] === '-' || s.startsWith('(')) n = -n
  return m[5] ? n / 100 : n
}

function toNumber(v: Value): number | FormulaError {
  if (isError(v)) return v
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === '') return 0
  return numberFrom(v) ?? err('#VALUE!')
}

function toText(v: Value): string {
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return formatValue(v)
  return String(v)
}

function toBool(v: Value): boolean | FormulaError {
  if (isError(v)) return v
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (/^true$/i.test(v)) return true
  if (/^false$/i.test(v) || v === '') return false
  return err('#VALUE!')
}

/** How a worked-out value reads in its cell. */
export function formatValue(v: Value): string {
  if (typeof v === 'number') {
    if (!isFinite(v)) return '#NUM!'
    return String(Number(v.toPrecision(12)))
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v)
}

/** Every value in a list of arguments, ranges flattened. */
const flat = (args: Arg[]): Value[] => args.flatMap((a) => (Array.isArray(a) ? a.flat() : [a]))

/** The numbers SUM and friends add up: numbers in ranges, and anything typed straight in that reads as one. */
function numbers(args: Arg[]): number[] | FormulaError {
  const out: number[] = []
  for (const a of args) {
    if (Array.isArray(a)) {
      for (const v of a.flat()) {
        if (isError(v)) return v
        if (typeof v === 'number') out.push(v)
      }
    } else {
      const n = toNumber(a)
      if (isError(n)) return n
      out.push(n)
    }
  }
  return out
}

/** A COUNTIF/SUMIF condition like ">10", "<>done", "apple" or 5, as a test. */
function criterion(c: Value): (v: Value) => boolean {
  if (typeof c !== 'string') return (v) => v === c || (typeof v === 'string' && numberFrom(v) === c)
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(c)!
  const op = m[1] ?? '='
  const target = m[2]
  const n = numberFrom(target)
  return (v) => {
    if (isError(v)) return false
    const vn = typeof v === 'number' ? v : typeof v === 'string' ? numberFrom(v) : null
    if (n !== null && vn !== null) {
      return op === '=' ? vn === n : op === '<>' ? vn !== n : op === '<' ? vn < n : op === '>' ? vn > n : op === '<=' ? vn <= n : vn >= n
    }
    const text = toText(v).toLowerCase()
    const t = target.toLowerCase()
    if (op === '=' || op === '<>') {
      // * and ? are wildcards, as in Excel.
      const re = new RegExp(`^${t.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
      return op === '=' ? re.test(text) : !re.test(text)
    }
    if (n !== null) return false
    return op === '<' ? text < t : op === '>' ? text > t : op === '<=' ? text <= t : text >= t
  }
}

const round = (n: number, digits: number, how: 'near' | 'up' | 'down'): number => {
  const f = 10 ** digits
  const x = Math.abs(n) * f
  const r = how === 'near' ? Math.round(Number(x.toPrecision(15))) : how === 'up' ? Math.ceil(Number(x.toPrecision(15))) : Math.floor(Number(x.toPrecision(15)))
  return (Math.sign(n) * r) / f
}

const EPOCH = Date.UTC(1899, 11, 30)
const today = (): number => {
  const d = new Date()
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 86400000)
}

type Fn = (args: Arg[]) => Value

/** Wraps a function of plain numbers, passing errors through. */
const math =
  (f: (...n: number[]) => number | FormulaError): Fn =>
  (args) => {
    const ns: number[] = []
    for (const a of args) {
      const n = toNumber(Array.isArray(a) ? (a[0]?.[0] ?? '') : a)
      if (isError(n)) return n
      ns.push(n)
    }
    const r = f(...ns)
    return typeof r === 'number' && !isFinite(r) ? err('#NUM!') : r
  }

const text =
  (f: (...s: string[]) => Value): Fn =>
  (args) => {
    const vals = args.map((a) => (Array.isArray(a) ? (a[0]?.[0] ?? '') : a))
    const bad = vals.find(isError)
    return bad ?? f(...vals.map(toText))
  }

const aggregate =
  (f: (ns: number[]) => Value): Fn =>
  (args) => {
    const ns = numbers(args)
    return isError(ns) ? ns : f(ns)
  }

/** SUMIF/AVERAGEIF: the cells of `sum` (or `range`) where `range` meets the condition. */
function matching(args: Arg[]): number[] | FormulaError {
  const range = Array.isArray(args[0]) ? args[0] : [[args[0]]]
  const sum = args[2] === undefined ? range : Array.isArray(args[2]) ? args[2] : [[args[2]]]
  const test = criterion(Array.isArray(args[1]) ? args[1][0][0] : args[1])
  const out: number[] = []
  range.forEach((row, r) =>
    row.forEach((v, c) => {
      const s = sum[r]?.[c]
      if (test(v) && typeof s === 'number') out.push(s)
    })
  )
  return out
}

function lookup(args: Arg[], vertical: boolean): Value {
  const [key, table, index, approx] = args
  if (isError(key)) return key
  if (!Array.isArray(table)) return err('#VALUE!')
  const i = toNumber(Array.isArray(index) ? index[0][0] : index)
  if (isError(i)) return i
  const exact = approx !== undefined && !Array.isArray(approx) ? toBool(approx) === false : false
  const lines = vertical ? table : (table[0] ?? []).map((_, c) => table.map((row) => row[c]))
  const k = key as Value
  if (i < 1 || i > (lines[0]?.length ?? 0)) return err('#REF!')
  const same = (v: Value): boolean => (typeof k === 'string' && typeof v === 'string' ? k.toLowerCase() === v.toLowerCase() : v === k)
  if (exact) {
    const hit = lines.find((line) => same(line[0]))
    return hit ? hit[i - 1] : err('#N/A')
  }
  // Sorted lookup: the last line whose first value isn't past the key.
  let found: Value[] | undefined
  for (const line of lines) {
    const v = line[0]
    if (typeof k === 'number' ? typeof v === 'number' && v <= k : typeof v === 'string' && toText(v).toLowerCase() <= toText(k).toLowerCase()) found = line
    else if (v !== '') break
  }
  return found ? found[i - 1] : err('#N/A')
}

const FUNCTIONS: Record<string, Fn> = {
  SUM: aggregate((ns) => ns.reduce((a, b) => a + b, 0)),
  PRODUCT: aggregate((ns) => ns.reduce((a, b) => a * b, 1)),
  AVERAGE: aggregate((ns) => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : err('#DIV/0!'))),
  MIN: aggregate((ns) => (ns.length ? Math.min(...ns) : 0)),
  MAX: aggregate((ns) => (ns.length ? Math.max(...ns) : 0)),
  MEDIAN: aggregate((ns) => {
    if (!ns.length) return err('#NUM!')
    const s = [...ns].sort((a, b) => a - b)
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }),
  COUNT: (args) => flat(args).filter((v) => typeof v === 'number').length,
  COUNTA: (args) => flat(args).filter((v) => v !== '').length,
  COUNTBLANK: (args) => flat(args).filter((v) => v === '').length,
  COUNTIF: (args) => {
    const test = criterion(Array.isArray(args[1]) ? args[1][0][0] : args[1])
    return flat([args[0]]).filter(test).length
  },
  SUMIF: (args) => {
    const ns = matching(args)
    return isError(ns) ? ns : ns.reduce((a, b) => a + b, 0)
  },
  AVERAGEIF: (args) => {
    const ns = matching(args)
    return isError(ns) ? ns : ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : err('#DIV/0!')
  },
  ROUND: math((n, d = 0) => round(n, Math.trunc(d), 'near')),
  ROUNDUP: math((n, d = 0) => round(n, Math.trunc(d), 'up')),
  ROUNDDOWN: math((n, d = 0) => round(n, Math.trunc(d), 'down')),
  INT: math((n) => Math.floor(n)),
  ABS: math((n) => Math.abs(n)),
  SQRT: math((n) => (n < 0 ? err('#NUM!') : Math.sqrt(n))),
  POWER: math((a, b) => a ** b),
  MOD: math((a, b) => (b === 0 ? err('#DIV/0!') : a - b * Math.floor(a / b))),
  PI: () => Math.PI,
  TODAY: () => today(),
  NOW: () => (Date.now() - new Date().getTimezoneOffset() * 60000 - EPOCH) / 86400000,
  IF: (args) => {
    const c = toBool(Array.isArray(args[0]) ? args[0][0][0] : (args[0] ?? false))
    if (isError(c)) return c
    const pick = c ? args[1] : args[2]
    if (pick === undefined) return c ? true : false
    return Array.isArray(pick) ? pick[0][0] : pick
  },
  IFERROR: (args) => {
    const v = Array.isArray(args[0]) ? args[0][0][0] : args[0]
    const alt = Array.isArray(args[1]) ? args[1][0][0] : (args[1] ?? '')
    return isError(v) ? alt : v
  },
  AND: (args) => {
    for (const v of flat(args)) {
      const b = toBool(v)
      if (isError(b)) return b
      if (!b) return false
    }
    return true
  },
  OR: (args) => {
    for (const v of flat(args)) {
      const b = toBool(v)
      if (isError(b)) return b
      if (b) return true
    }
    return false
  },
  NOT: (args) => {
    const b = toBool(Array.isArray(args[0]) ? args[0][0][0] : (args[0] ?? false))
    return isError(b) ? b : !b
  },
  CONCAT: (args) => {
    const vals = flat(args)
    return vals.find(isError) ?? vals.map(toText).join('')
  },
  LEN: text((s) => s.length),
  UPPER: text((s) => s.toUpperCase()),
  LOWER: text((s) => s.toLowerCase()),
  TRIM: text((s) => s.trim().replace(/\s+/g, ' ')),
  LEFT: text((s, n = '1') => s.slice(0, Math.max(0, Number(n)))),
  RIGHT: text((s, n = '1') => (Number(n) > 0 ? s.slice(-Number(n)) : '')),
  MID: text((s, start, n) => s.substr(Math.max(0, Number(start) - 1), Math.max(0, Number(n)))),
  VLOOKUP: (args) => lookup(args, true),
  HLOOKUP: (args) => lookup(args, false)
}
FUNCTIONS.CONCATENATE = FUNCTIONS.CONCAT

/** The function names the editor can suggest. */
export const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort()

// ---------- working out ----------

function compare(op: string, a: Value, b: Value): Value {
  if (isError(a)) return a
  if (isError(b)) return b
  // Excel orders numbers before text before booleans, and compares text without case.
  const rank = (v: Value): number => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2)
  let d: number
  if (rank(a) !== rank(b)) {
    // A blank cell equals 0 and "".
    if (a === '' && typeof b === 'number') d = -b
    else if (b === '' && typeof a === 'number') d = a
    else d = rank(a) - rank(b)
  } else if (typeof a === 'string') d = a.toLowerCase().localeCompare((b as string).toLowerCase())
  else d = Number(a) - Number(b)
  return op === '=' ? d === 0 : op === '<>' ? d !== 0 : op === '<' ? d < 0 : op === '>' ? d > 0 : op === '<=' ? d <= 0 : d >= 0
}

function evaluate(node: Node, src: CellSource): Arg {
  switch (node.t) {
    case 'num':
    case 'str':
    case 'bool':
      return node.v
    case 'ref':
      return src.value(node.sheet, node.row, node.col)
    case 'range': {
      const size = src.size(node.sheet)
      if (!size) return err('#REF!')
      const r2 = node.r2 < 0 ? size.rows - 1 : Math.min(node.r2, Math.max(size.rows - 1, node.r1))
      const c2 = node.c2 < 0 ? size.cols - 1 : Math.min(node.c2, Math.max(size.cols - 1, node.c1))
      const grid: Grid = []
      for (let r = node.r1; r <= r2; r++) {
        const row: Value[] = []
        for (let c = node.c1; c <= c2; c++) row.push(src.value(node.sheet, r, c))
        grid.push(row)
      }
      return grid
    }
    case 'un': {
      const n = toNumber(single(evaluate(node.a, src)))
      return isError(n) ? n : node.op === '-' ? -n : n
    }
    case 'pct': {
      const n = toNumber(single(evaluate(node.a, src)))
      return isError(n) ? n : n / 100
    }
    case 'bin': {
      const a = single(evaluate(node.a, src))
      const b = single(evaluate(node.b, src))
      if (node.op === '&') return isError(a) ? a : isError(b) ? b : toText(a) + toText(b)
      if (PRECEDENCE[node.op] === 1) return compare(node.op, a, b)
      const x = toNumber(a)
      const y = toNumber(b)
      if (isError(x)) return x
      if (isError(y)) return y
      if (node.op === '+') return x + y
      if (node.op === '-') return x - y
      if (node.op === '*') return x * y
      if (node.op === '/') return y === 0 ? err('#DIV/0!') : x / y
      const p = x ** y
      return isFinite(p) ? p : err('#NUM!')
    }
    case 'call': {
      const fn = FUNCTIONS[node.name]
      if (!fn) return err('#NAME?')
      // IF and IFERROR only work out the branch they need, so a guarded #DIV/0! never shows.
      if (node.name === 'IF' && node.args.length) {
        const c = toBool(single(evaluate(node.args[0], src)))
        if (isError(c)) return c
        const pick = node.args[c ? 1 : 2]
        return pick ? single(evaluate(pick, src)) : c
      }
      return fn(node.args.map((a) => evaluate(a, src)))
    }
  }
}

/** A range used where one value is wanted gives its first cell. */
const single = (a: Arg): Value => (Array.isArray(a) ? (a.length === 1 && a[0].length === 1 ? a[0][0] : err('#VALUE!')) : a)

/** Works out `formula` (without its "="). Anything that won't parse gives #ERROR!. */
export function calculate(formula: string, src: CellSource): Value {
  let node: Node
  try {
    node = parseFormula(formula)
  } catch {
    return err('#ERROR!')
  }
  try {
    return single(evaluate(node, src))
  } catch {
    return err('#ERROR!')
  }
}

/**
 * Works out every formula in a workbook on demand. `input(sheet, row, col)` is what was typed in a cell
 * ("=..." for a formula); `plain` gives the value of a cell that isn't a formula. Results are kept until
 * `clear()`, so each cell is worked out once however many others point at it.
 */
export class Calculator {
  private cache = new Map<string, Value>()
  private busy = new Set<string>()

  constructor(
    private readonly sheets: () => string[],
    private readonly input: (sheet: number, row: number, col: number) => string,
    private readonly plain: (sheet: number, row: number, col: number) => Value,
    private readonly sizeOf: (sheet: number) => { rows: number; cols: number }
  ) {}

  clear(): void {
    this.cache.clear()
  }

  value(sheet: number, row: number, col: number): Value {
    const typed = this.input(sheet, row, col)
    if (!typed.startsWith('=') || typed.length < 2) return this.plain(sheet, row, col)
    const key = `${sheet}:${row}:${col}`
    const known = this.cache.get(key)
    if (known !== undefined) return known
    if (this.busy.has(key)) return err('#CYCLE!')
    this.busy.add(key)
    let result: Value
    try {
      result = calculate(typed.slice(1), {
        value: (name, r, c) => {
          const s = this.sheetIndex(name, sheet)
          return s < 0 ? err('#REF!') : this.value(s, r, c)
        },
        size: (name) => {
          const s = this.sheetIndex(name, sheet)
          return s < 0 ? null : this.sizeOf(s)
        }
      })
    } finally {
      this.busy.delete(key)
    }
    this.cache.set(key, result)
    return result
  }

  private sheetIndex(name: string | undefined, own: number): number {
    if (name === undefined) return own
    return this.sheets().findIndex((n) => n.toLowerCase() === name.toLowerCase())
  }
}
