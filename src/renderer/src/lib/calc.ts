/**
 * The inline calculator: a line that starts with "=" works out its answer.
 *   = 12 * 4.5            → 54
 *   = 15% of 80           → 12
 *   = 5 km in miles       → 3.11 miles
 *   = 2 hours + 45 min in minutes → 165 minutes
 *   = £12.50 * 3          → £37.50
 * Brackets, powers (^), square roots (sqrt or √), round/floor/ceil/abs/min/max, sin/cos/tan (in degrees),
 * log, ln, pi and e all work. Answers are only shown; the note's text never changes.
 */

// ---------- units ----------

interface Unit {
  dim: 'length' | 'mass' | 'volume' | 'time' | 'speed' | 'data' | 'area' | 'temperature'
  /** value in the base unit = (value + offset) * factor */
  factor: number
  offset?: number
  one: string
  many: string
}

const UNITS = new Map<string, Unit>()

function unit(names: string, dim: Unit['dim'], factor: number, one: string, many = one, offset = 0): void {
  const u: Unit = { dim, factor, offset, one, many }
  for (const n of names.split('|')) UNITS.set(n, u)
}

// Length (metres)
unit('mm|millimetre|millimetres|millimeter|millimeters', 'length', 0.001, 'mm')
unit('cm|centimetre|centimetres|centimeter|centimeters', 'length', 0.01, 'cm')
unit('m|metre|metres|meter|meters', 'length', 1, 'm')
unit('km|kilometre|kilometres|kilometer|kilometers', 'length', 1000, 'km')
unit('in|inch|inches', 'length', 0.0254, 'inch', 'inches')
unit('ft|foot|feet', 'length', 0.3048, 'foot', 'feet')
unit('yd|yard|yards', 'length', 0.9144, 'yard', 'yards')
unit('mi|mile|miles', 'length', 1609.344, 'mile', 'miles')
// Mass (kilograms)
unit('mg|milligram|milligrams', 'mass', 1e-6, 'mg')
unit('g|gram|grams|gramme|grammes', 'mass', 0.001, 'g')
unit('kg|kilo|kilos|kilogram|kilograms', 'mass', 1, 'kg')
unit('t|tonne|tonnes', 'mass', 1000, 'tonne', 'tonnes')
unit('oz|ounce|ounces', 'mass', 0.028349523125, 'oz')
unit('lb|lbs|pound|pounds', 'mass', 0.45359237, 'lb')
unit('st|stone|stones', 'mass', 6.35029318, 'stone')
// Volume (litres). Pints, gallons and fluid ounces are British (imperial); "us pint" etc. for American ones.
unit('ml|millilitre|millilitres|milliliter|milliliters', 'volume', 0.001, 'ml')
unit('cl|centilitre|centilitres|centiliter|centiliters', 'volume', 0.01, 'cl')
unit('l|litre|litres|liter|liters', 'volume', 1, 'litre', 'litres')
unit('tsp|teaspoon|teaspoons', 'volume', 0.005, 'tsp')
unit('tbsp|tablespoon|tablespoons', 'volume', 0.015, 'tbsp')
unit('cup|cups', 'volume', 0.25, 'cup', 'cups')
unit('us cup|us cups', 'volume', 0.2365882365, 'US cup', 'US cups')
unit('floz|fl oz|fluid ounce|fluid ounces', 'volume', 0.0284130625, 'fl oz')
unit('us fl oz|us fluid ounce|us fluid ounces', 'volume', 0.0295735295625, 'US fl oz')
unit('pt|pint|pints', 'volume', 0.56826125, 'pint', 'pints')
unit('us pint|us pints', 'volume', 0.473176473, 'US pint', 'US pints')
unit('gal|gallon|gallons', 'volume', 4.54609, 'gallon', 'gallons')
unit('us gal|us gallon|us gallons', 'volume', 3.785411784, 'US gallon', 'US gallons')
// Time (seconds)
unit('ms|millisecond|milliseconds', 'time', 0.001, 'ms')
unit('s|sec|secs|second|seconds', 'time', 1, 'second', 'seconds')
unit('min|mins|minute|minutes', 'time', 60, 'minute', 'minutes')
unit('h|hr|hrs|hour|hours', 'time', 3600, 'hour', 'hours')
unit('d|day|days', 'time', 86400, 'day', 'days')
unit('wk|wks|week|weeks', 'time', 604800, 'week', 'weeks')
unit('month|months', 'time', 2629800, 'month', 'months')
unit('yr|yrs|year|years', 'time', 31557600, 'year', 'years')
// Speed (metres per second)
unit('m/s', 'speed', 1, 'm/s')
unit('km/h|kph|kmh', 'speed', 1 / 3.6, 'km/h')
unit('mph|mi/h', 'speed', 0.44704, 'mph')
unit('knot|knots|kn', 'speed', 0.514444, 'knot', 'knots')
// File sizes (bytes)
unit('b|byte|bytes', 'data', 1, 'byte', 'bytes')
unit('kb|kilobyte|kilobytes', 'data', 1e3, 'KB')
unit('mb|megabyte|megabytes', 'data', 1e6, 'MB')
unit('gb|gigabyte|gigabytes', 'data', 1e9, 'GB')
unit('tb|terabyte|terabytes', 'data', 1e12, 'TB')
// Area (square metres)
unit('m2|m²|sq m|sqm|square metre|square metres|square meter|square meters', 'area', 1, 'm²')
unit('km2|km²|sq km|square kilometre|square kilometres|square kilometer|square kilometers', 'area', 1e6, 'km²')
unit('ft2|ft²|sq ft|sqft|square foot|square feet', 'area', 0.09290304, 'sq ft')
unit('acre|acres', 'area', 4046.8564224, 'acre', 'acres')
unit('ha|hectare|hectares', 'area', 10000, 'hectare', 'hectares')
// Temperature (kelvin)
unit('c|°c|celsius|centigrade', 'temperature', 1, '°C', '°C', 273.15)
unit('f|°f|fahrenheit', 'temperature', 5 / 9, '°F', '°F', 459.67)
unit('k|kelvin', 'temperature', 1, 'K')

