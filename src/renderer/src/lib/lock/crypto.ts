/**
 * Locked notes: encryption (AES-256-GCM via the browser's own crypto).
 *
 * One random "notes key" encrypts every locked note. That key is stored only in locked form
 * (.notesapp/lock.json), locked twice: by your password, and (if you made one) by a recovery key.
 * A note can instead have its own password, used just for it (no recovery for those).
 *
 * A locked note is still a .md file, so it stays in your file list and syncs as usual:
 *
 *   ---
 *   locked: true
 *   ---
 *   🔒 This note is locked. Open it in Notes to read it.
 *
 *   ```notes-locked
 *   {"v":1,"mode":"vault","iv":"…","data":"…"}
 *   ```
 */

/** Bytes backed by a plain ArrayBuffer (what WebCrypto takes). */
export type Bytes = Uint8Array<ArrayBuffer>

const subtle = globalThis.crypto.subtle
const ITERATIONS = 600_000
const RECOVERY_ITERATIONS = 100_000

// ---------- base64 ----------

export const toB64 = (bytes: Bytes): string => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
export const fromB64 = (s: string): Bytes => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const random = (n: number): Bytes => globalThis.crypto.getRandomValues(new Uint8Array(n))
const utf8 = new TextEncoder()
const fromUtf8 = new TextDecoder()

// ---------- keys ----------

async function passwordKey(password: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', utf8.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

const aesKey = (raw: Bytes): Promise<CryptoKey> => subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])

interface Sealed {
  iv: string
  data: string
}

async function seal(key: CryptoKey, plain: Bytes): Promise<Sealed> {
  const iv = random(12)
  const data = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, plain))
  return { iv: toB64(iv), data: toB64(data) }
}

async function open(key: CryptoKey, s: Sealed): Promise<Bytes> {
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(s.iv) }, key, fromB64(s.data)))
}

// ---------- the notes password (lock.json) ----------

export interface LockFile {
  v: 1
  salt: string
  iterations: number
  /** The notes key, locked with your password. */
  byPassword: Sealed
  /** The notes key, locked with the recovery key (if you made one). */
  byRecovery?: { salt: string; sealed: Sealed }
}

/** A recovery key: 25 random letters and digits in five groups, e.g. "K7Q2M-…". */
export function makeRecoveryKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O, 1/I
  const bytes = random(25)
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
  return chars.match(/.{5}/g)!.join('-')
}

const normalizeRecovery = (k: string): string => k.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Sets up the notes password: a new notes key, locked by the password (and a recovery key). */
export async function createLock(password: string, withRecovery: boolean): Promise<{ lock: LockFile; notesKey: Bytes; recoveryKey?: string }> {
  const notesKey = random(32)
  const lock = await relock(notesKey, password)
  if (!withRecovery) return { lock, notesKey }
  const recoveryKey = makeRecoveryKey()
  const salt = random(16)
  const key = await passwordKey(normalizeRecovery(recoveryKey), salt, RECOVERY_ITERATIONS)
  lock.byRecovery = { salt: toB64(salt), sealed: await seal(key, notesKey) }
  return { lock, notesKey, recoveryKey }
}

/** Locks the notes key with a (new) password, keeping any recovery key. */
export async function relock(notesKey: Bytes, password: string, previous?: LockFile): Promise<LockFile> {
  const salt = random(16)
  const key = await passwordKey(password, salt, ITERATIONS)
  return { v: 1, salt: toB64(salt), iterations: ITERATIONS, byPassword: await seal(key, notesKey), byRecovery: previous?.byRecovery }
}

export class WrongPassword extends Error {
  constructor(what = 'password') {
    super(`That ${what} isn't right.`)
  }
}

export async function unlockWithPassword(lock: LockFile, password: string): Promise<Bytes> {
  try {
    return await open(await passwordKey(password, fromB64(lock.salt), lock.iterations), lock.byPassword)
  } catch {
    throw new WrongPassword()
  }
}

export async function unlockWithRecovery(lock: LockFile, recoveryKey: string): Promise<Bytes> {
  if (!lock.byRecovery) throw new Error('No recovery key was made for these notes.')
  try {
    const key = await passwordKey(normalizeRecovery(recoveryKey), fromB64(lock.byRecovery.salt), RECOVERY_ITERATIONS)
    return await open(key, lock.byRecovery.sealed)
  } catch {
    throw new WrongPassword('recovery key')
  }
}

// ---------- locked notes ----------

export interface NoteHeader {
  v: 1
  /** "vault": locked with the notes key. "own": with this note's own password. */
  mode: 'vault' | 'own'
  salt?: string
  iterations?: number
  iv: string
  data: string
}

const BLOCK = /```notes-locked\n([\s\S]*?)\n```/

export const isLockedText = (text: string): boolean => BLOCK.test(text)

export function lockedHeader(text: string): NoteHeader | null {
  const m = BLOCK.exec(text)
  if (!m) return null
  try {
    return JSON.parse(m[1]) as NoteHeader
  } catch {
    return null
  }
}

function wrap(header: NoteHeader): string {
  return `---\nlocked: true\n---\n🔒 This note is locked. Open it in Notes to read it.\n\n\`\`\`notes-locked\n${JSON.stringify(header)}\n\`\`\`\n`
}

/** Locks a note's text with the notes key. */
export async function lockWithNotesKey(text: string, notesKey: Bytes): Promise<string> {
  const sealed = await seal(await aesKey(notesKey), utf8.encode(text))
  return wrap({ v: 1, mode: 'vault', ...sealed })
}

/** A note with its own password: the key made from it (kept while unlocked) and how. */
export interface OwnKey {
  key: Bytes
  salt: string
  iterations: number
}

/** Makes the key for a note's own password (raw, so it can be kept while the note is open). */
export async function ownKeyFrom(password: string, salt?: string, iterations = ITERATIONS): Promise<OwnKey> {
  const s = salt ?? toB64(random(16))
  const base = await subtle.importKey('raw', utf8.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(s), iterations }, base, 256)
  return { key: new Uint8Array(bits), salt: s, iterations }
}

export async function lockWithOwnKey(text: string, own: OwnKey): Promise<string> {
  const sealed = await seal(await aesKey(own.key), utf8.encode(text))
  return wrap({ v: 1, mode: 'own', salt: own.salt, iterations: own.iterations, ...sealed })
}

/** Opens a locked note with a key (the notes key, or the note's own). Throws on the wrong key. */
export async function unlockNote(text: string, key: Bytes): Promise<string> {
  const header = lockedHeader(text)
  if (!header) throw new Error('This note isn’t locked.')
  try {
    return fromUtf8.decode(await open(await aesKey(key), header))
  } catch {
    throw new WrongPassword()
  }
}
