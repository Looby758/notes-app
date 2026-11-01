import { notify } from '../store/notify'

/**
 * Unsaved changes in open text files (.txt, .json…), by path, so closing the window, switching
 * vaults or renaming a file saves them first (see flushAll).
 */
const pending = new Map<string, () => Promise<void>>()

export function setPendingTextSave(path: string, save: (() => Promise<void>) | null): void {
  if (save) pending.set(path, save)
  else pending.delete(path)
}

export async function flushTextFiles(): Promise<void> {
  await Promise.all([...pending.values()].map((save) => save().catch(notify)))
}
