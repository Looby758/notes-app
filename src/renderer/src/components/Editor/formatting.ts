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

/** Commands that act on the editor; their shortcuts can be changed in Settings like any other. */
export interface EditorCommand {
  id: string
  title: string
  shortcut: string
  run: Command
}

export const EDITOR_COMMANDS: EditorCommand[] = [
  { id: 'format.bold', title: 'Bold', shortcut: 'Ctrl+B', run: toggleWrap('**') },
  { id: 'format.italic', title: 'Italic', shortcut: 'Ctrl+I', run: toggleWrap('*') },
  { id: 'format.code', title: 'Inline code', shortcut: 'Ctrl+E', run: toggleWrap('`') },
  { id: 'format.strike', title: 'Strikethrough', shortcut: 'Ctrl+Shift+X', run: toggleWrap('~~') }
]
