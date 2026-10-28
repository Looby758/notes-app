/**
 * Making strong random passwords, and a rough idea of how strong one is.
 *
 * Every character comes from the system's secure random numbers, picked without bias
 * (a plain "random % n" would make some characters a little more likely than others).
 */

export interface GenerateOptions {
  length: number
  lower: boolean
  upper: boolean
  digits: boolean
  symbols: boolean
  /** Leave out characters that are easy to mix up: 0/O, 1/l/I. */
  noLookalikes: boolean
}

export const DEFAULT_OPTIONS: GenerateOptions = { length: 20, lower: true, upper: true, digits: true, symbols: true, noLookalikes: false }
export const MIN_LENGTH = 8
export const MAX_LENGTH = 64

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/~'
} as const
const LOOKALIKES = /[0O1lI]/g

/** The character groups the options turn on (always at least lowercase letters). */
function groups(o: GenerateOptions): string[] {
  const keys = (['lower', 'upper', 'digits', 'symbols'] as const).filter((k) => o[k])
  const chosen = (keys.length ? keys : (['lower'] as const)).map((k) => SETS[k])
  return o.noLookalikes ? chosen.map((g) => g.replace(LOOKALIKES, '')) : chosen
}

/** A random whole number from 0 to n - 1, with no bias. */
export function randomBelow(n: number, random: (buf: Uint32Array) => Uint32Array = (b) => globalThis.crypto.getRandomValues(b)): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n
  const buf = new Uint32Array(1)
  for (;;) {
    const x = random(buf)[0]
    if (x < limit) return x % n
  }
}

/** A random password using every group that's switched on at least once. */
export function generatePassword(options: GenerateOptions = DEFAULT_OPTIONS): string {
  const length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(options.length)))
  const sets = groups(options)
  const pool = sets.join('')
  for (;;) {
    let out = ''
    for (let i = 0; i < length; i++) out += pool[randomBelow(pool.length)]
    // Try again until each group appears (keeps every valid password equally likely).
    if (sets.every((set) => [...out].some((c) => set.includes(c)))) return out
  }
}

/** How many bits of randomness a generated password with these options has. */
export function generatedBits(options: GenerateOptions): number {
  const pool = groups(options).join('').length
  return Math.round(options.length * Math.log2(pool))
}

export type Strength = 'weak' | 'okay' | 'strong' | 'very strong'

/**
 * A rough guess at how hard a password you typed would be to guess. It can't know if it's
 * a common word or one you've used elsewhere, so it only judges length and variety.
 */
export function estimateStrength(password: string): { bits: number; label: Strength } {
  let pool = 0
  if (/[a-z]/.test(password)) pool += 26
  if (/[A-Z]/.test(password)) pool += 26
  if (/[0-9]/.test(password)) pool += 10
  if (/[^a-zA-Z0-9]/.test(password)) pool += 33
  // Repeated characters ("aaaa", "1111") add almost nothing.
  const unique = new Set(password).size
  const effective = Math.min(password.length, unique * 2)
  const bits = pool ? Math.round(effective * Math.log2(pool)) : 0
  return { bits, label: strengthLabel(bits) }
}

export function strengthLabel(bits: number): Strength {
  if (bits < 45) return 'weak'
  if (bits < 65) return 'okay'
  if (bits < 100) return 'strong'
  return 'very strong'
}
