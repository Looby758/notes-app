import { create } from 'zustand'
import {
  createLock,
  decryptText,
  encryptText,
  relock,
  unlockWithPassword,
  unlockWithRecovery,
  WrongPassword,
  type Bytes,
  type LockFile,
  type Sealed
} from '../lock/crypto'
import { mergeLogins, tombstone, type Login } from './entries'
import { usePrefs } from '../../store/prefs'

/**
 * The password vault while the app runs.
 *
 * Saved logins live in one file in your notes folder (.notesapp/passwords.json), encrypted with
 * AES-256 like locked notes. A random "vault key" encrypts them; that key is stored only in locked
 * form, by your master password (and a recovery key, if you made one). The master password has
 * nothing to do with the locked-notes password.
 *
 * The key and the unlocked logins only live in memory, and are forgotten when you lock the
 * vault, after the auto-lock time, when you switch notes folders, or when Notes closes.
 */

const FILE = 'passwords.json'
export const MIN_MASTER = 8
/** If auto-lock is set to "Never", the vault still locks after this long. */
export const FALLBACK_AUTO_LOCK_MIN = 30

interface PasswordsFile {
  v: 1
  lock: LockFile
  logins: Sealed
}

interface PasswordsState {
  /** A master password has been set up (passwords.json exists). */
  setUp: boolean
  unlocked: boolean
  /** The logins, only while unlocked (deleted ones included, see Login.deleted). */
  logins: Login[]
}

export const usePasswords = create<PasswordsState>(() => ({ setUp: false, unlocked: false, logins: [] }))

let file: PasswordsFile | null = null
/** The file exactly as last read or written, to notice when another computer changed it. */
let lastRaw: string | null = null
let vaultKey: Bytes | null = null

function forget(): void {
  vaultKey = null
  usePasswords.setState({ unlocked: false, logins: [] })
}

function parse(raw: string | null): PasswordsFile | null {
  if (!raw) return null
  const f = JSON.parse(raw) as PasswordsFile
  if (f?.v !== 1 || !f.lock || !f.logins) throw new Error('The passwords file isn’t in a format Notes understands.')
  return f
}

/** Call when a notes folder opens: reads whether it has a vault and forgets any key. */
export async function loadPasswords(): Promise<void> {
  forget()
  file = null
  lastRaw = null
  try {
    lastRaw = await window.api.readAppData(FILE)
    file = parse(lastRaw)
  } catch {
    file = null
  }
  usePasswords.setState({ setUp: !!file })
}

async function readLogins(f: PasswordsFile, key: Bytes): Promise<Login[]> {
  return JSON.parse(await decryptText(key, f.logins)) as Login[]
}

async function write(f: PasswordsFile): Promise<void> {
  const raw = JSON.stringify(f, null, 2)
  await window.api.writeAppData(FILE, raw)
  file = f
  lastRaw = raw
}

// ---------- setting up and unlocking ----------

export function masterPasswordProblem(password: string, again: string): string | null {
  if (password.length < MIN_MASTER) return `Use at least ${MIN_MASTER} characters. A few unrelated words together is strong and easy to remember.`
  if (password !== again) return 'The two passwords don’t match.'
  return null
}

/** Makes the vault. Returns the recovery key, if one was asked for. */
export async function setUpVault(master: string, withRecovery: boolean): Promise<string | undefined> {
  if (file) throw new Error('A password vault already exists in this notes folder.')
  // Read again: a vault that synced in (or couldn't be read at start-up) must never be replaced.
  if ((await window.api.readAppData(FILE)) !== null) {
    await loadPasswords()
    throw new Error('This notes folder already has a password vault (it may have just synced). Unlock it with its master password.')
  }
  const made = await createLock(master, withRecovery)
  await write({ v: 1, lock: made.lock, logins: await encryptText(made.notesKey, '[]') })
  vaultKey = made.notesKey
  usePasswords.setState({ setUp: true, unlocked: true, logins: [] })
  touch()
  return made.recoveryKey
}

/** Reads the file again (it may have synced from elsewhere) and opens it with a way to get the key. */
async function openWith(getKey: (lock: LockFile) => Promise<Bytes>): Promise<void> {
  const raw = await window.api.readAppData(FILE)
  const f = parse(raw)
  if (!f) throw new Error('The passwords file is missing from this notes folder.')
  const key = await getKey(f.lock)
  const logins = await readLogins(f, key)
  file = f
  lastRaw = raw
  vaultKey = key
  usePasswords.setState({ setUp: true, unlocked: true, logins })
  touch()
}

