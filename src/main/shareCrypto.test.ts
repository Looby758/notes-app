import { describe, expect, it } from 'vitest'
import { randomBytes } from 'crypto'
import { deriveKeys, frame, FrameReader, Line, newHandshake } from './shareCrypto'

function pairUp(secretA: Buffer | null, secretB: Buffer | null) {
  const a = newHandshake()
  const b = newHandshake()
  const ka = deriveKeys(a, b.publicKey, true, secretA)
  const kb = deriveKeys(b, a.publicKey, false, secretB)
  return { ka, kb }
}

describe('the secure line', () => {
  it('lets both ends talk, and shows the same pairing code on both', () => {
    const { ka, kb } = pairUp(null, null)
    expect(ka.transcript.equals(kb.transcript)).toBe(true)
    expect(ka.pairSecret.equals(kb.pairSecret)).toBe(true)
    const la = new Line(ka)
    const lb = new Line(kb)
    expect(lb.open(la.seal(Buffer.from('hello'))).toString()).toBe('hello')
    expect(la.open(lb.seal(Buffer.from('back'))).toString()).toBe('back')
    expect(lb.open(la.seal(Buffer.from('again'))).toString()).toBe('again')
  })

  it('only works with the same pairing secret', () => {
    const secret = randomBytes(32)
    const ok = pairUp(secret, secret)
    expect(new Line(ok.kb).open(new Line(ok.ka).seal(Buffer.from('x'))).toString()).toBe('x')
    const bad = pairUp(secret, randomBytes(32))
    expect(() => new Line(bad.kb).open(new Line(bad.ka).seal(Buffer.from('x')))).toThrow()
  })

  it('refuses a message that was replayed or changed', () => {
    const { ka, kb } = pairUp(null, null)
    const la = new Line(ka)
    const lb = new Line(kb)
    const sealed = la.seal(Buffer.from('click'))
    lb.open(sealed)
    expect(() => lb.open(sealed)).toThrow()
    const la2 = new Line(ka)
    const lb2 = new Line(kb)
    const tampered = la2.seal(Buffer.from('click'))
    tampered[0] ^= 1
    expect(() => lb2.open(tampered)).toThrow()
  })

  it('splits the byte stream back into frames', () => {
    const r = new FrameReader()
    const both = Buffer.concat([frame(Buffer.from('one')), frame(Buffer.from('two'))])
    expect(r.push(both.subarray(0, 5))).toEqual([])
    const out = r.push(both.subarray(5))
    expect(out.map((b) => b.toString())).toEqual(['one', 'two'])
  })
})
