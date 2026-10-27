import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { findMathBlocks, INLINE_MATH } from '../../lib/math'
import { cachedDiagram, renderDiagram } from '../../lib/diagrams'

/**
 * Maths ($x^2$ and $$ blocks) and diagrams (```mermaid blocks) drawn in place. Like the rest of
 * live preview, the text behind them comes back while the cursor is on them; click one to edit it.
 */

const isDark = (): boolean => !document.body.classList.contains('theme-light')

/** Puts the cursor at `pos` when a drawn formula or diagram is clicked (not in reading mode). */
function editOnClick(el: HTMLElement, view: EditorView, offset: number): void {
  el.addEventListener('mousedown', (e) => {
    if (view.state.readOnly || e.button !== 0) return
    e.preventDefault()
    const pos = Math.min(view.posAtDOM(el) + offset, view.state.doc.length)
    view.dispatch({ selection: { anchor: pos } })
    view.focus()
  })
}

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean
  ) {
    super()
  }
  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement(this.display ? 'div' : 'span')
    el.className = this.display ? 'cm-math-block' : 'cm-math'
    // A mistake in the formula shows the formula in red, with what's wrong as its tooltip.
    katex.render(this.tex, el, { displayMode: this.display, throwOnError: false })
    el.title = this.display ? '' : this.tex
    // Inline: into the formula, just after the $. Block: to the start of the formula's first line.
    editOnClick(el, view, this.display ? 0 : 1)
    return el
  }
  ignoreEvent(): boolean {
    return true
  }
}

class DiagramWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly dark: boolean
  ) {
    super()
  }
  eq(other: DiagramWidget): boolean {
    return other.code === this.code && other.dark === this.dark
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-diagram'
    const cached = cachedDiagram(this.code, this.dark)
    if (cached) el.innerHTML = cached
    else {
      el.classList.add('cm-diagram-loading')
      el.textContent = 'Drawing diagram…'
      renderDiagram(this.code, this.dark)
        .then((svg) => {
          el.classList.remove('cm-diagram-loading')
          el.innerHTML = svg
        })
        .catch((err: unknown) => {
          el.classList.remove('cm-diagram-loading')
          el.classList.add('cm-diagram-error')
          const msg = err instanceof Error ? err.message : String(err)
          el.textContent = `This diagram couldn't be drawn. Click to edit it.\n\n${msg.split('\n').slice(0, 4).join('\n')}`
        })
        .finally(() => view.requestMeasure())
    }
    editOnClick(el, view, 0)
    return el
  }
  ignoreEvent(): boolean {
    return true
  }
}

// ---------- blocks: $$ … $$ and ```mermaid (multi-line, so from a state field) ----------

function buildBlocks(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = []
  const { doc, selection } = state
  const touched = (from: number, to: number): boolean =>
    !state.readOnly && selection.ranges.some((r) => r.to >= from && r.from <= to)
  const text = doc.toString()
  const dark = isDark()

  if (text.includes('$$')) {
    for (const b of findMathBlocks(text.split('\n'))) {
      const from = doc.line(b.startLine + 1).from
      const to = doc.line(b.endLine + 1).to
      if (!b.tex || touched(from, to)) continue
      out.push(Decoration.replace({ widget: new MathWidget(b.tex, true), block: true }).range(from, to))
    }
  }

  if (text.includes('mermaid')) {
    for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
      if (node.name !== 'FencedCode') continue
      const info = node.getChild('CodeInfo')
      if (!info || doc.sliceString(info.from, info.to).trim().toLowerCase() !== 'mermaid') continue
      const first = doc.lineAt(node.from)
      const last = doc.lineAt(node.to)
      // Only once the block is closed with its ```.
      if (last.number === first.number || !/^\s*(`{3,}|~{3,})\s*$/.test(last.text)) continue
      const code = doc.sliceString(doc.line(first.number + 1).from, doc.line(last.number - 1).to)
      if (!code.trim() || touched(first.from, last.to)) continue
      out.push(Decoration.replace({ widget: new DiagramWidget(code, dark), block: true }).range(first.from, last.to))
    }
  }
  return Decoration.set(out, true)
}

const blockPreview = StateField.define<DecorationSet>({
  create: buildBlocks,
  update(value, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState) || tr.startState.readOnly !== tr.state.readOnly) {
      return buildBlocks(tr.state)
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f)
})

// ---------- inline $…$ (visible range only) ----------

function buildInline(view: EditorView): DecorationSet {
  const { state } = view
  const doc = state.doc
  const out: Range<Decoration>[] = []
  const active = new Set<number>()
  if (view.hasFocus) {
    for (const r of state.selection.ranges) {
      for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) active.add(n)
    }
  }
  for (const range of view.visibleRanges) {
    const text = doc.sliceString(range.from, range.to)
    if (!text.includes('$')) continue
    for (const m of text.matchAll(INLINE_MATH)) {
      const from = range.from + m.index
      const to = from + m[0].length
      const ln = doc.lineAt(from)
      if (active.has(ln.number) || ln.text.trim().startsWith('$$')) continue
      if (/Code/.test(syntaxTree(state).resolveInner(from, 1).name)) continue
      out.push(Decoration.replace({ widget: new MathWidget(m[1], false) }).range(from, to))
    }
  }
  return Decoration.set(out, true)
}

const inlineMath = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildInline(view)
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) {
        this.decorations = buildInline(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations }
)

export const mathDiagrams = [blockPreview, inlineMath]
