import { useEffect, useRef } from 'react'
import { notify } from '../store/notify'
import { UndoHistory, type UndoStep } from './undoHistory'
import { IS_MAC } from '@shared/platform'

/**
 * Ctrl+Z (⌘Z) for everything. While you're typing (a note, a search box, a name), it's the text's
 * own undo, as always. Anywhere else it undoes the last change you made in Orbit: a file moved,
 * renamed or deleted, a playlist changed, a setting, a star, a calendar event, tags added to a
 * batch of notes, a money change… Ctrl+Shift+Z (and Ctrl+Y on Windows)
 * redoes it.
 */

export const history = new UndoHistory()

/** The undo key as this system writes it, for hints like "Deleted. Ctrl+Z to undo." */
export const UNDO_KEY = IS_MAC ? '⌘Z' : 'Ctrl+Z'

/** Adds a change to the undo list. */
export const recordUndo = (step: UndoStep): void => history.record(step)

export const isUndoing = (): boolean => history.isReplaying

/** What an undo changed, so a page showing it can reload: 'files', 'explorer', 'playlist:<uri>', 'playlists'. */
const EVENT = 'orbit:undo'

export function undoChanged(...scopes: string[]): void {
  for (const scope of scopes) window.dispatchEvent(new CustomEvent(EVENT, { detail: scope }))
}

/** Runs `onChange` when an undo or redo changes something under `scope` (exact, or `scope:…`). */
export function useUndoChanges(scope: string, onChange: () => void): void {
  const latest = useRef(onChange)
  latest.current = onChange
  useEffect(() => {
    const on = (e: Event): void => {
      const s = (e as CustomEvent<string>).detail
      if (s === scope || s.startsWith(`${scope}:`) || scope.startsWith(`${s}:`)) latest.current()
    }
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [scope])
}

export async function undo(): Promise<void> {
  if (!history.canUndo) return notify('Nothing to undo.', 'info')
  try {
    const label = await history.undo()
    if (label) notify(`Undone: ${label}`, 'info')
  } catch (err) {
    notify(err)
  }
}

export async function redo(): Promise<void> {
  if (!history.canRedo) return notify('Nothing to redo.', 'info')
  try {
    const label = await history.redo()
    if (label) notify(`Redone: ${label}`, 'info')
  } catch (err) {
    notify(err)
  }
}

const NOT_TEXT = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image'])

/** Whether Ctrl+Z here belongs to text you're typing in. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target instanceof HTMLInputElement) return !NOT_TEXT.has(target.type)
  if (target instanceof HTMLTextAreaElement) return true
  return !!target.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], .cm-editor')
}

/** Which undo key this is, if any. */
export function undoKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>, mac: boolean): 'undo' | 'redo' | null {
  if (!(mac ? e.metaKey : e.ctrlKey) || e.altKey) return null
  const key = e.key.toLowerCase()
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && !mac && !e.shiftKey) return 'redo'
  return null
}

/**
 * The window's Ctrl+Z. Pages with their own undo (the sketch pad, a board, a spreadsheet, Sudoku)
 * handle the key first and keep it; typing keeps it too.
 */
export function watchUndoKeys(mac: boolean): () => void {
  const onKey = (e: KeyboardEvent): void => {
    const which = undoKey(e, mac)
    if (!which || e.defaultPrevented || isTyping(e.target)) return
    e.preventDefault()
    void (which === 'undo' ? undo() : redo())
  }
  window.addEventListener('keydown', onKey)
  // The Mac's Edit menu (and ⌘Z that nothing on the page used) asks here.
  const offMenu = window.api.onEditCommand((which) => {
    if (isTyping(document.activeElement)) document.execCommand(which)
    else void (which === 'undo' ? undo() : redo())
  })
  return () => {
    window.removeEventListener('keydown', onKey)
    offMenu()
  }
}

/** Everything `fn` records is undone in one go. */
export const undoGroup = <T>(label: (count: number) => string, fn: () => Promise<T>): Promise<T> => history.group(label, fn)
