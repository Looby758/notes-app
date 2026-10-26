import { describe, expect, it } from 'vitest'
import {
  createLock,
  isLockedText,
  lockedHeader,
  lockWithNotesKey,
  lockWithOwnKey,
  makeRecoveryKey,
  ownKeyFrom,
  relock,
  unlockNote,
  unlockWithPassword,
  unlockWithRecovery,
  WrongPassword
} from './crypto'

const text = '# Diary\n\nSecret things. ✨ Ünïcödé.\n'

describe('the notes password', () => {
  it('locks and unlocks a note; the file shows nothing of the text', async () => {
    const { lock, notesKey, recoveryKey } = await createLock('correct horse', true)
    const file = await lockWithNotesKey(text, notesKey)
    expect(isLockedText(file)).toBe(true)
    expect(file).not.toContain('Secret')
    expect(file.startsWith('---\nlocked: true\n---\n')).toBe(true)
    const key = await unlockWithPassword(lock, 'correct horse')
    expect(await unlockNote(file, key)).toBe(text)
    // The recovery key opens it too (spaces, dashes and case don't matter).
    const viaRecovery = await unlockWithRecovery(lock, recoveryKey!.toLowerCase().replace(/-/g, ' '))
    expect(await unlockNote(file, viaRecovery)).toBe(text)
  }, 30_000)

  it('refuses a wrong password', async () => {
    const { lock } = await createLock('right one', false)
    await expect(unlockWithPassword(lock, 'wrong one')).rejects.toBeInstanceOf(WrongPassword)
    await expect(unlockWithRecovery(lock, 'AAAAA')).rejects.toThrow(/No recovery key/)
  }, 30_000)

  it('can change the password and keep the recovery key', async () => {
    const { lock, notesKey, recoveryKey } = await createLock('old', true)
    const changed = await relock(notesKey, 'new', lock)
    await expect(unlockWithPassword(changed, 'old')).rejects.toBeInstanceOf(WrongPassword)
    expect(await unlockWithPassword(changed, 'new')).toEqual(notesKey)
    expect(await unlockWithRecovery(changed, recoveryKey!)).toEqual(notesKey)
  }, 30_000)

  it('makes recovery keys in five groups', () => {
    expect(makeRecoveryKey()).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){4}$/)
  })
})

describe('a note with its own password', () => {
  it('locks with its own key', async () => {
    const own = await ownKeyFrom('just this one')
    const file = await lockWithOwnKey(text, own)
    const header = lockedHeader(file)!
    expect(header.mode).toBe('own')
    const again = await ownKeyFrom('just this one', header.salt, header.iterations)
    expect(await unlockNote(file, again.key)).toBe(text)
    const wrong = await ownKeyFrom('nope', header.salt, header.iterations)
    await expect(unlockNote(file, wrong.key)).rejects.toBeInstanceOf(WrongPassword)
  }, 30_000)
})
