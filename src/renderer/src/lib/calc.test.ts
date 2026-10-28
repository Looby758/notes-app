import { describe, expect, it } from 'vitest'
import { calcLine, calculate } from './calc'

describe('sums', () => {
  it('does arithmetic in the usual order', () => {
    expect(calculate('12 * 4.5')).toBe('54')
    expect(calculate('2 + 3 * 4')).toBe('14')
    expect(calculate('(2 + 3) * 4')).toBe('20')
    expect(calculate('2^10')).toBe('1,024')
    expect(calculate('-2^2')).toBe('-4')
    expect(calculate('10 / 4')).toBe('2.5')
    expect(calculate('6 × 7 ÷ 2')).toBe('21')
    expect(calculate('3 x 4')).toBe('12')
    expect(calculate('0.1 + 0.2')).toBe('0.3')
    expect(calculate('1/3')).toBe('0.333333')
    expect(calculate('1,200 * 3')).toBe('3,600')
    expect(calculate('10 mod 3')).toBe('1')
  })
  it('knows functions and constants', () => {
    expect(calculate('sqrt(16)')).toBe('4')
    expect(calculate('√9 + 1')).toBe('4')
    expect(calculate('round(pi, 2)')).toBe('3.14')
    expect(calculate('sin(30)')).toBe('0.5')
    expect(calculate('max(3, 9, 4)')).toBe('9')
    expect(calculate('log(1000)')).toBe('3')
  })
  it('works out percentages', () => {
    expect(calculate('15% of 80')).toBe('12')
    expect(calculate('20% off 50')).toBe('40')
    expect(calculate('80 + 10%')).toBe('88')
    expect(calculate('80 - 25%')).toBe('60')
    expect(calculate('200 * 5%')).toBe('10')
  })
  it('keeps money as money', () => {
    expect(calculate('£12.50 * 3')).toBe('£37.50')
    expect(calculate('$20 / 4')).toBe('$5')
    expect(calculate('$10 - $25')).toBe('-$15')
    expect(calculate('£5 + $5')).toBeNull()
  })
  it('stays quiet while a sum is unfinished or not a sum', () => {
    expect(calculate('12 *')).toBeNull()
    expect(calculate('(2 + 3')).toBeNull()
    expect(calculate('hello there')).toBeNull()
    expect(calculate('42')).toBeNull()
    expect(calculate('1 / 0')).toBeNull()
  })
})

describe('units', () => {
  it('converts', () => {
    expect(calculate('5 km in miles')).toBe('3.11 miles')
    expect(calculate('1 mile in km')).toBe('1.61 km')
    expect(calculate('100 f in c')).toBe('37.78°C')
    expect(calculate('20°C to fahrenheit')).toBe('68°F')
    expect(calculate('6 ft in cm')).toBe('182.88 cm')
    expect(calculate('12 in in cm')).toBe('30.48 cm')
    expect(calculate('10 stone in kg')).toBe('63.5 kg')
    expect(calculate('2 pints in litres')).toBe('1.14 litres')
    expect(calculate('70 mph in km/h')).toBe('112.65 km/h')
    expect(calculate('3 GB in MB')).toBe('3,000 MB')
    expect(calculate('1 acre in sq ft')).toBe('43,560 sq ft')
    expect(calculate('2 square metres in sq ft')).toBe('21.53 sq ft')
    expect(calculate('1 fl oz in ml')).toBe('28.41 ml')
    expect(calculate('1 kg in lb')).toBe('2.2 lb')
  })
  it('adds and scales measurements', () => {
    expect(calculate('2 hours + 45 min in minutes')).toBe('165 minutes')
    expect(calculate('1 km + 500 m')).toBe('1.5 km')
    expect(calculate('3 * 250 g')).toBe('750 g')
    expect(calculate('1 km / 250 m')).toBe('4')
    expect(calculate('10 km / 2 h')).toBe('5 km/h')
    expect(calculate('1 hour')).toBe('1 hour')
  })
  it("won't mix things that don't go together", () => {
    expect(calculate('5 km in kg')).toBeNull()
    expect(calculate('5 km + 3 kg')).toBeNull()
    expect(calculate('5 km in wombats')).toBeNull()
  })
})

describe('calculator lines', () => {
  it('starts with =', () => {
    expect(calcLine('= 12 * 4.5')).toEqual({ sum: '12 * 4.5', offset: 2 })
    expect(calcLine('=5+5')).toEqual({ sum: '5+5', offset: 1 })
    expect(calcLine('  = 1 + 1  ')).toEqual({ sum: '1 + 1', offset: 4 })
  })
  it('leaves other uses of = alone', () => {
    expect(calcLine('===')).toBeNull()
    expect(calcLine('==highlight==')).toBeNull()
    expect(calcLine('x = 5')).toBeNull()
    expect(calcLine('=')).toBeNull()
    expect(calcLine('= 1 + 1 =')).toBeNull()
  })
})
