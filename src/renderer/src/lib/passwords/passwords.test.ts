import { describe, expect, it } from 'vitest'
import { DEFAULT_OPTIONS, estimateStrength, generatedBits, generatePassword, randomBelow } from './generate'
import { mergeLogins, reusedPasswords, searchLogins, siteLink, siteName, tombstone, type Login } from './entries'
import { createLock, decryptText, encryptText, relock, unlockWithPassword, unlockWithRecovery, WrongPassword } from '../lock/crypto'

const login = (id: string, patch: Partial<Login> = {}): Login => ({
  id,
  title: id,
  username: '',
  password: '',
  url: '',
  notes: '',
  created: 1,
  updated: 1,
  ...patch
})

describe('making passwords', () => {
  it('uses the length asked for and every kind of character switched on', () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword({ ...DEFAULT_OPTIONS, length: 12 })
      expect(p).toHaveLength(12)
      expect(p).toMatch(/[a-z]/)
      expect(p).toMatch(/[A-Z]/)
      expect(p).toMatch(/[0-9]/)
      expect(p).toMatch(/[^a-zA-Z0-9]/)
    }
  })

  it('leaves out what is switched off, and look-alikes when asked', () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword({ length: 30, lower: true, upper: true, digits: true, symbols: false, noLookalikes: true })
      expect(p).toMatch(/^[a-zA-Z0-9]+$/)
      expect(p).not.toMatch(/[0O1lI]/)
    }
  })

  it('keeps the length within limits', () => {
    expect(generatePassword({ ...DEFAULT_OPTIONS, length: 2 })).toHaveLength(8)
    expect(generatePassword({ ...DEFAULT_OPTIONS, length: 500 })).toHaveLength(64)
  })

  it('makes different passwords each time', () => {
    const seen = new Set(Array.from({ length: 100 }, () => generatePassword()))
    expect(seen.size).toBe(100)
  })

  it('picks numbers without bias (throws away values past the last full round)', () => {
    // 2^32 isn't a multiple of 3, so the highest value must be rejected and the next one used.
    const values = [0xffffffff, 7]
    const fake = (b: Uint32Array): Uint32Array => {
      b[0] = values.shift()!
      return b
    }
    expect(randomBelow(3, fake)).toBe(7 % 3)
    expect(values).toHaveLength(0)
  })

  it('rates strength sensibly', () => {
    expect(generatedBits(DEFAULT_OPTIONS)).toBeGreaterThan(100)
    expect(estimateStrength('password').label).toBe('weak')
    expect(estimateStrength('aaaaaaaaaaaaaaaa').label).toBe('weak')
    expect(estimateStrength('tulip ladder orbit seven').label).not.toBe('weak')
  })
})

describe('saved logins', () => {
  it('searches names, usernames, websites and notes, but never passwords', () => {
    const all = [
      login('Netflix', { username: 'me@mail.com', password: 'hunter2' }),
      login('Bank', { url: 'mybank.com', notes: 'joint account' }),
      tombstone('gone')
    ]
    expect(searchLogins(all, 'net').map((l) => l.id)).toEqual(['Netflix'])
    expect(searchLogins(all, 'mail').map((l) => l.id)).toEqual(['Netflix'])
    expect(searchLogins(all, 'joint bank').map((l) => l.id)).toEqual(['Bank'])
    expect(searchLogins(all, 'hunter2')).toEqual([])
    expect(searchLogins(all, '').map((l) => l.id)).toEqual(['Bank', 'Netflix'])
  })

  it('combines two copies: the newest edit of each wins, deletes stick', () => {
    const mine = [login('a', { password: 'new', updated: 5 }), login('b', { updated: 2 }), login('c')]
    const theirs = [login('a', { password: 'old', updated: 3 }), tombstone('b', 4), login('d')]
    const merged = mergeLogins(mine, theirs, 10)
    expect(merged.find((l) => l.id === 'a')!.password).toBe('new')
    expect(merged.find((l) => l.id === 'b')!.deleted).toBe(true)
    expect(merged.map((l) => l.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('forgets old delete marks', () => {
    expect(mergeLogins([tombstone('x', 0)], [], 200 * 24 * 60 * 60 * 1000)).toEqual([])
  })

  it('a deleted login keeps nothing secret', () => {
    const t = tombstone('x')
    expect(t.password).toBe('')
    expect(t.username).toBe('')
  })

  it('spots passwords used more than once', () => {
    const r = reusedPasswords([login('a', { password: 'same' }), login('b', { password: 'same' }), login('c', { password: 'other' }), login('d')])
    expect([...r].sort()).toEqual(['a', 'b'])
  })

  it('only links to web addresses', () => {
    expect(siteName('https://www.netflix.com/login')).toBe('netflix.com')
    expect(siteLink('netflix.com')).toBe('https://netflix.com/')
    expect(siteLink('javascript:alert(1)')).toBeNull()
    expect(siteLink('file:///etc/passwd')).toBeNull()
  })
})

describe('the vault key', () => {
  it('encrypts the list so none of it shows, and only the right key opens it', async () => {
    const { lock, notesKey: key, recoveryKey } = await createLock('tulip ladder orbit', true)
    const text = JSON.stringify([login('Netflix', { password: 'hunter2' })])
    const sealed = await encryptText(key, text)
    expect(JSON.stringify(sealed)).not.toContain('hunter2')
    expect(JSON.stringify(sealed)).not.toContain('Netflix')
    expect(await decryptText(await unlockWithPassword(lock, 'tulip ladder orbit'), sealed)).toBe(text)
    expect(await decryptText(await unlockWithRecovery(lock, recoveryKey!), sealed)).toBe(text)
    await expect(unlockWithPassword(lock, 'wrong')).rejects.toBeInstanceOf(WrongPassword)
    await expect(decryptText(new Uint8Array(32), sealed)).rejects.toBeInstanceOf(WrongPassword)
  }, 30_000)

  it('notices if the file was tampered with', async () => {
    const { notesKey: key } = await createLock('pw', false)
    const sealed = await encryptText(key, 'secret')
    const bytes = Uint8Array.from(atob(sealed.data), (c) => c.charCodeAt(0))
    bytes[0] ^= 1
    const tampered = { ...sealed, data: btoa(String.fromCharCode(...bytes)) }
    await expect(decryptText(key, tampered)).rejects.toBeInstanceOf(WrongPassword)
  }, 30_000)

  it('a new master password opens the same list', async () => {
    const { lock, notesKey: key } = await createLock('first one', false)
    const sealed = await encryptText(key, 'list')
    const next = await relock(key, 'second one', lock)
    expect(await decryptText(await unlockWithPassword(next, 'second one'), sealed)).toBe('list')
    await expect(unlockWithPassword(next, 'first one')).rejects.toBeInstanceOf(WrongPassword)
  }, 30_000)
})
