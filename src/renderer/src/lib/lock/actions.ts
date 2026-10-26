import { create } from 'zustand'
import { notify } from '../../store/notify'
import { noteTitle } from '../paths'
import { setNoteLock } from '../editorController'
import { isLocked, lockNow, needsUnlock, useLock } from './session'

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

export function lockAllNow(): void {
  const s = useLock.getState()
  if (!s.unlocked && s.ownOpen.length === 0) {
    notify(s.setUp ? 'Your locked notes are already locked.' : 'No notes are locked yet. Use “Lock this note” to lock one.', 'info')
    return
  }
  lockNow()
    .then(() => notify('Locked notes are locked again.', 'info'))
    .catch(notify)
}

export function changeNotesPassword(): void {
  if (!useLock.getState().setUp) {
    openLockDialog({ kind: 'setup' })
    return
  }
  openLockDialog({ kind: 'change' })
}
