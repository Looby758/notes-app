import { create } from 'zustand'
import {
  createLock,
  isLockedText,
  lockedHeader,
  lockWithNotesKey,
  lockWithOwnKey,
  ownKeyFrom,
  relock,
  unlockNote,
  unlockWithPassword,
  unlockWithRecovery,
  type Bytes,
  type LockFile,
  type OwnKey
} from './crypto'
import { usePrefs } from '../../store/prefs'

/**
 * Locked notes while the app runs: which notes are locked, and the keys you've unlocked with.
 * Keys only ever live in memory; "Lock now", the auto-lock timer, or quitting forgets them.
 */

const FILE = 'lock.json'

interface LockState {
  /** A notes password has been set up (lock.json exists). */
  setUp: boolean
  /** The notes password has been entered this session. */
  unlocked: boolean
  /** Notes known to be locked, and how. */
  locked: Record<string, 'vault' | 'own'>
  /** Notes with their own password that are unlocked right now. */
  ownOpen: string[]
  /** Bumped whenever something is unlocked or locked again. */
  version: number
}

export const useLock = create<LockState>(() => ({ setUp: false, unlocked: false, locked: {}, ownOpen: [], version: 0 }))

let lockFile: LockFile | null = null
let notesKey: Bytes | null = null
const ownKeys = new Map<string, OwnKey>()

const bump = (extra: Partial<LockState> = {}): void =>
  useLock.setState((s) => ({ ...extra, ownOpen: [...ownKeys.keys()], version: s.version + 1 }))

/** Call when a notes folder opens: reads its lock settings and forgets any keys. */
export async function loadLock(): Promise<void> {
  notesKey = null
  ownKeys.clear()
  lockFile = null
  try {
    const raw = await window.api.readAppData(FILE)
    if (raw) lockFile = JSON.parse(raw) as LockFile
  } catch {
    lockFile = null
  }
  bump({ setUp: !!lockFile, unlocked: false, locked: {} })
}

// ---------- which notes are locked ----------

/** Records whether a note's file (as read from disk) is locked. */
export function noteLockState(path: string, raw: string): void {
  const header = isLockedText(raw) ? lockedHeader(raw) : null
  const now = useLock.getState().locked[path]
  const next = header?.mode
  if (now === next) return
  useLock.setState((s) => {
    const locked = { ...s.locked }
    if (next) locked[path] = next
    else delete locked[path]
    return { locked }
  })
}

export function forgetLockState(path: string): void {
  if (!(path in useLock.getState().locked)) return
  ownKeys.delete(path)
  useLock.setState((s) => {
    const { [path]: _gone, ...locked } = s.locked
    return { locked, ownOpen: [...ownKeys.keys()] }
  })
}

export const isLocked = (path: string): boolean => path in useLock.getState().locked

/** Locked and not yet unlocked (what the lock screen shows for). */
export function needsUnlock(path: string, s: LockState = useLock.getState()): boolean {
  const mode = s.locked[path]
  if (!mode) return false
  return mode === 'vault' ? !s.unlocked : !s.ownOpen.includes(path)
}

// ---------- reading and writing locked notes ----------

/** How an open locked note is saved again. */
export type NoteLock = { mode: 'vault' } | { mode: 'own' }

export type Opened = { text: string; lock?: NoteLock } | 'locked'

/** A note's text as read from disk, unlocked if need be ('locked' if its key isn't available). */
export async function openText(path: string, raw: string): Promise<Opened> {
  noteLockState(path, raw)
  const header = isLockedText(raw) ? lockedHeader(raw) : null
  if (!header) return { text: raw }
  const key = header.mode === 'vault' ? notesKey : ownKeys.get(path)?.key
  if (!key) return 'locked'
  return { text: await unlockNote(raw, key), lock: { mode: header.mode } }
}

/** What to write to disk for a note's text. */
export async function sealText(path: string, text: string, lock: NoteLock | undefined): Promise<string> {
  if (!lock) return text
  if (lock.mode === 'vault') {
    if (!notesKey) throw new Error('Your notes are locked again; unlock them to save.')
    return lockWithNotesKey(text, notesKey)
  }
  const own = ownKeys.get(path)
  if (!own) throw new Error('This note is locked again; unlock it to save.')
  return lockWithOwnKey(text, own)
}

