import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { isRunnable, runCode, type RunResult } from '../../lib/runCode'

/**
 * A ▶ Run button on JavaScript code blocks. What the code prints shows in a box under the block;
 * it isn't saved into the note. See lib/runCode for where the code runs and what it can't do.
 */

/** While running, a token of its own, so the result finds its block even if the note changes meanwhile. */
type Running = { running: true }
type Output = RunResult | Running

/** Results, by the position of the block's opening ``` line. */
const setOutput = StateEffect.define<{ at: number; output: Output | null }>({
  map: (v, changes) => ({ ...v, at: changes.mapPos(v.at) })
})

const outputs = StateField.define<Map<number, Output>>({
  create: () => new Map(),
  update(value, tr) {
    let next = value
    if (tr.docChanged && value.size) {
      next = new Map()
      for (const [at, out] of value) next.set(tr.changes.mapPos(at), out)
    }
    for (const e of tr.effects) {
      if (!e.is(setOutput)) continue
      if (next === value) next = new Map(value)
      if (e.value.output) next.set(e.value.at, e.value.output)
      else next.delete(e.value.at)
    }
    return next
  }
})

/** The runnable fenced block whose opening line starts at `at`, and its code. */
function blockAt(state: EditorState, at: number): { node: SyntaxNode; code: string } | null {
  let found: SyntaxNode | null = null
  syntaxTree(state).iterate({
    from: at,
    to: state.doc.lineAt(at).to,
    enter: (n) => {
      if (found) return false
      if (n.name !== 'FencedCode') return
      if (state.doc.lineAt(n.from).from === at) found = n.node
      return false
    }
  })
  return found ? runnableBlock(state, found) : null
}

function runnableBlock(state: EditorState, node: SyntaxNode): { node: SyntaxNode; code: string } | null {
  const doc = state.doc
  const info = node.getChild('CodeInfo')
  if (!info || !isRunnable(doc.sliceString(info.from, info.to))) return null
  const first = doc.lineAt(node.from)
  const last = doc.lineAt(node.to)
  // Only once the block is closed with its ```.
  if (last.number === first.number || !/^\s*(`{3,}|~{3,})\s*$/.test(last.text)) return null
  const code = last.number - first.number > 1 ? doc.sliceString(doc.line(first.number + 1).from, doc.line(last.number - 1).to) : ''
  return { node, code }
}

async function run(view: EditorView, at: number): Promise<void> {
  const block = blockAt(view.state, at)
  if (!block) return
  const token: Running = { running: true }
  view.dispatch({ effects: setOutput.of({ at, output: token }) })
  let output: RunResult
  try {
    output = await runCode(block.code)
  } catch (err) {
    output = { status: 'done', lines: [{ kind: 'error', text: err instanceof Error ? err.message : String(err) }], ms: 0 }
  }
  // Unless it was cleared (or the block deleted) while running.
  const entry = [...view.state.field(outputs)].find(([, o]) => o === token)
  if (entry) view.dispatch({ effects: setOutput.of({ at: entry[0], output }) })
}

/** Clicks on these shouldn't move the cursor into the code. */
function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.title = title
  b.addEventListener('mousedown', (e) => e.preventDefault())
  b.addEventListener('click', (e) => {
    e.preventDefault()
    onClick()
  })
  return b
}

class RunButtonWidget extends WidgetType {
  constructor(readonly running: boolean) {
    super()
  }
  eq(other: RunButtonWidget): boolean {
    return other.running === this.running
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-run-anchor'
    const b = button(this.running ? 'Running…' : '▶ Run', 'Run this code and show the result below it', () => {
      void run(view, view.posAtDOM(el))
    })
    b.className = 'cm-run-button'
    b.disabled = this.running
    el.appendChild(b)
    return el
  }
  ignoreEvent(): boolean {
    return true
  }
}

class OutputWidget extends WidgetType {
  constructor(
    readonly at: number,
    readonly output: Output
  ) {
    super()
  }
  eq(other: OutputWidget): boolean {
    return other.output === this.output && other.at === this.at
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-run-output'
    const head = document.createElement('div')
    head.className = 'cm-run-output-head'
    const status = document.createElement('span')
    const out = this.output
    if ('running' in out) status.textContent = 'Running…'
    else if (out.status === 'timeout') status.textContent = 'Stopped after 5 seconds (it was taking too long)'
    else if (out.lines.some((l) => l.kind === 'error')) status.textContent = 'Stopped with an error'
    else status.textContent = `Finished in ${out.ms < 1000 ? `${out.ms} ms` : `${(out.ms / 1000).toFixed(1)} s`}`
    head.appendChild(status)
    const close = button('✕', 'Clear the result', () => view.dispatch({ effects: setOutput.of({ at: this.at, output: null }) }))
    close.className = 'cm-run-clear'
    head.appendChild(close)
    el.appendChild(head)
    if (!('running' in out) && (out.lines.length || out.status === 'done')) {
      const body = document.createElement('pre')
      body.className = 'cm-run-lines'
      for (const line of out.lines) {
        const row = document.createElement('div')
        row.className = `cm-run-line cm-run-${line.kind}`
        row.textContent = line.text
        body.appendChild(row)
      }
      if (!out.lines.length && out.status === 'done') {
        const row = document.createElement('div')
        row.className = 'cm-run-line cm-run-empty'
        row.textContent = 'Nothing was printed. Use console.log(…) to show a value.'
        body.appendChild(row)
      }
      el.appendChild(body)
    }
    return el
  }
  ignoreEvent(): boolean {
    return true
  }
}

function build(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = []
  const doc = state.doc
  const results = state.field(outputs)
  if (!/```|~~~/.test(doc.toString())) return Decoration.none
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name !== 'FencedCode') return
      const block = runnableBlock(state, n.node)
      if (!block) return false
      const at = doc.lineAt(n.from).from
      const end = doc.lineAt(n.to).to
      const result = results.get(at)
      out.push(Decoration.widget({ widget: new RunButtonWidget(!!result && 'running' in result), block: true, side: -1 }).range(at))
      if (result) out.push(Decoration.widget({ widget: new OutputWidget(at, result), block: true, side: 1 }).range(end))
      return false
    }
  })
  return Decoration.set(out, true)
}

const decorations = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    if (tr.docChanged || tr.effects.some((e) => e.is(setOutput)) || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      return build(tr.state)
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f)
})

export const codeRunner = [outputs, decorations]