const findUnit = (name: string): Unit | undefined => UNITS.get(name.toLowerCase())

// ---------- reading the sum ----------

type Token = { kind: 'num'; value: number } | { kind: 'word'; text: string } | { kind: 'op'; text: string }

const WORD = /[A-Za-z_°²µ][A-Za-z0-9_°²]*/y
const NUMBER = /(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:e[-+]?\d+)?/iy

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[\d.]/.test(c)) {
      NUMBER.lastIndex = i
      const m = NUMBER.exec(src)
      if (!m || !m[0] || m[0] === '.') throw new Error('number')
      out.push({ kind: 'num', value: parseFloat(m[0].replace(/,/g, '')) })
      i += m[0].length
      continue
    }
    WORD.lastIndex = i
    const w = WORD.exec(src)
    if (w) {
      let text = w[0]
      i += text.length
      // Units written with a slash, like km/h and m/s.
      const slash = /^\/([A-Za-z]+)/.exec(src.slice(i))
      if (slash && findUnit(`${text}/${slash[1]}`)) {
        text = `${text}/${slash[1]}`
        i += slash[0].length
      }
      out.push({ kind: 'word', text })
      continue
    }
    if ('+-*/×÷^%(),√−'.includes(c)) {
      out.push({ kind: 'op', text: c === '×' ? '*' : c === '÷' ? '/' : c === '−' ? '-' : c })
      i++
      continue
    }
    throw new Error(`unexpected ${c}`)
  }
  return out
}

interface Value {
  n: number
  unit?: Unit
  /** Written as a percentage, so "80 + 10%" can mean 88. */
  pct?: boolean
}

const toBase = (n: number, u: Unit): number => (n + (u.offset ?? 0)) * u.factor
const fromBase = (n: number, u: Unit): number => n / u.factor - (u.offset ?? 0)

function convert(v: Value, to: Unit): Value {
  if (!v.unit) return { n: v.n, unit: to }
  if (v.unit.dim !== to.dim) throw new Error(`can't turn ${v.unit.many} into ${to.many}`)
  return { n: fromBase(toBase(v.n, v.unit), to), unit: to }
}

const plain = (v: Value): number => {
  if (v.unit) throw new Error('needs a plain number')
  return v.pct ? v.n / 100 : v.n
}

const DEG = Math.PI / 180

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  sqrt: ([x]) => Math.sqrt(x),
  cbrt: ([x]) => Math.cbrt(x),
  abs: ([x]) => Math.abs(x),
  round: ([x, d = 0]) => Math.round(x * 10 ** d) / 10 ** d,
  floor: ([x]) => Math.floor(x),
  ceil: ([x]) => Math.ceil(x),
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
  sin: ([x]) => Math.sin(x * DEG),
  cos: ([x]) => Math.cos(x * DEG),
  tan: ([x]) => Math.tan(x * DEG),
  log: ([x]) => Math.log10(x),
  ln: ([x]) => Math.log(x)
}
/** These keep the unit they're given: round(5 km in miles) is still in miles. */
const KEEPS_UNIT = new Set(['abs', 'round', 'floor', 'ceil'])

const CONVERT_WORDS = new Set(['in', 'to', 'as', 'into'])

class Parser {
  private i = 0
  constructor(private readonly t: Token[]) {}

