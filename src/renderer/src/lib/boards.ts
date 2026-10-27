import type { FileNode } from '@shared/types'
import { boardToText, isBoard, parseBoard, renameInBoard } from './canvas'
import { openFileTab } from './editorController'
import { useVault } from '../store/vault'
import { notify } from '../store/notify'

/** Reading, saving and creating canvas boards (the .canvas files; see canvas.ts for what's in them). */

/** Boards with changes not yet written, by path: each saves itself when called. */
const pending = new Map<string, () => Promise<void>>()

export function setPendingSave(path: string, save: (() => Promise<void>) | null): void {
  if (save) pending.set(path, save)
  else pending.delete(path)
}

/** Writes every board's unsaved changes now (before closing, renaming or moving). */
export async function flushBoards(): Promise<void> {
  await Promise.all([...pending.values()].map((save) => save().catch(notify)))
}

/** Makes a new "Untitled board" (in the selected folder, or `folder`), opens it and starts renaming it. */
export async function newBoard(folder?: string): Promise<void> {
  try {
    const vault = useVault.getState()
    const dir = vault.targetFolder(folder)
    const path = await window.api.createBoard(dir)
    vault.expandTo(dir)
    await vault.refresh()
    useVault.setState({ selected: path, renaming: path })
    openFileTab(path)
  } catch (err) {
    notify(err)
  }
}

function boardPaths(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'folder') boardPaths(n.children ?? [], out)
    else if (isBoard(n.path)) out.push(n.path)
  }
  return out
}

/**
 * After a rename or move (`from` → `to`, already done and the tree refreshed): keeps cards on
 * every board pointing at the moved notes and pictures. Quietly, since a broken card is never wanted.
 */
export async function fixBoardLinks(from: string, to: string): Promise<void> {
  for (const path of boardPaths(useVault.getState().tree)) {
    try {
      const text = await window.api.readNote(path)
      // Cheap check first: the board mentions the old name at all.
      if (!text.includes(from.slice(from.lastIndexOf('/') + 1))) continue
      const board = parseBoard(text)
      const next = renameInBoard(board, from, to)
      if (next !== board) await window.api.writeNote(path, boardToText(next))
    } catch {
      // A damaged or vanished board: nothing to fix.
    }
  }
}