/** After a rename, an unlocked note with its own password keeps its key. */
export function remapLock(from: string, to: string): void {
  const own = ownKeys.get(from)
  if (own) {
    ownKeys.delete(from)
    ownKeys.set(to, own)
  }
  const mode = useLock.getState().locked[from]
  if (!mode) return
  useLock.setState((s) => {
    const { [from]: _old, ...locked } = s.locked
    return { locked: { ...locked, [to]: mode }, ownOpen: [...ownKeys.keys()] }
  })
}

// ---------- the notes password ----------

/** Sets up the notes password. Returns the recovery key, if one was asked for. */
export async function setUpPassword(password: string, withRecovery: boolean): Promise<string | undefined> {
  // Replacing an existing key file would leave every locked note unreadable for good.
  if (lockFile || (await window.api.readAppData(FILE)) !== null)
    throw new Error('A notes password already exists in this notes folder. Close Orbit and open it again to use it.')
  const made = await createLock(password, withRecovery)
  await window.api.writeAppData(FILE, JSON.stringify(made.lock, null, 2))
  lockFile = made.lock
  notesKey = made.notesKey
  bump({ setUp: true, unlocked: true })
  touch()
  return made.recoveryKey
}

export async function unlockNotes(password: string): Promise<void> {
  if (!lockFile) throw new Error('No notes password has been set up yet.')
  notesKey = await unlockWithPassword(lockFile, password)
  bump({ unlocked: true })
  touch()
}

/** "Forgot password": unlocks with the recovery key, then you choose a new password. */
export async function unlockWithRecoveryKey(recoveryKey: string): Promise<void> {
  if (!lockFile) throw new Error('No notes password has been set up yet.')
  notesKey = await unlockWithRecovery(lockFile, recoveryKey)
  bump({ unlocked: true })
  touch()
}

export const hasRecoveryKey = (): boolean => !!lockFile?.byRecovery

/** Changes the notes password (while unlocked). Locked notes don't need rewriting. */
export async function changePassword(password: string): Promise<void> {
  if (!notesKey || !lockFile) throw new Error('Unlock your notes first.')
  const next = await relock(notesKey, password, lockFile)
  await window.api.writeAppData(FILE, JSON.stringify(next, null, 2))
  lockFile = next
}

/** Checks the notes password without changing anything. */
export async function checkPassword(password: string): Promise<boolean> {
  if (!lockFile) return false
  try {
    await unlockWithPassword(lockFile, password)
    return true
  } catch {
    return false
  }
}

// ---------- a note's own password ----------

/** Unlocks a note that has its own password (`raw` is its file). */
export async function unlockOwn(path: string, raw: string, password: string): Promise<void> {
  const header = lockedHeader(raw)
  if (header?.mode !== 'own') throw new Error('This note doesn’t have its own password.')
  const own = await ownKeyFrom(password, header.salt, header.iterations)
  await unlockNote(raw, own.key) // throws WrongPassword
  ownKeys.set(path, own)
  bump()
  touch()
}

/** Gives an open note its own password (used when locking it that way). */
export async function setOwnPassword(path: string, password: string): Promise<void> {
  ownKeys.set(path, await ownKeyFrom(password))
  bump()
  touch()
}

// ---------- locking again ----------

let beforeLock: () => Promise<void> = async () => undefined

/** The editor registers how to save and close locked notes before keys are forgotten. */
export function onBeforeLock(fn: () => Promise<void>): void {
  beforeLock = fn
}

const anythingUnlocked = (): boolean => !!notesKey || ownKeys.size > 0

/** Locks every locked note again (they stay locked on disk; this forgets the keys). */
export async function lockNow(): Promise<void> {
  if (!anythingUnlocked()) return
  await beforeLock()
  notesKey = null
  ownKeys.clear()
  bump({ unlocked: false })
}

// Auto-lock after a while without using the app.
let lastActive = Date.now()
const touch = (): void => {
  lastActive = Date.now()
}
if (typeof window !== 'undefined') {
  for (const ev of ['keydown', 'mousedown', 'wheel'] as const) window.addEventListener(ev, touch, { capture: true, passive: true })
  setInterval(() => {
    const minutes = usePrefs.getState().prefs.autoLockMinutes
    if (minutes > 0 && anythingUnlocked() && Date.now() - lastActive > minutes * 60_000) void lockNow()
  }, 15_000)
}