  private peek(offset = 0): Token | undefined {
    return this.t[this.i + offset]
  }
  private isOp(text: string, offset = 0): boolean {
    const tok = this.peek(offset)
    return tok?.kind === 'op' && tok.text === text
  }
  private isWord(text: string, offset = 0): boolean {
    const tok = this.peek(offset)
    return tok?.kind === 'word' && tok.text.toLowerCase() === text
  }
  private expect(text: string): void {
    if (!this.isOp(text)) throw new Error(`expected ${text}`)
    this.i++
  }

  parse(): Value {
    let v = this.sum()
    // "... in miles"
    const tok = this.peek()
    if (tok?.kind === 'word' && CONVERT_WORDS.has(tok.text.toLowerCase())) {
      this.i++
      const to = this.unitName()
      if (!to) throw new Error('unknown unit')
      v = convert(v, to)
    }
    if (this.i < this.t.length) throw new Error('unexpected text')
    return v
  }

  /** A unit's name (one or two words, like "fl oz" or "square feet"), if one comes next. */
  private unitName(): Unit | undefined {
    const a = this.peek()
    if (a?.kind !== 'word') return undefined
    const b = this.peek(1)
    if (b?.kind === 'word') {
      const two = findUnit(`${a.text} ${b.text}`)
      if (two) {
        this.i += 2
        return two
      }
      const three = this.peek(2)
      if (three?.kind === 'word') {
        const u = findUnit(`${a.text} ${b.text} ${three.text}`)
        if (u) {
          this.i += 3
          return u
        }
      }
    }
    // "in" straight after a number is inches only when nothing could follow it as a conversion.
    if (a.text.toLowerCase() === 'in' && this.peek(1) && !(b?.kind === 'word' && CONVERT_WORDS.has(b.text.toLowerCase()))) return undefined
    const u = findUnit(a.text)
    if (u) this.i++
    return u
  }

  private sum(): Value {
    let left = this.term()
    while (this.isOp('+') || this.isOp('-')) {
      const sub = this.isOp('-')
      this.i++
      const right = this.term()
      left = sub ? subtract(left, right) : add(left, right)
    }
    return left
  }

  private term(): Value {
    let left = this.unary()
    for (;;) {
      if (this.isOp('*') || this.isWord('x') || this.isWord('times')) {
        this.i++
        left = multiply(left, this.unary())
      } else if (this.isOp('/')) {
        this.i++
        left = divide(left, this.unary())
      } else if (this.isWord('of') && left.pct) {
        // 15% of 80
        this.i++
        left = multiply({ n: left.n / 100 }, this.unary())
      } else if (this.isWord('off') && left.pct) {
        // 20% off 50
        this.i++
        const right = this.unary()
        left = { ...right, n: right.n * (1 - left.n / 100) }
      } else if (this.isWord('mod')) {
        this.i++
        const right = this.unary()
        left = { ...left, n: left.n % plain(right), pct: false }
      } else return left
    }
  }

  private unary(): Value {
    if (this.isOp('-')) {
      this.i++
      const v = this.unary()
      return { ...v, n: -v.n }
    }
    if (this.isOp('+')) {
      this.i++
      return this.unary()
    }
    if (this.isOp('√')) {
      this.i++
      return { n: Math.sqrt(plain(this.unary())) }
    }
    return this.power()
  }

  private power(): Value {
    const base = this.postfix()
    if (!this.isOp('^')) return base
    this.i++
    const exp = plain(this.unary())
    return { n: plain(base) ** exp }
  }

  private postfix(): Value {
    let v = this.primary()
    if (this.isOp('%')) {
      this.i++
      v = { n: v.n, pct: true }
    }
    if (!v.unit && !v.pct) {
      const u = this.unitName()
      if (u) v = { n: v.n, unit: u }
    }
    return v
  }

  private primary(): Value {
    const tok = this.peek()
    if (!tok) throw new Error('unfinished')
    if (tok.kind === 'num') {
      this.i++
      return { n: tok.value }
    }
    if (tok.kind === 'op' && tok.text === '(') {
      this.i++
      const v = this.sum()
      this.expect(')')
      return v
    }
    if (tok.kind === 'word') {
      const name = tok.text.toLowerCase()
      if (name === 'pi' || name === 'π') {
        this.i++
        return { n: Math.PI }
      }
      if (name === 'e' && !this.isOp('(', 1)) {
        this.i++
        return { n: Math.E }
      }
      const fn = FUNCTIONS[name]
      if (fn && this.isOp('(', 1)) {
        this.i += 2
        const args = [this.sum()]
        while (this.isOp(',')) {
          this.i++
          args.push(this.sum())
        }
        this.expect(')')
        const u = KEEPS_UNIT.has(name) ? args[0].unit : undefined
        const n = fn(args.map((a, k) => (k === 0 && u ? a.n : plain(a))))
        return u ? { n, unit: u } : { n }
      }
    }
    throw new Error('unexpected')
  }
}

