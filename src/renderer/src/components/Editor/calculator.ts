import { syntaxTree } from '@codemirror/language'
import type { Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { calcLine, calculate } from '../../lib/calc'

/**
 * The inline calculator: a line starting with "=" ("= 12 * 4.5", "= 5 km in miles") shows its
 * answer at the end of the line as you type. Click the answer to copy it. The note's text never changes.
 */

class AnswerWidget extends WidgetType {
  constructor(readonly answer: string) {
    super()
  }
  eq(other: AnswerWidget): boolean {
    return other.answer === this.answer
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-calc'
    el.title = 'Click to copy'
    const value = document.createElement('span')
    value.className = 'cm-calc-value'
    value.textContent = this.answer
    el.append('= ', value)
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      void navigator.clipboard.writeText(this.answer).then(() => {
        el.classList.add('cm-calc-copied')
        value.textContent = 'Copied'
        setTimeout(() => {
          el.classList.remove('cm-calc-copied')
          value.textContent = this.answer
        }, 900)
      })
    })
    return el
  }
  ignoreEvent(): boolean {
    return true
  }
}

const NOT_IN = new Set(['FencedCode', 'CodeBlock', 'CodeText', 'InlineCode', 'HTMLBlock', 'Comment', 'CommentBlock'])

function build(view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = []
  const { doc } = view.state
  const tree = syntaxTree(view.state)
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos)
      pos = line.to + 1
      if (!line.text.includes('=')) continue
      const calc = calcLine(line.text)
      if (!calc) continue
      // Not in code, where "=" means something else.
      let inCode = false
      for (let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(line.from + calc.offset, 1); node; node = node.parent) {
        if (NOT_IN.has(node.name)) {
          inCode = true
          break
        }
      }
      if (inCode) continue
      const answer = calculate(calc.sum)
      if (answer !== null) out.push(Decoration.widget({ widget: new AnswerWidget(answer), side: 1 }).range(line.to))
    }
  }
  return Decoration.set(out)
}

export const calculator = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = build(u.view)
    }
  },
  { decorations: (v) => v.decorations }
)