export const unlockVault = (master: string): Promise<void> => openWith((lock) => unlockWithPassword(lock, master))

/** "Forgot master password": unlocks with the recovery key; the page then asks for a new password. */
export const unlockVaultWithRecovery = (recoveryKey: string): Promise<void> => openWith((lock) => unlockWithRecovery(lock, recoveryKey))

export const vaultHasRecoveryKey = (): boolean => !!file?.lock.byRecovery

/** The vault key while unlocked, for the file vault (which shares the master password). */
export const vaultKeyNow = (): Bytes | null => vaultKey

export function lockVault(): void {
  if (vaultKey) forget()
}

/** Changes the master password (while unlocked). The logins themselves don't need re-encrypting. */
export async function changeMasterPassword(password: string): Promise<void> {
  if (!vaultKey || !file) throw new Error('Unlock your passwords first.')
  const key = vaultKey
  await queue(async () => {
    const current = await upToDate(key)
    await write({ ...current, lock: await relock(key, password, current.lock) })
  })
}

/** Checks the master password without changing anything. */
export async function checkMasterPassword(password: string): Promise<boolean> {
  if (!file) return false
  try {
    await unlockWithPassword(file.lock, password)
    return true
  } catch {
    return false
  }
}

// ---------- changing logins ----------

let saving: Promise<unknown> = Promise.resolve()
/** Saves one at a time, so two quick changes can't overwrite each other. */
function queue<T>(fn: () => Promise<T>): Promise<T> {
  const next = saving.then(fn, fn)
  saving = next.catch(() => undefined)
  return next
}

/**
 * The file as it is on disk now, with this computer's logins merged in if it was changed
 * elsewhere (each login keeps whichever copy was edited last).
 */
async function upToDate(key: Bytes): Promise<PasswordsFile> {
  const raw = await window.api.readAppData(FILE)
  if (raw === lastRaw && file) return file
  const theirs = parse(raw)
  if (!theirs) throw new Error('The passwords file is missing from this notes folder, so nothing was saved. Lock your passwords and check your notes folder.')
  let logins: Login[]
  try {
    logins = await readLogins(theirs, key)
  } catch (err) {
    if (err instanceof WrongPassword)
      throw new Error('The passwords file was replaced on another computer and can’t be opened with this one’s key. Nothing was saved. Lock your passwords and unlock them again.')
    throw err
  }
  const merged = mergeLogins(logins, usePasswords.getState().logins)
  if (vaultKey === key) usePasswords.setState({ logins: merged })
  return { ...theirs, logins: await encryptText(key, JSON.stringify(merged)) }
}

function update(change: (logins: Login[]) => Login[]): Promise<void> {
  const key = vaultKey
  if (!key) return Promise.reject(new Error('Your passwords are locked again. Unlock them to save.'))
  return queue(async () => {
    const current = await upToDate(key)
    if (vaultKey !== key) throw new Error('Your passwords locked before this could be saved.')
    const logins = change(usePasswords.getState().logins)
    await write({ ...current, logins: await encryptText(key, JSON.stringify(logins)) })
    usePasswords.setState({ logins })
    touch()
  })
}

/** Adds or changes a login. */
export function saveLogin(login: Login): Promise<void> {
  const saved = { ...login, updated: Date.now() }
  return update((logins) => (logins.some((l) => l.id === login.id) ? logins.map((l) => (l.id === login.id ? saved : l)) : [...logins, saved]))
}

/** Adds several logins in one go (importing from another browser). */
export function addLogins(list: Login[]): Promise<void> {
  if (!list.length) return Promise.resolve()
  const now = Date.now()
  return update((logins) => [...logins, ...list.map((l) => ({ ...l, updated: now }))])
}

export function deleteLogin(id: string): Promise<void> {
  return update((logins) => logins.map((l) => (l.id === id ? tombstone(id) : l)))
}

// ---------- locking again ----------

let lastActive = Date.now()
const touch = (): void => {
  lastActive = Date.now()
}

export const autoLockMinutes = (): number => usePrefs.getState().prefs.autoLockMinutes || FALLBACK_AUTO_LOCK_MIN

if (typeof window !== 'undefined') {
  for (const ev of ['keydown', 'mousedown', 'wheel'] as const) window.addEventListener(ev, touch, { capture: true, passive: true })
  setInterval(() => {
    if (vaultKey && Date.now() - lastActive > autoLockMinutes() * 60_000) lockVault()
  }, 15_000)
}