function add(a: Value, b: Value): Value {
  if (b.pct && !a.pct) return { ...a, n: a.n * (1 + b.n / 100) }
  if (a.pct && b.pct) return { n: a.n + b.n, pct: true }
  if (a.unit && b.unit) return { n: a.n + convert(b, a.unit).n, unit: a.unit }
  // A plain number added to a measurement counts in its unit: 5 km + 3 is 8 km.
  if (a.unit) return { n: a.n + plain(b), unit: a.unit }
  if (b.unit) return { n: plain(a) + b.n, unit: b.unit }
  return { n: plain(a) + plain(b) }
}

function subtract(a: Value, b: Value): Value {
  if (b.pct && !a.pct) return { ...a, n: a.n * (1 - b.n / 100) }
  return add(a, { ...b, n: -b.n })
}

function multiply(a: Value, b: Value): Value {
  if (a.unit && b.unit) throw new Error("can't multiply two units")
  if (a.pct && b.pct) return { n: (a.n * b.n) / 100, pct: true }
  const unit = a.unit ?? b.unit
  const n = (a.unit ? a.n : plain(a)) * (b.unit ? b.n : plain(b))
  return unit ? { n, unit } : { n }
}

function divide(a: Value, b: Value): Value {
  if (a.unit && b.unit) {
    // 10 km / 2 h is a speed; 1 km / 250 m is a plain number.
    if (a.unit.dim === 'length' && b.unit.dim === 'time') {
      const ms = toBase(a.n, a.unit) / toBase(b.n, b.unit)
      const speed = a.unit.one === 'mile' ? findUnit('mph')! : a.unit.one === 'm' ? findUnit('m/s')! : findUnit('km/h')!
      return { n: fromBase(ms, speed), unit: speed }
    }
    return { n: a.n / convert(b, a.unit).n }
  }
  if (b.unit) throw new Error("can't divide by a unit")
  return a.unit ? { n: a.n / plain(b), unit: a.unit } : { n: plain(a) / plain(b) }
}

// ---------- showing the answer ----------

const CURRENCY = /[$£€¥₹]/g

function formatNumber(n: number, maxDecimals: number, minDecimals = 0): string {
  // Tidy floating-point noise first (0.1 + 0.2 is 0.3).
  const tidy = Number(n.toPrecision(12))
  const abs = Math.abs(tidy)
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) return tidy.toExponential(4).replace(/\.?0+e/, 'e')
  // Small numbers keep enough decimals to show their first few significant digits.
  const decimals = abs !== 0 && abs < 1 ? Math.max(maxDecimals, Math.min(10, 1 - Math.floor(Math.log10(abs)) + 2)) : maxDecimals
  return tidy.toLocaleString('en-GB', { maximumFractionDigits: decimals, minimumFractionDigits: Math.min(minDecimals, decimals) })
}

/** The answer to a sum (without the "="), or null if it isn't a sum that can be worked out yet. */
export function calculate(input: string): string | null {
  const currencies = new Set(input.match(CURRENCY) ?? [])
  if (currencies.size > 1) return null
  const money = [...currencies][0]
  const src = input.replace(CURRENCY, '').trim()
  // Just a number on its own needs no answer.
  if (!src || /^[-+]?[\d.,]+$/.test(src)) return null
  let v: Value
  try {
    v = new Parser(tokenize(src)).parse()
  } catch {
    return null
  }
  if (!Number.isFinite(v.n)) return null
  if (money && !v.unit) {
    const s = formatNumber(Math.abs(v.n), 2, Number.isInteger(Number(v.n.toPrecision(12))) ? 0 : 2)
    return `${v.n < 0 ? '-' : ''}${money}${s}`
  }
  if (v.pct) return `${formatNumber(v.n, 6)}%`
  if (!v.unit) return formatNumber(v.n, 6)
  const s = formatNumber(v.n, 2)
  const name = Math.abs(Number(s.replace(/,/g, ''))) === 1 ? v.unit.one : v.unit.many
  return /^[°]/.test(name) ? `${s}${name}` : `${s} ${name}`
}

/** A calculator line: "=" at the start (but not "==" for highlights or "===" under a heading). */
const CALC_LINE = /^(\s*=)(?!=)\s*(.*\S)\s*$/

/** The sum on a line, and where it starts, if the line is a calculator line. */
export function calcLine(text: string): { sum: string; offset: number } | null {
  const m = CALC_LINE.exec(text)
  if (!m || m[2].endsWith('=')) return null
  return { sum: m[2], offset: text.indexOf(m[2], m[1].length) }
}
