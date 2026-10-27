import { EditorView } from '@codemirror/view'

/**
 * Which word you right-clicked in a note. The main process shows its meaning and synonyms on the
 * menu (src/main/dictionary.ts); picking a synonym puts it in place of that word.
 */

export interface MenuTarget {
  view: EditorView
  from: number
  to: number
  word: string
  /** Where you clicked, for the definition card. */
  x: number
  y: number
}

let target: MenuTarget | null = null
export const menuTarget = (): MenuTarget | null => target

const WORD_CHAR = /[\p{L}\p{M}'’-]/u

/** The word at a point in an editor, or the selected text if you right-clicked inside a short selection. */
export function wordAt(view: EditorView, x: number, y: number): Omit<MenuTarget, 'view' | 'x' | 'y'> | null {
  const pos = view.posAtCoords({ x, y })
  if (pos === null) return null
  const sel = view.state.selection.main
  if (!sel.empty && sel.from <= pos && pos <= sel.to && sel.to - sel.from <= 40) {
    const text = view.state.sliceDoc(sel.from, sel.to)
    const trimmed = text.trim()
    if (/^[\p{L}\p{M}'’ -]+$/u.test(trimmed) && trimmed.split(/\s+/).length <= 3) {
      const from = sel.from + text.indexOf(trimmed)
      return { from, to: from + trimmed.length, word: trimmed }
    }
  }
  const line = view.state.doc.lineAt(pos)
  let start = pos - line.from
  let end = start
  while (start > 0 && WORD_CHAR.test(line.text[start - 1])) start--
  while (end < line.text.length && WORD_CHAR.test(line.text[end])) end++
  // Not the quotes or dashes around a word: 'like' this, or this—
  while (start < end && /['’-]/.test(line.text[start])) start++
  while (end > start && /['’-]/.test(line.text[end - 1])) end--
  if (end - start < 2) return null
  return { from: line.from + start, to: line.from + end, word: line.text.slice(start, end) }
}

/** Puts a synonym in place of the right-clicked word (if the note hasn't changed there since). */
export function replaceMenuWord(text: string): void {
  if (!target) return
  const { view, from, to, word } = target
  if (!view.dom.isConnected || view.state.readOnly || view.state.sliceDoc(from, to) !== word) return
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input.replace' })
  view.focus()
  target = { ...target, to: from + text.length, word: text }
}

/** Tells the main process the word under each right-click, and runs its synonym picks. */
export function startDictionary(): () => void {
  const onMenu = (e: MouseEvent): void => {
    const el = e.target instanceof Element ? e.target.closest('.cm-editor') : null
    const view = el instanceof HTMLElement ? EditorView.findFromDOM(el) : null
    const found = view && wordAt(view, e.clientX, e.clientY)
    target = view && found ? { view, ...found, x: e.clientX, y: e.clientY } : null
    window.api.setMenuWord(target && { word: target.word, editable: !view!.state.readOnly })
  }
  // Capture: before the editor (or anything in it) handles the right-click.
  document.addEventListener('contextmenu', onMenu, true)
  const offReplace = window.api.onReplaceWord(replaceMenuWord)
  return () => {
    document.removeEventListener('contextmenu', onMenu, true)
    offReplace()
  }
}
