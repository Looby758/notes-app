import { create } from 'zustand'
import { notify } from '../../store/notify'
import { noteTitle } from '../paths'
import { setNoteLock } from '../editorController'
import { isLocked, lockNow, needsUnlock, useLock } from './session'
import { lockVault, usePasswords } from '../passwords/session'
import { addLockedFolder, isFolderLocked, lockedFolderOf, removeLockedFolder, useLockedFolders } from './folders'
import { isLockedText } from './crypto'
import { isWithin, notePaths } from '../paths'
import { useVault } from '../../store/vault'

/** What the commands and menus do with locked notes, and which lock dialog is showing. */

export type LockDialog =
  | { kind: 'setup'; then?: () => Promise<void> }
  | { kind: 'unlock'; then?: () => Promise<void> }
  | { kind: 'own'; path: string }
  | { kind: 'change' }
  | { kind: 'newPassword' }

export const useLockDialog = create<{ dialog: LockDialog | null }>(() => ({ dialog: null }))
export const openLockDialog = (dialog: LockDialog | null): void => useLockDialog.setState({ dialog })

/** Locks a note with the notes password (setting one up first, or asking for it, if needed). */
export function lockNote(path: string): void {
  if (isLocked(path)) {
    notify('That note is already locked.', 'info')
    return
  }
  const go = async (): Promise<void> => {
    await setNoteLock(path, { mode: 'vault' })
    notify(`“${noteTitle(path)}” is locked. It's saved encrypted, and kept out of search, links and the graph.`, 'info')
  }
  const s = useLock.getState()
  if (!s.setUp) openLockDialog({ kind: 'setup', then: go })
  else if (!s.unlocked) openLockDialog({ kind: 'unlock', then: go })
  else go().catch(notify)
}

/** Locks a note with a password of its own. */
export function lockNoteOwn(path: string): void {
  if (isLocked(path)) {
    notify('That note is already locked. Remove the lock first to give it its own password.', 'info')
    return
  }
  openLockDialog({ kind: 'own', path })
}

export async function removeLock(path: string): Promise<void> {
  if (!isLocked(path)) {
    notify('That note isn’t locked.', 'info')
    return
  }
  if (needsUnlock(path)) {
    notify('Open the note and unlock it first.', 'info')
    return
  }
  const folder = lockedFolderOf(path)
  if (folder && useLock.getState().locked[path] === 'vault') {
    notify(`This note is in the locked folder “${folderName(folder)}”. Move it out, or unlock the folder, to remove its lock.`, 'info')
    return
  }
  const ok = await window.api.confirm({
    message: `Remove the lock from “${noteTitle(path)}”?`,
    detail: 'It will be saved as an ordinary note again, readable by anyone with the file.',
    ok: 'Remove lock',
    cancel: 'Keep it locked'
  })
  if (!ok) return
  try {
    await setNoteLock(path, undefined)
    notify(`“${noteTitle(path)}” is no longer locked.`, 'info')
  } catch (err) {
    notify(err)
  }
}

/** Locks locked notes and the password vault. */
export function lockAllNow(): void {
  const s = useLock.getState()
  const passwords = usePasswords.getState().unlocked
  lockVault()
  if (!s.unlocked && s.ownOpen.length === 0) {
    if (passwords) notify('Your passwords are locked.', 'info')
    else notify(s.setUp ? 'Your locked notes are already locked.' : 'No notes are locked yet. Use “Lock this note” to lock one.', 'info')
    return
  }
  lockNow()
    .then(() => notify(passwords ? 'Locked notes and passwords are locked again.' : 'Locked notes are locked again.', 'info'))
    .catch(notify)
}

export function changeNotesPassword(): void {
  if (!useLock.getState().setUp) {
    openLockDialog({ kind: 'setup' })
    return
  }
  openLockDialog({ kind: 'change' })
}

// ---------- locked folders ----------

const notesWithin = (folder: string): string[] => notePaths(useVault.getState().tree).filter((p) => isWithin(p, folder))
const folderName = (folder: string): string => folder.split('/').pop() || folder

/** Locks every note in the folder that isn't locked yet (with the notes password). */
async function lockNotesIn(folder: string): Promise<number> {
  let count = 0
  for (const path of notesWithin(folder)) {
    if (isLocked(path)) continue
    try {
      // The tree may know of a note before its lock state has been read.
      if (isLockedText(await window.api.readNote(path))) continue
      await setNoteLock(path, { mode: 'vault' })
      count++
    } catch (err) {
      notify(err)
    }
  }
  return count
}

/** Locks a folder: all its notes, and any added to it later, are locked with the notes password. */
export function lockFolder(folder: string): void {
  if (lockedFolderOf(folder)) {
    notify('That folder is already locked.', 'info')
    return
  }
  const go = async (): Promise<void> => {
    addLockedFolder(folder)
    const count = await lockNotesIn(folder)
    notify(
      `“${folderName(folder)}” is locked${count ? ` (${count} ${count === 1 ? 'note' : 'notes'})` : ''}. Notes you add to it are locked too, and it stays shut until you unlock.`,
      'info'
    )
  }
  const s = useLock.getState()
  if (!s.setUp) openLockDialog({ kind: 'setup', then: go })
  else if (!s.unlocked) openLockDialog({ kind: 'unlock', then: go })
  else go().catch(notify)
}

/** Takes the lock off a folder, and off the notes in it that use the notes password. */
export async function removeFolderLock(folder: string): Promise<void> {
  if (!isFolderLocked(folder)) {
    notify('That folder isn’t locked.', 'info')
    return
  }
  if (!useLock.getState().unlocked) {
    openLockDialog({ kind: 'unlock', then: () => removeFolderLock(folder) })
    return
  }
  const ok = await window.api.confirm({
    message: `Remove the lock from “${folderName(folder)}”?`,
    detail: 'Its notes will be saved as ordinary notes again, readable by anyone with the files. Notes with their own password keep it.',
    ok: 'Remove lock',
    cancel: 'Keep it locked'
  })
  if (!ok) return
  removeLockedFolder(folder)
  for (const path of notesWithin(folder)) {
    if (useLock.getState().locked[path] !== 'vault' || lockedFolderOf(path)) continue
    await setNoteLock(path, undefined).catch(notify)
  }
  notify(`“${folderName(folder)}” is no longer locked.`, 'info')
}

/** Opens a locked folder in the sidebar (asking for the notes password first if need be). */
export function openLockedFolder(then: () => void): void {
  if (useLock.getState().unlocked) then()
  else openLockDialog({ kind: 'unlock', then: async () => then() })
}

// Notes made in, or moved into, a locked folder are locked as soon as the password is at hand.
let sweeping = false
let again = false
async function sweep(): Promise<void> {
  if (sweeping) {
    again = true
    return
  }
  sweeping = true
  try {
    do {
      again = false
      if (!useLock.getState().unlocked) return
      for (const folder of useLockedFolders.getState().folders) await lockNotesIn(folder)
    } while (again)
  } finally {
    sweeping = false
  }
}
let timer: ReturnType<typeof setTimeout> | undefined
const soon = (): void => {
  clearTimeout(timer)
  timer = setTimeout(() => void sweep(), 400)
}
// Subscribed once every module has loaded (the vault store and this file import each other indirectly).
setTimeout(() => {
  useVault.subscribe((s, prev) => s.tree !== prev.tree && useLockedFolders.getState().folders.length > 0 && soon())
  useLock.subscribe((s, prev) => s.unlocked && !prev.unlocked && useLockedFolders.getState().folders.length > 0 && soon())
}, 0)
