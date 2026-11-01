import { create } from 'zustand'
import { isWithin, replacePrefix } from '../paths'

/**
 * Locked folders: every note in one is locked with the notes password (new ones too), and
 * the folder stays shut in the sidebar until you unlock. Kept in the notes folder's app data.
 */

const FILE = 'locked-folders.json'

export const useLockedFolders = create<{ folders: string[] }>(() => ({ folders: [] }))

export async function loadLockedFolders(): Promise<void> {
  let folders: string[] = []
  try {
    const raw = await window.api.readAppData(FILE)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (Array.isArray(parsed)) folders = parsed.filter((p): p is string => typeof p === 'string')
  } catch {
    folders = []
  }
  useLockedFolders.setState({ folders })
}

function save(folders: string[]): void {
  useLockedFolders.setState({ folders })
  void window.api.writeAppData(FILE, JSON.stringify(folders, null, 2)).catch(() => undefined)
}

/** The locked folder `path` is in (or is), if any. */
export function lockedFolderOf(path: string, folders = useLockedFolders.getState().folders): string | undefined {
  return folders.find((f) => isWithin(path, f))
}

export const isFolderLocked = (folder: string): boolean => useLockedFolders.getState().folders.includes(folder)

export function addLockedFolder(folder: string): void {
  const { folders } = useLockedFolders.getState()
  // A folder inside a locked one is already covered; one around locked ones covers them.
  if (lockedFolderOf(folder, folders)) return
  save([...folders.filter((f) => !isWithin(f, folder)), folder])
}

export function removeLockedFolder(folder: string): void {
  const { folders } = useLockedFolders.getState()
  if (folders.includes(folder)) save(folders.filter((f) => f !== folder))
}

/** Follows renames and moves. */
export function remapLockedFolders(from: string, to: string): void {
  const { folders } = useLockedFolders.getState()
  if (folders.some((f) => isWithin(f, from))) save(folders.map((f) => replacePrefix(f, from, to)))
}

/** Forgets locked folders that were deleted. */
export function removeLockedFoldersWithin(path: string): void {
  const { folders } = useLockedFolders.getState()
  if (folders.some((f) => isWithin(f, path))) save(folders.filter((f) => !isWithin(f, path)))
}

/** Brings back locked folders that came back (undoing a delete). */
export function putBackLockedFolders(back: string[]): void {
  const { folders } = useLockedFolders.getState()
  const missing = back.filter((f) => !folders.includes(f))
  if (missing.length) save([...folders, ...missing])
}
