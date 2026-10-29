import { create } from 'zustand'
import { decryptBytes, decryptText, encryptBytes, encryptText, type Bytes, type Sealed } from '../lock/crypto'
import { usePasswords, vaultKeyNow } from './session'

/**
 * The file vault: photos and files locked away with the password vault's key (same master
 * password, same auto-lock). Each file is encrypted on its own into .notesapp/safe/<id>.bin; the
 * list of them (names, types, sizes) is encrypted too, in .notesapp/files-vault.json. Nothing
 * readable is written to disk, and unlocked files only live in memory while you look at them.
 */

const FILE = 'files-vault.json'

export interface SafeFile {
  id: string
  name: string
  type: string
  size: number
  added: number
}

interface IndexFile {
  v: 1
  files: Sealed
}

export const useFileVault = create<{ files: SafeFile[]; loaded: boolean }>(() => ({ files: [], loaded: false }))

const key = (): Bytes => {
  const k = vaultKeyNow()
  if (!k) throw new Error('Your vault is locked. Unlock it to use your files.')
  return k
}

const newId = (): string => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')

async function readIndex(k: Bytes): Promise<SafeFile[]> {
  const raw = await window.api.readAppData(FILE)
  if (!raw) return []
  const f = JSON.parse(raw) as IndexFile
  if (f?.v !== 1 || !f.files) throw new Error('The file vault list isn’t in a format Notes understands.')
  return JSON.parse(await decryptText(k, f.files)) as SafeFile[]
}

/** Reads the list (when the vault unlocks, or to pick up changes synced from elsewhere). */
export async function loadFileVault(): Promise<void> {
  const files = await readIndex(key())
  useFileVault.setState({ files, loaded: true })
}

let saving: Promise<unknown> = Promise.resolve()
/** One change at a time, each applied to the list as it is on disk now (it may have synced). */
function change(fn: (files: SafeFile[]) => SafeFile[]): Promise<void> {
  const next = saving.then(async () => {
    const k = key()
    const files = fn(await readIndex(k))
    const index: IndexFile = {
      v: 1,
      files: await encryptText(k, JSON.stringify(files))
    }
    await window.api.writeAppData(FILE, JSON.stringify(index, null, 2))
    if (vaultKeyNow() === k) useFileVault.setState({ files })
  })
  saving = next.catch(() => undefined)
  return next
}

const typeOf = (name: string): string => {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  const types: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/plain'
  }
  return types[ext] ?? 'application/octet-stream'
}

/**
 * Locks a file away. Exported so other places (the file explorer's "Move to vault") can use it.
 * Resolves once both the file and the list are saved.
 */
export async function addToFileVault(name: string, data: Uint8Array): Promise<SafeFile> {
  const id = newId()
  await window.api.writeSafeFile(id, await encryptBytes(key(), new Uint8Array(data)))
  const file: SafeFile = {
    id,
    name,
    type: typeOf(name),
    size: data.byteLength,
    added: Date.now()
  }
  try {
    await change((files) => [...files, file])
  } catch (err) {
    await window.api.removeSafeFile(id).catch(() => undefined)
    throw err
  }
  return file
}

/** Picks files on disk and locks them away; optionally sends the originals to the Bin after. */
export async function pickIntoFileVault(trashOriginals: boolean): Promise<number> {
  key()
  const picked = await window.api.pickSafeFiles()
  const done: string[] = []
  for (const p of picked) {
    await addToFileVault(p.name, p.data)
    done.push(p.path)
  }
  if (trashOriginals && done.length) await window.api.trashSafeOriginals(done)
  return done.length
}

/** A file's unlocked contents (kept only in memory by whoever asked). */
export async function openSafeFile(file: SafeFile): Promise<Uint8Array> {
  const sealed = await window.api.readSafeFile(file.id)
  if (!sealed) throw new Error(`“${file.name}” is missing from the vault folder (it may still be syncing).`)
  return decryptBytes(key(), new Uint8Array(sealed))
}

export async function removeFromFileVault(id: string): Promise<void> {
  await change((files) => files.filter((f) => f.id !== id))
  await window.api.removeSafeFile(id)
}

export async function renameInFileVault(id: string, name: string): Promise<void> {
  const clean = name.trim()
  if (!clean) return
  await change((files) => files.map((f) => (f.id === id ? { ...f, name: clean, type: typeOf(clean) } : f)))
}

// Locking the password vault forgets the list too.
usePasswords.subscribe((s, prev) => {
  if (prev.unlocked && !s.unlocked) useFileVault.setState({ files: [], loaded: false })
})
