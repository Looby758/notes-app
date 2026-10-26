import { EditorSelection } from '@codemirror/state'
import type { Command } from '@codemirror/view'

/**
 * Wraps the selection in `marker` (e.g. ** for bold), or unwraps it if it's already wrapped.
 * Spaces at the edges of the selection stay outside the markers: markdown ignores `**bold **`.
 */
export function toggleWrap(marker: string): Command {
  return (view) => {
    const { state } = view
    const n = marker.length
    view.dispatch(
      state.changeByRange((range) => {
        const text = state.sliceDoc(range.from, range.to)
        const from = range.from + (text.length - text.trimStart().length)
        const to = Math.max(from, range.to - (text.length - text.trimEnd().length))
        const inner = state.sliceDoc(from, to)

        // Selection includes the markers: "**bold**" → "bold"
        if (inner.length >= 2 * n && inner.startsWith(marker) && inner.endsWith(marker)) {
          return {
            changes: [
              { from, to: from + n },
              { from: to - n, to }
            ],
            range: EditorSelection.range(from, to - 2 * n)
          }
        }
        // Markers sit just outside the selection: **[bold]** → bold
        if (state.sliceDoc(from - n, from) === marker && state.sliceDoc(to, to + n) === marker) {
          return {
            changes: [
              { from: from - n, to: from },
              { from: to, to: to + n }
            ],
            range: EditorSelection.range(from - n, to - n)
          }
        }
        return {
          changes: [
            { from, insert: marker },
            { from: to, insert: marker }
          ],
          range: EditorSelection.range(from + n, to + n)
        }
      })
    )
    return true
  }
}

/** Highlighter colours besides the plain ==yellow==. */
export const HIGHLIGHT_COLOURS = ['green', 'blue', 'pink', 'purple', 'orange'] as const

const MARK_TAG = /<mark class="hl-(\w+)">([\s\S]*?)<\/mark>/g

/**
 * A coloured highlight: <mark class="hl-green">text</mark> (plain HTML, so other apps still show
 * a highlight). On text that's already highlighted, the same colour removes it and another changes it.
 */
export function toggleColourHighlight(colour: string): Command {
  return (view) => {
    const { state } = view
    view.dispatch(
      state.changeByRange((range) => {
        const line = state.doc.lineAt(range.from)
        // Already inside a coloured highlight on this line?
        for (const m of line.text.matchAll(MARK_TAG)) {
          const from = line.from + m.index
          const to = from + m[0].length
          if (range.from >= from && range.to <= to) {
            const inner = m[2]
            const replacement = m[1] === colour ? inner : `<mark class="hl-${colour}">${inner}</mark>`
            const start = m[1] === colour ? from : from + `<mark class="hl-${colour}">`.length
            return { changes: { from, to, insert: replacement }, range: EditorSelection.range(start, start + inner.length) }
          }
        }
        const text = state.sliceDoc(range.from, range.to)
        const from = range.from + (text.length - text.trimStart().length)
        const to = Math.max(from, range.to - (text.length - text.trimEnd().length))
        const open = `<mark class="hl-${colour}">`
        return {
          changes: [
            { from, insert: open },
            { from: to, insert: '</mark>' }
          ],
          range: EditorSelection.range(from + open.length, to + open.length)
        }
      })
    )
    return true
  }
}

/**
 * Turns the current line into a task with a reminder in an hour's time (on the hour), and selects
 * the time so you can type over it: "- [ ] Call Sam ⏰ 2026-10-26 16:00".
 */
export const addReminder: Command = (view) => {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.head)
  const at = new Date(Date.now() + 60 * 60_000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  const time = `${pad(at.getHours())}:00`
  const text = line.text.replace(/\s*(⏰️?|\bremind:)\s*(\d{4}-\d{2}-\d{2}\s+)?\d{1,2}:\d{2}/u, '')
  const isTask = /^\s*[-*+]\s+\[[ xX]\]\s/.test(text)
  const isItem = /^\s*[-*+]\s/.test(text)
  const body = isTask ? text : isItem ? text.replace(/^(\s*[-*+]\s)/, '$1[ ] ') : `- [ ] ${text.trimStart()}`
  const next = `${body.trimEnd()} ⏰ ${date} ${time}`
  view.dispatch({ changes: { from: line.from, to: line.to, insert: next }, selection: EditorSelection.range(line.from + next.length - 5, line.from + next.length) })
  return true
}

/** Commands that act on the editor; their shortcuts can be changed in Settings like any other. */
export interface EditorCommand {
  id: string
  title: string
  shortcut?: string
  run: Command
}

export const EDITOR_COMMANDS: EditorCommand[] = [
  { id: 'format.bold', title: 'Bold', shortcut: 'Ctrl+B', run: toggleWrap('**') },
  { id: 'format.italic', title: 'Italic', shortcut: 'Ctrl+I', run: toggleWrap('*') },
  { id: 'format.code', title: 'Inline code', shortcut: 'Ctrl+E', run: toggleWrap('`') },
  { id: 'format.strike', title: 'Strikethrough', shortcut: 'Ctrl+Shift+X', run: toggleWrap('~~') },
  { id: 'format.highlight', title: 'Highlight', shortcut: 'Ctrl+Shift+H', run: toggleWrap('==') },
  { id: 'insert.reminder', title: 'Add a reminder to this line', shortcut: 'Ctrl+Alt+R', run: addReminder },
  ...HIGHLIGHT_COLOURS.map((c) => ({ id: `format.highlight.${c}`, title: `Highlight ${c}`, run: toggleColourHighlight(c) }))
]
