import { EditorState, RangeSetBuilder, Transaction, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/**
 * Typewriter mode, in two independent parts:
 * - centring: the line you're writing on stays in the middle of the screen;
 * - dimming: everything except the current paragraph (or line) fades back.
 */

/** Keeps the cursor's line centred as you type or move with the keyboard. Clicking doesn't jump. */
const centreCursor: Extension = [
  EditorState.transactionExtender.of((tr) => {
    if (!tr.selection && !tr.docChanged) return null
    const event = tr.annotation(Transaction.userEvent)
    // Only your own typing and keyboard moves (not other panes' copies, saves or clicks).
    if (!event || event.startsWith('select.pointer')) return null
    return { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: 'center' }) }
  }),
  // Room below the last line, so even the end of a note can sit in the middle.
  EditorView.editorAttributes.of({ class: 'cm-typewriter' })
]

/** The lines (1-based, inclusive) that stay bright: the cursor's line, or its paragraph. */
export function focusedLines(state: EditorState, unit: 'line' | 'paragraph'): [number, number] {
  const { doc } = state
  const line = doc.lineAt(state.selection.main.head).number
  if (unit === 'line') return [line, line]
  const blank = (n: number): boolean => doc.line(n).text.trim() === ''
  if (blank(line)) return [line, line]
  let from = line
  let to = line
  while (from > 1 && !blank(from - 1)) from--
  while (to < doc.lines && !blank(to + 1)) to++
  return [from, to]
}

const dimmed = Decoration.line({ class: 'cm-dimmed' })

function dimOthers(unit: 'line' | 'paragraph'): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = this.build(view)
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged) this.decorations = this.build(u.view)
      }
      build(view: EditorView): DecorationSet {
        // Only while you're writing in this editor; a note you're just looking at stays fully visible.
        if (!view.hasFocus) return Decoration.none
        const [first, last] = focusedLines(view.state, unit)
        const b = new RangeSetBuilder<Decoration>()
        const { doc } = view.state
        for (const { from, to } of view.visibleRanges) {
          for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
            if (n < first || n > last) b.add(doc.line(n).from, doc.line(n).from, dimmed)
          }
        }
        return b.finish()
      }
    },
    { decorations: (v) => v.decorations }
  )
}

export function typewriter(p: { typewriterCenter: boolean; typewriterDim: boolean; typewriterDimUnit: 'line' | 'paragraph' }): Extension {
  return [p.typewriterCenter ? centreCursor : [], p.typewriterDim ? dimOthers(p.typewriterDimUnit) : []]
}
